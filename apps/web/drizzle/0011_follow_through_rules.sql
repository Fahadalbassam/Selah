-- Follow-through rules (2026-10-20). The point of the product: the firm can
-- see, without calling the client, whether each recommendation was carried
-- out, and the client is reminded and escalated before things go stale.
--
--  1. Writes to the plan (findings, recommendations, actions, meetings,
--     follow-ups, reports) are the firm's. Clients only move their actions
--     through the workflow, and managers assign owners.
--  2. Actions can end without verification, with a closure outcome. Risk
--     accepted needs a named client person's signed statement. Closed or
--     verified actions can be reopened.
--  3. Every action can carry an evidence list. Verified Complete needs every
--     item accepted or waived.
--  4. Deadline change requests are decided once, by the firm; approval moves
--     the action's due date.
--  5. Reminders and the escalation ladder are computed by one function, and
--     each is logged so it is sent once.
--  6. Implementation progress comes from one function that runs under the caller's
--     row-level security.

-- ---------------------------------------------------------------- 1. writes

DROP POLICY scoped ON findings;
--> statement-breakpoint
CREATE POLICY scoped_read ON findings FOR SELECT TO selah_app
  USING (app_can_see_project(project_id) AND app_label_ok(visibility, org_id, created_by));
--> statement-breakpoint
CREATE POLICY firm_write ON findings FOR ALL TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id) AND app_label_ok(visibility, org_id, created_by))
  WITH CHECK (app_org_kind() = 'firm' AND app_can_see_project(project_id) AND app_label_ok(visibility, org_id, created_by));
--> statement-breakpoint
DROP POLICY scoped ON recommendations;
--> statement-breakpoint
CREATE POLICY scoped_read ON recommendations FOR SELECT TO selah_app
  USING (app_can_see_project(project_id) AND app_label_ok(visibility, org_id, created_by));
--> statement-breakpoint
CREATE POLICY firm_write ON recommendations FOR ALL TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id) AND app_label_ok(visibility, org_id, created_by))
  WITH CHECK (app_org_kind() = 'firm' AND app_can_see_project(project_id) AND app_label_ok(visibility, org_id, created_by));
--> statement-breakpoint
-- A board decision records when it was decided.
ALTER TABLE recommendations ADD CONSTRAINT board_decision_dated CHECK (source <> 'board_decision' OR decided_on IS NOT NULL);
--> statement-breakpoint
DROP POLICY scoped ON actions;
--> statement-breakpoint
CREATE POLICY scoped_read ON actions FOR SELECT TO selah_app USING (app_can_see_project(project_id));
--> statement-breakpoint
CREATE POLICY firm_insert ON actions FOR INSERT TO selah_app WITH CHECK (app_org_kind() = 'firm' AND app_can_see_project(project_id));
--> statement-breakpoint
-- Only drafts are deleted; a released action is closed (not applicable) so
-- the record keeps it.
CREATE POLICY firm_delete ON actions FOR DELETE TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id) AND status = 'draft');
--> statement-breakpoint
-- Client users update only actions they own, or any as admin or manager;
-- check_action_change() limits which columns they may touch.
CREATE POLICY scoped_update ON actions FOR UPDATE TO selah_app
  USING (app_can_see_project(project_id) AND (
    app_org_kind() = 'firm' OR app_role() IN ('client_admin', 'client_manager') OR owner_user_id = app_uid()))
  WITH CHECK (app_can_see_project(project_id) AND (
    app_org_kind() = 'firm' OR app_role() IN ('client_admin', 'client_manager') OR owner_user_id = app_uid()));
--> statement-breakpoint
DROP POLICY scoped ON meeting_notes;
--> statement-breakpoint
CREATE POLICY scoped_read ON meeting_notes FOR SELECT TO selah_app
  USING (app_can_see_project(project_id) AND app_label_ok(visibility, org_id, author_id));
