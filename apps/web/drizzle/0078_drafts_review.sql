-- Review of D6 (docs/review/work/drafts-hidden-review.md), one section per
-- finding.
--
-- 1. A deleted draft. Only drafts are deleted, so an action that no longer
--    exists was a draft the client never saw. The check through an action
--    answered "visible" for a missing one, so a deleted draft's activity
--    events (and any old notice about it) came back for the client admin.
--    Now a missing action is hidden from a client, like a draft, and the
--    function answers the same for both (no way to tell a draft's id from an
--    unknown one). A row that names no action (NULL) keeps its own rules.
CREATE OR REPLACE FUNCTION app_action_visible_to_client(aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(app_org_kind() = 'firm', false)
    OR aid IS NULL
    OR EXISTS (SELECT 1 FROM actions a WHERE a.id = aid AND a.status <> 'draft')
$$;
--> statement-breakpoint
-- 4. Closing and replacing with a draft on the project. The firm could mark
--    a draft "handed over" to the client at closing, though the client never
--    sees it (and closing leaves it a draft for ever), and could close a
--    released action as "superseded" by a draft the client cannot open.
--    Both are refused now: a draft is released first, or withdrawn.
CREATE OR REPLACE FUNCTION app_dispose_action(act uuid, p_disp closure_disposition, p_note text, s_user uuid, s_contact uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a actions;
  round uuid;
  item uuid;
BEGIN
  SELECT * INTO a FROM actions WHERE id = act;
  IF a.id IS NULL OR app_org_kind() IS DISTINCT FROM 'firm' OR NOT app_can_see_project(a.project_id) THEN
    RAISE EXCEPTION 'no such action' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT state::text FROM projects WHERE id = a.project_id) <> 'closing' THEN
    RAISE EXCEPTION 'dispose of open actions while the project is closing' USING ERRCODE = 'check_violation';
  END IF;
  IF a.status::text IN ('verified_complete', 'closed') THEN
    RAISE EXCEPTION 'this action is finished' USING ERRCODE = 'check_violation';
  END IF;
  IF a.status = 'draft' AND p_disp = 'handed_over' THEN
    RAISE EXCEPTION 'a draft cannot be handed over to the client: release it first, or withdraw it' USING ERRCODE = 'check_violation';
  END IF;
  IF length(coalesce(p_note, '')) > 2000 THEN
    RAISE EXCEPTION 'the note is too long' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM app_check_sustainer(a.org_id, s_user, s_contact);
  round := app_open_closure(a.project_id);
  INSERT INTO project_closure_items (closure_id, action_id, project_id, org_id, disposition, note, sustainer_user_id, sustainer_contact_id, decided_by)
  VALUES (round, act, a.project_id, a.org_id, p_disp, nullif(btrim(p_note), ''), s_user, s_contact, app_uid())
  ON CONFLICT (closure_id, action_id) DO UPDATE SET disposition = EXCLUDED.disposition, note = EXCLUDED.note,
    sustainer_user_id = EXCLUDED.sustainer_user_id, sustainer_contact_id = EXCLUDED.sustainer_contact_id,
    decided_by = EXCLUDED.decided_by, updated_at = now()
  RETURNING id INTO item;
  RETURN item;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_action_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  is_client boolean := app_uid() IS NOT NULL AND app_org_kind() IS DISTINCT FROM 'firm';
  -- What a client may change. Everything else, including columns added
  -- later, is the firm's.
  client_cols text[] := ARRAY['status', 'owner_user_id', 'blocked_reason', 'updated_at'];
BEGIN
  -- Client users move their actions and (managers, admins) assign owners;
  -- the plan itself is the firm's. Jobs and migrations (no user) are not limited.
  IF is_client AND (
    (to_jsonb(NEW) - client_cols) <> (to_jsonb(OLD) - client_cols)
    OR (NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id AND app_role() NOT IN ('client_admin', 'client_manager'))
  ) THEN
    RAISE EXCEPTION 'clients can only move an action through its workflow' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.updated_at := now();

  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF (OLD.status, NEW.status) NOT IN (
    ('draft', 'assigned'),
    ('assigned', 'in_progress'),
    ('in_progress', 'blocked'),
    ('blocked', 'in_progress'),
    ('in_progress', 'awaiting_review'),
    ('awaiting_review', 'verified_complete'),
    ('awaiting_review', 'revision_requested'),
    ('revision_requested', 'in_progress'),
    ('assigned', 'closed'), ('in_progress', 'closed'), ('blocked', 'closed'),
    ('awaiting_review', 'closed'), ('revision_requested', 'closed'),
    ('verified_complete', 'in_progress'), ('closed', 'in_progress')
  ) THEN
    RAISE EXCEPTION 'invalid action status change % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;

  -- Releasing, reviewing, closing and reopening are the firm's.
  IF is_client AND (OLD.status IN ('draft', 'awaiting_review') OR NEW.status = 'closed' OR OLD.status IN ('verified_complete', 'closed')) THEN
    RAISE EXCEPTION 'only the firm can release, review, close or reopen an action' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Transaction time, like reviews.created_at, so a review written in the
  -- same transaction as the move still belongs to this round.
  IF NEW.status = 'awaiting_review' THEN
    NEW.awaiting_review_at := now();
  END IF;

  IF NEW.status = 'verified_complete' THEN
    -- The accept must review this round: an older accept (before a reopen or
    -- a resubmission) does not count.
    IF COALESCE((
      SELECT r.outcome FROM reviews r
      WHERE r.action_id = NEW.id AND r.created_at >= COALESCE(OLD.awaiting_review_at, '-infinity')
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1
    ), 'reject') <> 'accept' THEN
      RAISE EXCEPTION 'verified_complete needs an accept review of this round' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM evidence_requests er WHERE er.action_id = NEW.id AND er.status NOT IN ('accepted', 'waived')) THEN
      RAISE EXCEPTION 'every evidence request must be accepted or waived first' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status = 'closed' THEN
    -- Signed since the action was last reopened, by someone who still holds
    -- a client admin or manager role.
    IF NEW.closure_outcome = 'risk_accepted' AND NOT EXISTS (
      SELECT 1 FROM risk_acceptances ra
      JOIN org_memberships m ON m.user_id = ra.accepted_by AND m.org_id = NEW.org_id AND m.active
        AND m.role IN ('client_admin', 'client_manager')
      WHERE ra.action_id = NEW.id AND ra.created_at >= COALESCE(OLD.reopened_at, '-infinity')
    ) THEN
      RAISE EXCEPTION 'risk acceptance needs a signed statement from the client' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.closure_outcome = 'superseded' AND NOT EXISTS (
      SELECT 1 FROM actions a WHERE a.id = NEW.superseded_by AND a.project_id = NEW.project_id
    ) THEN
      RAISE EXCEPTION 'a superseding action must be in the same project' USING ERRCODE = 'check_violation';
    END IF;
    -- The client reads what replaced its work: never a draft it cannot open (D6).
    IF NEW.closure_outcome = 'superseded' AND EXISTS (
      SELECT 1 FROM actions a WHERE a.id = NEW.superseded_by AND a.status = 'draft'
    ) THEN
      RAISE EXCEPTION 'the replacement is still a draft: release it first' USING ERRCODE = 'check_violation';
    END IF;
    NEW.closed_at := now();
    NEW.closed_by := COALESCE(app_uid(), NEW.closed_by);
  END IF;

  -- Reopening clears the closure; the history stays in activity_events.
  IF OLD.status IN ('verified_complete', 'closed') THEN
    NEW.closure_outcome := NULL;
    NEW.closure_note := NULL;
    NEW.closed_by := NULL;
    NEW.closed_at := NULL;
    NEW.superseded_by := NULL;
    NEW.reopened_at := now();
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- 5. Notices about an action written while it was a draft. New ones never
--    reach a client person (drop_hidden_action_notification), but some were
--    written before 0076, and they are kept, not deleted. Hidden only while
--    the action was a draft, they came back at release with their old dates,
--    and the summary job (which runs past row-level security) still counted
--    them for a "you have something new" mail. One rule now decides both: a
--    notice about an action is never shown or summarised to someone outside
--    the firm when the action is a draft or gone, or when it was written
--    before the action was released (the owner gets the release notice).
CREATE FUNCTION app_action_notice_hidden(recipient uuid, aid uuid, written timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM org_memberships m JOIN organizations o ON o.id = m.org_id
                     WHERE m.user_id = recipient AND o.kind = 'firm')
    AND (NOT EXISTS (SELECT 1 FROM actions a WHERE a.id = aid AND a.status <> 'draft')
         OR EXISTS (SELECT 1 FROM activity_events e
                    WHERE e.entity_type = 'action' AND e.entity_id = aid AND e.event = 'status_changed'
                      AND e.from_state = 'draft' AND e.created_at > written))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_action_notice_hidden(uuid, uuid, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_action_notice_hidden(uuid, uuid, timestamptz) TO selah_app;
--> statement-breakpoint
DROP POLICY draft ON notifications;
--> statement-breakpoint
CREATE POLICY draft ON notifications AS RESTRICTIVE FOR SELECT TO selah_app
  USING (entity_type <> 'action' OR NOT app_action_notice_hidden(user_id, entity_id, created_at));
--> statement-breakpoint
-- The summary job (latest definition: 0050_status_packs), with the same rule.
CREATE OR REPLACE FUNCTION app_queue_digests(today date) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  WITH due AS (
    SELECT x.id FROM notifications x
    CROSS JOIN LATERAL app_mail_choice(x.user_id) c
    WHERE x.mailed_at IS NULL AND x.read_at IS NULL
      AND x.created_at > now() - interval '8 days'
      AND CASE
        WHEN x.entity_type = 'action' AND x.kind LIKE 'follow_up.%' THEN app_cadence_due(c.reminders, today)
        -- information requests waiting on the client (migration 0017), one per project
        WHEN x.entity_type = 'project' AND x.kind IN ('info_request.due_soon', 'info_request.overdue') THEN app_cadence_due(c.reminders, today)
        -- a client quiet for two weeks (F18)
        WHEN x.entity_type = 'project' AND x.kind = 'project.client_quiet' THEN app_cadence_due(c.reminders, today)
        WHEN x.entity_type = 'project' AND x.kind = 'report.pack_drafted' THEN app_cadence_due(c.reminders, today)
        WHEN x.entity_type = 'action' AND x.kind = ANY (app_update_mail_kinds()) THEN c.updates <> 'instant' AND app_cadence_due(c.updates, today)
        ELSE false
      END
      AND NOT EXISTS (SELECT 1 FROM mail_mutes m WHERE m.user_id = x.user_id AND m.action_id = x.entity_id)
      -- Never a notice its reader may not see (D6): about a draft, or written before its release.
      AND NOT (x.entity_type = 'action' AND app_action_notice_hidden(x.user_id, x.entity_id, x.created_at))
    FOR UPDATE OF x SKIP LOCKED
  ),
  marked AS (
    UPDATE notifications x SET mailed_at = now() FROM due WHERE x.id = due.id RETURNING x.user_id
  ),
  mailed AS (
    INSERT INTO outbound_emails (to_email, kind, link)
    SELECT u.email, 'follow_up.digest', '/notifications'
    FROM (SELECT DISTINCT user_id FROM marked) m
    JOIN "user" u ON u.id = m.user_id
    WHERE app_can_reset_password(m.user_id)
      AND NOT EXISTS (
        SELECT 1 FROM outbound_emails o
        WHERE o.kind = 'follow_up.digest' AND lower(o.to_email) = lower(u.email) AND app_firm_date(o.created_at) = app_firm_today()
      )
    RETURNING 1
  )
  SELECT count(*) INTO n FROM mailed;
  RETURN n;
END $$;
--> statement-breakpoint
-- 6. Moving a department's work (latest definition: 0032_department_move).
--    The project's event "moved a department's work" reached the client
--    admin even when all that moved there was a draft (or work under a
--    firm-only recommendation), which the client cannot read. Such an event
--    is now firm-only; the firm's draft page still reads it as a refiling
--    (app_action_refilings). Everything else is unchanged.
CREATE OR REPLACE FUNCTION app_move_department_work(src uuid, dst uuid, switch_off boolean, dry_run boolean)
RETURNS TABLE (recommendations integer, actions integer, files integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  org uuid := (SELECT d.org_id FROM departments d WHERE d.id = src);
  recs uuid[];
  acts uuid[];
  docs uuid[];
BEGIN
  IF org IS NULL OR app_role() IS DISTINCT FROM 'firm_admin' OR NOT app_can_see_org(org) THEN
    RAISE EXCEPTION 'only the firm admin moves a department''s work' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT dry_run AND (dst IS NULL OR dst = src OR NOT EXISTS (SELECT 1 FROM departments d WHERE d.id = dst AND d.org_id = org AND d.active)) THEN
    RAISE EXCEPTION 'move the work to another active department of the same client' USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(array_agg(r.id), '{}') INTO recs
  FROM recommendations r JOIN projects p ON p.id = r.project_id
  WHERE r.department_id = src AND p.state::text <> 'closed'
    -- Read through jsonb so the rule holds whether or not withdrawal (N1) has its column yet.
    AND (to_jsonb(r) ->> 'withdrawn_at') IS NULL
    AND (EXISTS (SELECT 1 FROM actions a WHERE a.recommendation_id = r.id AND a.status NOT IN ('verified_complete', 'closed'))
      OR NOT EXISTS (SELECT 1 FROM actions a WHERE a.recommendation_id = r.id));
  SELECT coalesce(array_agg(a.id), '{}') INTO acts
  FROM actions a JOIN projects p ON p.id = a.project_id
  WHERE a.department_id = src AND p.state::text <> 'closed'
    AND (a.recommendation_id = ANY (recs) OR a.status NOT IN ('verified_complete', 'closed'));
  SELECT coalesce(array_agg(DISTINCT d.id), '{}') INTO docs
  FROM documents d JOIN evidence_submissions e ON e.document_id = d.id
  WHERE e.action_id = ANY (acts) AND d.department_id = src;

  IF NOT dry_run THEN
    UPDATE recommendations r SET department_id = dst WHERE r.id = ANY (recs);
    UPDATE actions a SET department_id = dst WHERE a.id = ANY (acts) AND a.department_id = src;
    UPDATE documents d SET department_id = dst WHERE d.id = ANY (docs);
    INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, meta, visibility)
    SELECT x.project_id, org, app_uid(), 'project', x.project_id, 'department_moved',
      jsonb_build_object('from', src, 'to', dst, 'actions',
        coalesce((SELECT jsonb_agg(a.id) FROM actions a WHERE a.project_id = x.project_id AND a.id = ANY (acts)), '[]'::jsonb)),
      -- Shared only when something the client can read moved in this project.
      CASE WHEN EXISTS (SELECT 1 FROM recommendations r WHERE r.id = ANY (recs) AND r.project_id = x.project_id AND r.visibility <> 'firm_private')
             OR EXISTS (SELECT 1 FROM actions a JOIN recommendations r ON r.id = a.recommendation_id
                        WHERE a.id = ANY (acts) AND a.project_id = x.project_id AND a.status <> 'draft' AND r.visibility <> 'firm_private')
           THEN 'shared' ELSE 'firm_private' END::visibility
    FROM (SELECT r.project_id FROM recommendations r WHERE r.id = ANY (recs)
          UNION SELECT a.project_id FROM actions a WHERE a.id = ANY (acts)) x;
    INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
    VALUES (app_uid(), org, 'department.move_work', 'department', src, 'allow', jsonb_build_object(
      'to', dst, 'recommendations', cardinality(recs), 'actions', cardinality(acts), 'files', cardinality(docs), 'switchedOff', switch_off));
    IF switch_off THEN
      UPDATE departments SET active = false WHERE id = src;
    END IF;
  END IF;
  RETURN QUERY SELECT cardinality(recs), cardinality(acts), cardinality(docs);
END $$;