--> statement-breakpoint
CREATE POLICY firm_write ON meeting_notes FOR ALL TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id) AND app_label_ok(visibility, org_id, author_id))
  WITH CHECK (app_org_kind() = 'firm' AND app_can_see_project(project_id) AND app_label_ok(visibility, org_id, author_id)
    AND author_id = app_uid());
--> statement-breakpoint
DROP POLICY scoped ON follow_ups;
--> statement-breakpoint
CREATE POLICY scoped_read ON follow_ups FOR SELECT TO selah_app
  USING (app_can_see_project(project_id) AND app_label_ok(visibility, org_id, created_by));
--> statement-breakpoint
CREATE POLICY firm_write ON follow_ups FOR ALL TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id) AND app_label_ok(visibility, org_id, created_by))
  WITH CHECK (app_org_kind() = 'firm' AND app_can_see_project(project_id) AND app_label_ok(visibility, org_id, created_by));
--> statement-breakpoint
DROP POLICY scoped ON reports;
--> statement-breakpoint
CREATE POLICY scoped_read ON reports FOR SELECT TO selah_app
  USING (app_can_see_project(project_id) AND app_label_ok(visibility, org_id, generated_by));
--> statement-breakpoint
CREATE POLICY firm_write ON reports FOR ALL TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id))
  WITH CHECK (app_org_kind() = 'firm' AND app_can_see_project(project_id) AND app_label_ok(visibility, org_id, generated_by));
--> statement-breakpoint

-- A periodic report's numbers are frozen once issued: only sharing it (its
-- label and shared_at) may change, and it is never deleted. A correction is
-- a new report.
CREATE FUNCTION freeze_report() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.metrics IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - '{visibility,shared_at}'::text[]) <> (to_jsonb(OLD) - '{visibility,shared_at}'::text[]) THEN
    RAISE EXCEPTION 'an issued report cannot change; write a new one' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER report_frozen BEFORE UPDATE OR DELETE ON reports FOR EACH ROW EXECUTE FUNCTION freeze_report();
--> statement-breakpoint

-- ----------------------------------------------- 2. closure and the workflow

-- status::text: 'closed' was added to the enum in this same migration run,
-- and Postgres does not allow the new value as an enum literal until commit.
ALTER TABLE actions ADD CONSTRAINT closure_matches_status CHECK ((status::text = 'closed') = (closure_outcome IS NOT NULL));
--> statement-breakpoint
ALTER TABLE actions ADD CONSTRAINT superseded_names_successor CHECK (
  (closure_outcome = 'superseded') = (superseded_by IS NOT NULL) AND superseded_by IS DISTINCT FROM id
);
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
-- New actions start without a closure, and the database keeps the
-- timestamps the rules above rely on.
CREATE FUNCTION check_action_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_uid() IS NOT NULL AND NEW.status NOT IN ('draft', 'assigned') THEN
    RAISE EXCEPTION 'a new action starts as draft or assigned' USING ERRCODE = 'check_violation';
  END IF;
  NEW.awaiting_review_at := CASE WHEN NEW.status = 'awaiting_review' THEN now() END;
  NEW.reopened_at := NULL;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER action_insert BEFORE INSERT ON actions FOR EACH ROW EXECUTE FUNCTION check_action_insert();
--> statement-breakpoint
-- An owner works on the project: an active member of the project's org (the
-- client, or the firm for internal projects) who is staffed on it. Checked
-- for app users; jobs and seeds are trusted.
CREATE FUNCTION check_action_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_uid() IS NULL OR NEW.owner_user_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM org_memberships m JOIN project_members pm ON pm.user_id = m.user_id AND pm.project_id = NEW.project_id
    WHERE m.user_id = NEW.owner_user_id AND m.org_id = NEW.org_id AND m.active
  ) THEN
    RAISE EXCEPTION 'the owner must be an active member of the project team' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER action_owner BEFORE INSERT OR UPDATE OF owner_user_id ON actions FOR EACH ROW EXECUTE FUNCTION check_action_owner();
--> statement-breakpoint

-- A named client person (admin or manager) signs that they accept the risk.
GRANT SELECT, INSERT ON risk_acceptances TO selah_app;
--> statement-breakpoint
ALTER TABLE risk_acceptances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY scoped_read ON risk_acceptances FOR SELECT TO selah_app USING (app_can_see_project(project_id));
--> statement-breakpoint
CREATE POLICY client_sign ON risk_acceptances FOR INSERT TO selah_app WITH CHECK (
  app_can_see_project(project_id) AND accepted_by = app_uid() AND org_id = app_org()
  AND app_org_kind() = 'client' AND app_role() IN ('client_admin', 'client_manager')
  AND EXISTS (SELECT 1 FROM actions a WHERE a.id = action_id AND a.project_id = risk_acceptances.project_id)
);
--> statement-breakpoint

-- ------------------------------------------------------- 3. evidence lists

GRANT SELECT, INSERT, UPDATE, DELETE ON evidence_requests TO selah_app;
--> statement-breakpoint
ALTER TABLE evidence_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY scoped_read ON evidence_requests FOR SELECT TO selah_app USING (app_can_see_project(project_id));
--> statement-breakpoint
CREATE POLICY firm_write ON evidence_requests FOR ALL TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id))
  WITH CHECK (app_org_kind() = 'firm' AND app_can_see_project(project_id));
--> statement-breakpoint
CREATE FUNCTION check_evidence_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM actions a WHERE a.id = NEW.action_id AND a.project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'the evidence request must belong to an action of its project' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'open';
    NEW.decided_by := NULL;
    NEW.decided_at := NULL;
    RETURN NEW;
  END IF;
  IF NEW.action_id <> OLD.action_id OR NEW.project_id <> OLD.project_id THEN
    RAISE EXCEPTION 'an evidence request cannot move' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    -- Accepted and waived are final. Only a submitted file can be accepted
    -- or rejected: the firm cannot accept an item nobody answered.
    IF (NEW.status IN ('accepted', 'rejected') AND OLD.status = 'submitted')
       OR (NEW.status = 'waived' AND OLD.status IN ('open', 'submitted', 'rejected')) THEN
      NEW.decided_by := app_uid();
      NEW.decided_at := now();
    ELSIF NEW.status = 'open' AND OLD.status = 'rejected' THEN
      NULL; -- asked again
    ELSIF NEW.status = 'submitted' AND app_uid() IS NULL THEN
      NULL; -- set by link_submission_to_request()
    ELSE
      RAISE EXCEPTION 'invalid evidence request change % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER evidence_request_rules BEFORE INSERT OR UPDATE ON evidence_requests
  FOR EACH ROW EXECUTE FUNCTION check_evidence_request();
--> statement-breakpoint
ALTER TABLE evidence_requests ADD CONSTRAINT waiver_explained CHECK (status <> 'waived' OR decision_note IS NOT NULL);
--> statement-breakpoint
-- A file answering an item marks it submitted; the item must be the action's.
CREATE FUNCTION link_submission_to_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid text := current_setting('selah.user_id', true);
BEGIN
  IF NEW.evidence_request_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM evidence_requests er
    WHERE er.id = NEW.evidence_request_id AND er.action_id = NEW.action_id AND er.status IN ('open', 'rejected', 'submitted')
  ) THEN
    RAISE EXCEPTION 'that evidence request is not open on this action' USING ERRCODE = 'check_violation';
  END IF;
  -- Only a file that passed the virus scan (or was stored with scanning off)
  -- answers an item.
  IF NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = NEW.document_id AND d.scan_status IN ('clean', 'skipped')) THEN
    RAISE EXCEPTION 'the file has not passed the virus scan' USING ERRCODE = 'check_violation';
  END IF;
  -- Run the status change as the system, not as the client.
  PERFORM set_config('selah.user_id', '', true);
  UPDATE evidence_requests SET status = 'submitted' WHERE id = NEW.evidence_request_id AND status <> 'submitted';
  PERFORM set_config('selah.user_id', coalesce(uid, ''), true);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER submission_links_request BEFORE INSERT ON evidence_submissions
  FOR EACH ROW EXECUTE FUNCTION link_submission_to_request();
--> statement-breakpoint

-- --------------------------------------------------- firm-only action notes

GRANT SELECT, INSERT ON action_notes TO selah_app;
--> statement-breakpoint
ALTER TABLE action_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY firm_read ON action_notes FOR SELECT TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id));
--> statement-breakpoint
CREATE POLICY firm_insert ON action_notes FOR INSERT TO selah_app
  WITH CHECK (app_org_kind() = 'firm' AND app_can_see_project(project_id) AND author_id = app_uid()
    AND EXISTS (SELECT 1 FROM actions a WHERE a.id = action_id AND a.project_id = action_notes.project_id));
--> statement-breakpoint

-- ---------------------------------------------- 4. deadline change requests

DROP POLICY scoped ON deadline_change_requests;
--> statement-breakpoint
CREATE POLICY scoped_read ON deadline_change_requests FOR SELECT TO selah_app USING (app_can_see_project(project_id));
--> statement-breakpoint
-- The action's owner, the client's managers and admins, or the firm ask.
CREATE POLICY request ON deadline_change_requests FOR INSERT TO selah_app
  WITH CHECK (app_can_see_project(project_id) AND requested_by = app_uid() AND status = 'pending' AND decided_by IS NULL
    AND (app_org_kind() = 'firm' OR app_role() IN ('client_admin', 'client_manager')
         OR EXISTS (SELECT 1 FROM actions a WHERE a.id = action_id AND a.owner_user_id = app_uid())));
--> statement-breakpoint
CREATE POLICY firm_decide ON deadline_change_requests FOR UPDATE TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id))
  WITH CHECK (app_org_kind() = 'firm' AND app_can_see_project(project_id));
--> statement-breakpoint
REVOKE DELETE ON deadline_change_requests FROM selah_app;
--> statement-breakpoint
CREATE FUNCTION decide_deadline_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM actions a WHERE a.id = NEW.action_id AND a.project_id = NEW.project_id
                   AND a.status NOT IN ('verified_complete', 'closed')) THEN
      RAISE EXCEPTION 'deadline changes are for open actions of the project' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.proposed_due_date IS NOT DISTINCT FROM (SELECT a.due_date FROM actions a WHERE a.id = NEW.action_id)
       OR NEW.proposed_due_date < (now() AT TIME ZONE 'Asia/Riyadh')::date THEN
      RAISE EXCEPTION 'propose a new date, from today on' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'a decided request is final' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'pending' OR NEW.proposed_due_date <> OLD.proposed_due_date OR NEW.reason <> OLD.reason
     OR NEW.action_id <> OLD.action_id OR NEW.project_id <> OLD.project_id OR NEW.requested_by <> OLD.requested_by THEN
    RAISE EXCEPTION 'only the decision can change' USING ERRCODE = 'check_violation';
  END IF;
  NEW.decided_by := app_uid();
  NEW.decided_at := now();
  IF NEW.status = 'approved' THEN
    UPDATE actions SET due_date = NEW.proposed_due_date WHERE id = NEW.action_id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER deadline_request_rules BEFORE INSERT OR UPDATE ON deadline_change_requests
  FOR EACH ROW EXECUTE FUNCTION decide_deadline_request();
--> statement-breakpoint

-- ---------------------------------------------- 5. reminders and escalation

-- Nobody reads or writes the log through the app; the reminder job does.
ALTER TABLE follow_up_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Actions whose ball is in the owner's court (not waiting on the firm).
CREATE FUNCTION app_owner_holds(st action_status) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT st IN ('assigned', 'in_progress', 'blocked', 'revision_requested')
$$;
--> statement-breakpoint
-- What the reminder job should send today, not yet sent:
--   level 0 "due_soon": the owner, remind_days_before the due date
--   level 1 "overdue":  the owner, from the day after the due date
--   level 2 "overdue":  + the client's managers on the project and the
--                       firm's lead (client lead, or internal project leads)
--   level 3 "overdue":  + the client's admins and the watching firm admins
-- Only active members are included. Runs as the job (owner), not the app.
CREATE FUNCTION app_follow_ups_due(today date)
RETURNS TABLE (action_id uuid, project_id uuid, kind follow_up_kind, level integer, due_date date, recipients uuid[])
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH open_actions AS (
    SELECT a.id, a.project_id, a.org_id, a.owner_user_id, a.due_date, p.kind AS project_kind, p.firm_org_id,
           EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = a.owner_user_id AND m.org_id = a.org_id AND m.active) AS owner_active,
           p.remind_days_before, p.escalate_level2_days, p.escalate_level3_days,
           today - a.due_date AS days_over
    FROM actions a JOIN projects p ON p.id = a.project_id
    WHERE a.due_date IS NOT NULL AND a.owner_user_id IS NOT NULL AND app_owner_holds(a.status) AND p.state = 'active'
  ),
  ladder AS (
    SELECT o.*, 'due_soon'::follow_up_kind AS kind, 0 AS step FROM open_actions o
      WHERE o.days_over BETWEEN -o.remind_days_before AND 0
    UNION ALL
    SELECT o.*, 'overdue'::follow_up_kind,
      CASE WHEN o.days_over >= o.escalate_level3_days THEN 3 WHEN o.days_over >= o.escalate_level2_days THEN 2 ELSE 1 END
    FROM open_actions o WHERE o.days_over > 0
  ),
  -- An owner who has left cannot be reminded: go straight to level 2.
  steps AS (
    SELECT l.*, CASE WHEN l.owner_active THEN l.step ELSE greatest(l.step, 2) END AS level FROM ladder l
  ),
  people AS (
    SELECT s.id, s.kind, s.level, s.owner_user_id AS u FROM steps s WHERE s.owner_active
    UNION
    -- level 2+: client managers staffed on the project, and the firm's lead
    SELECT s.id, s.kind, s.level, pm.user_id FROM steps s
      JOIN project_members pm ON pm.project_id = s.project_id
      JOIN org_memberships m ON m.user_id = pm.user_id AND m.org_id = s.org_id AND m.active AND m.role = 'client_manager'
      WHERE s.level >= 2 AND s.project_kind = 'client'
    UNION
    SELECT s.id, s.kind, s.level, ca.user_id FROM steps s
      JOIN client_assignments ca ON ca.client_org_id = s.org_id AND ca.is_lead
      JOIN org_memberships m ON m.user_id = ca.user_id AND m.org_id = s.firm_org_id AND m.active
      WHERE s.level >= 2 AND s.project_kind = 'client'
    UNION
    SELECT s.id, s.kind, s.level, pm.user_id FROM steps s
      JOIN project_members pm ON pm.project_id = s.project_id AND pm.is_lead
      JOIN org_memberships m ON m.user_id = pm.user_id AND m.org_id = s.firm_org_id AND m.active
      WHERE s.level >= 2 AND s.project_kind = 'internal'
    UNION
    -- level 3: the client's admins and the watching firm admins
    SELECT s.id, s.kind, s.level, m.user_id FROM steps s
      JOIN org_memberships m ON m.org_id = s.org_id AND m.active AND m.role = 'client_admin'
      WHERE s.level >= 3 AND s.project_kind = 'client'
    UNION
    SELECT s.id, s.kind, s.level, w.user_id FROM steps s
      JOIN watches w ON w.project_id = s.project_id OR (s.project_kind = 'client' AND w.client_org_id = s.org_id)
      JOIN org_memberships m ON m.user_id = w.user_id AND m.org_id = s.firm_org_id AND m.active AND m.role = 'firm_admin'
      WHERE s.level >= 3
  )
  SELECT s.id, s.project_id, s.kind, s.level, s.due_date,
         coalesce((SELECT array_agg(DISTINCT p.u ORDER BY p.u) FROM people p WHERE p.id = s.id AND p.kind = s.kind AND p.level = s.level), '{}')
  FROM steps s
  WHERE NOT EXISTS (
    SELECT 1 FROM follow_up_log l
    WHERE l.action_id = s.id AND l.kind = s.kind AND l.level = s.level AND l.due_date = s.due_date
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_follow_ups_due(date) FROM PUBLIC;
--> statement-breakpoint

-- ------------------------------------------------ 6. implementation progress

-- Progress of a project's actions as the caller sees them (row-level
-- security applies: this runs with the caller's rights).
--   implemented_pct = verified / (released actions that still apply) * 100
-- "Still apply" leaves out not-applicable and superseded actions. Partially
-- implemented is counted next to it, not given made-up partial credit; a risk
-- the client accepted counts as not implemented. It is not called compliance:
-- it measures the plan, not the law.
-- (closure_outcome is set exactly when status is closed.)
CREATE FUNCTION app_project_progress(pid uuid, today date DEFAULT current_date)
RETURNS TABLE (
  total integer, verified integer, partially integer, risk_accepted integer, not_applicable integer,
  superseded integer, open integer, overdue integer, implemented_pct numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH a AS (SELECT * FROM actions WHERE project_id = pid AND status <> 'draft')
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE status = 'verified_complete')::int,
    count(*) FILTER (WHERE closure_outcome = 'partially_implemented')::int,
    count(*) FILTER (WHERE closure_outcome = 'risk_accepted')::int,
    count(*) FILTER (WHERE closure_outcome = 'not_applicable')::int,
    count(*) FILTER (WHERE closure_outcome = 'superseded')::int,
    count(*) FILTER (WHERE closure_outcome IS NULL AND status <> 'verified_complete')::int,
    count(*) FILTER (WHERE closure_outcome IS NULL AND status <> 'verified_complete' AND due_date < today)::int,
    round(100.0 * count(*) FILTER (WHERE status = 'verified_complete') / nullif(count(*) FILTER (WHERE closure_outcome IS NULL OR closure_outcome NOT IN ('not_applicable', 'superseded')), 0), 1)
  FROM a
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_project_progress(uuid, date) TO selah_app;
--> statement-breakpoint

-- -------------------------------------------- telling the firm-side team

-- Two more events reach the project's firm-side audience, each only when the
-- caller really caused it: a client signing a risk acceptance, and an owner
-- asking for a new deadline.
CREATE OR REPLACE FUNCTION app_notify_project_team(act uuid, note_kind text, skip uuid[]) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pid uuid; st action_status; n integer;
BEGIN
  SELECT a.project_id, a.status INTO pid, st FROM actions a WHERE a.id = act;
  IF pid IS NULL OR NOT app_can_see_project(pid) THEN
    RAISE EXCEPTION 'action not visible' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (
    (note_kind = 'action.awaiting_review' AND st = 'awaiting_review')
    OR (note_kind = 'risk.accepted' AND EXISTS (
      SELECT 1 FROM risk_acceptances ra WHERE ra.action_id = act AND ra.accepted_by = app_uid()))
    OR (note_kind = 'deadline.requested' AND EXISTS (
      SELECT 1 FROM deadline_change_requests d WHERE d.action_id = act AND d.requested_by = app_uid() AND d.status = 'pending'))
  ) THEN
    RAISE EXCEPTION 'notification does not match the action' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT u, note_kind, 'action', act FROM app_project_audience(pid) u
    WHERE u <> app_uid() AND NOT (u = ANY (coalesce(skip, '{}')));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
