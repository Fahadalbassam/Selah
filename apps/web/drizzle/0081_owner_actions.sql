-- An action owner reads only the actions they own, enforced in the database
-- (decision 1b, product owner, 17 Nov 2026). authorize() already grants
-- action.read to owners as "assigned"; the row rules on actions still let an
-- owner read every action of their projects that the department rule allows,
-- so every query that forgot to narrow (the Files card, translations, the mute
-- list, the "replaced by" line, notices, project progress, the schedule,
-- follow-ups) named a colleague's action. Now the database agrees with
-- authorize(): no title, no row, no count.
--
-- The rule follows the person's role: someone whose role is action_owner reads
-- an action only while owner_user_id is them. A former owner (after a hand-
-- over) no longer reads it; files they uploaded stay theirs (documents keep
-- their own rule: own uploads, the department's files, files shared one by
-- one). Every other role is unchanged. Like the department and draft rules,
-- it is one RESTRICTIVE policy per table, so no permissive rule is rewritten
-- and no read or write path skips it.
--
-- 1. The rule for anyone: false only when `target` is an action owner and the
--    action is not theirs. A row that names no action (NULL) keeps its own
--    rules; an action that no longer exists is nobody's. Used past row-level
--    security (the summary mail runs as the schema owner), so not granted.
CREATE FUNCTION app_action_owner_ok(target uuid, aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT aid IS NULL
    OR NOT EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = target AND m.role = 'action_owner')
    OR EXISTS (SELECT 1 FROM actions a WHERE a.id = aid AND a.owner_user_id = target)
$$;
--> statement-breakpoint
-- The same for the caller, which is what the row policies ask.
CREATE FUNCTION app_owner_reads_action(aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_action_owner_ok(app_uid(), aid)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_action_owner_ok(uuid, uuid), app_owner_reads_action(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_owner_reads_action(uuid) TO selah_app;
--> statement-breakpoint
-- 2. The action itself.
CREATE POLICY owner ON actions AS RESTRICTIVE FOR ALL TO selah_app
  USING (owner_user_id = app_uid() OR app_role() IS DISTINCT FROM 'action_owner')
  WITH CHECK (owner_user_id = app_uid() OR app_role() IS DISTINCT FROM 'action_owner');
--> statement-breakpoint
-- 3. Everything under it: progress, evidence and the evidence list, reviews
--    and sign-offs, risk acceptances, date requests and due-date history,
--    firm notes, the discussion, reminders, mail mutes and closure items.
--    (follow_up_log, the reminder log, has no grant to the app at all.)
CREATE POLICY owner ON progress_updates AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_owner_reads_action(action_id)) WITH CHECK (app_owner_reads_action(action_id));
--> statement-breakpoint
CREATE POLICY owner ON evidence_submissions AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_owner_reads_action(action_id)) WITH CHECK (app_owner_reads_action(action_id));
--> statement-breakpoint
CREATE POLICY owner ON evidence_requests AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_owner_reads_action(action_id)) WITH CHECK (app_owner_reads_action(action_id));
--> statement-breakpoint
CREATE POLICY owner ON reviews AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_owner_reads_action(action_id)) WITH CHECK (app_owner_reads_action(action_id));
--> statement-breakpoint
CREATE POLICY owner ON review_signoffs AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_owner_reads_action(action_id)) WITH CHECK (app_owner_reads_action(action_id));
--> statement-breakpoint
CREATE POLICY owner ON risk_acceptances AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_owner_reads_action(action_id)) WITH CHECK (app_owner_reads_action(action_id));
--> statement-breakpoint
CREATE POLICY owner ON deadline_change_requests AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_owner_reads_action(action_id)) WITH CHECK (app_owner_reads_action(action_id));
--> statement-breakpoint
CREATE POLICY owner ON action_due_changes AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_owner_reads_action(action_id)) WITH CHECK (app_owner_reads_action(action_id));
--> statement-breakpoint
CREATE POLICY owner ON action_notes AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_owner_reads_action(action_id)) WITH CHECK (app_owner_reads_action(action_id));
--> statement-breakpoint
CREATE POLICY owner ON action_comments AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_owner_reads_action(action_id)) WITH CHECK (app_owner_reads_action(action_id));
--> statement-breakpoint
CREATE POLICY owner ON action_reminders AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_owner_reads_action(action_id)) WITH CHECK (app_owner_reads_action(action_id));
--> statement-breakpoint
CREATE POLICY owner ON mail_mutes AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_owner_reads_action(action_id)) WITH CHECK (app_owner_reads_action(action_id));
--> statement-breakpoint
CREATE POLICY owner ON project_closure_items AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_owner_reads_action(action_id)) WITH CHECK (app_owner_reads_action(action_id));
--> statement-breakpoint
-- A follow-up about a colleague's action is not the owner's to read, unless
-- it is assigned to them: they have to do it (its own title, never the
-- action's). A follow-up about no action keeps its own rules (a meeting's).
CREATE POLICY owner ON follow_ups AS RESTRICTIVE FOR ALL TO selah_app
  USING (coalesce(assignee_user_id = app_uid(), false) OR app_owner_reads_action(action_id))
  WITH CHECK (coalesce(assignee_user_id = app_uid(), false) OR app_owner_reads_action(action_id));
--> statement-breakpoint
-- 4. What names an action from elsewhere: the activity record (already firm
--    and client admin only, 0071), notices, and translations of its text.
--    (Translations of an update or a comment are read with their source under
--    the caller's own rules, app_translation_current, so the policies above
--    reach them. The assistant's passages of an action are read only while
--    the action itself can be read: with_source on ai_chunks, and owners
--    never have the assistant: app_set_client_ai refuses them.)
CREATE POLICY owner ON activity_events AS RESTRICTIVE FOR ALL TO selah_app
  USING (entity_type <> 'action' OR app_owner_reads_action(entity_id))
  WITH CHECK (entity_type <> 'action' OR app_owner_reads_action(entity_id));
--> statement-breakpoint
CREATE POLICY owner ON content_translations AS RESTRICTIVE FOR ALL TO selah_app
  USING (entity_type <> 'action' OR app_owner_reads_action(entity_id))
  WITH CHECK (entity_type <> 'action' OR app_owner_reads_action(entity_id));
--> statement-breakpoint
-- A notice is read by its recipient only (policy own). One about an action
-- an owner does not own (a former owner's, after a hand-over) is hidden, not
-- deleted.
CREATE POLICY owner ON notifications AS RESTRICTIVE FOR SELECT TO selah_app
  USING (entity_type <> 'action' OR app_owner_reads_action(entity_id));
--> statement-breakpoint
-- New notices about a colleague's action are not stored for an owner (the
-- reminder ladder tells a department's head at level 2, and a head may be an
-- action owner). "Assigned" is always to the person who now owns it, and is
-- written in the same statement as the hand-over (app_hand_over), so it is
-- not checked here. Otherwise as 0076.
CREATE OR REPLACE FUNCTION drop_hidden_action_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- About an action under a firm-only recommendation (0006), or a draft (D6):
  -- only the firm is told. Its owner hears of a draft when it is released.
  IF NEW.entity_type = 'action'
     AND EXISTS (SELECT 1 FROM actions a JOIN recommendations r ON r.id = a.recommendation_id
                 WHERE a.id = NEW.entity_id AND (r.visibility <> 'shared' OR a.status = 'draft'))
     AND NOT EXISTS (SELECT 1 FROM org_memberships m JOIN organizations o ON o.id = m.org_id
                     WHERE m.user_id = NEW.user_id AND o.kind = 'firm') THEN
    RETURN NULL;
  END IF;
  -- About a colleague's action, for an action owner (1b).
  IF NEW.entity_type = 'action' AND NEW.kind <> 'action.assigned'
     AND EXISTS (SELECT 1 FROM actions a WHERE a.id = NEW.entity_id AND a.owner_user_id IS DISTINCT FROM NEW.user_id)
     AND NOT app_action_owner_ok(NEW.user_id, NEW.entity_id) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- The summary mail (latest definition: 0078_drafts_review), with the same
-- rule, so a hidden notice never queues a "you have something new" mail.
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
      -- Nor one about an action an owner does not own (1b).
      AND NOT (x.entity_type = 'action' AND NOT app_action_owner_ok(x.user_id, x.entity_id))
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
-- 5. The functions that read actions past row-level security, where an owner
--    can reach them.
--
-- Whether the caller can see an action (latest: 0076): the guard of the
-- reminder ladder, the people on an action, due-date moves and extensions,
-- refilings and the discussion.
CREATE OR REPLACE FUNCTION app_can_see_action(aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT app_can_see_project(a.project_id) AND app_recommendation_label_ok(a.recommendation_id) AND app_action_dept_ok(a.id)
      AND (a.status <> 'draft' OR app_org_kind() = 'firm')
      AND (app_role() IS DISTINCT FROM 'action_owner' OR coalesce(a.owner_user_id = app_uid(), false))
    FROM actions a WHERE a.id = aid
  ), false)
$$;
--> statement-breakpoint
-- The second sign-off state of an action (latest: 0076): nothing about a
-- colleague's action for an owner.
CREATE OR REPLACE FUNCTION app_second_review_state(aid uuid)
RETURNS TABLE (required boolean, reason text, rule second_review_rule, flagged boolean, revisions integer,
               signed_by uuid, signed_by_name text, signed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_action_needs_second_review(a.id),
    CASE
      WHEN NOT app_action_needs_second_review(a.id) THEN NULL
      WHEN a.second_review THEN 'flag'
      WHEN s.rule = 'all' THEN 'all'
      WHEN s.rule = 'high_priority' AND r.priority IN ('high', 'critical') THEN 'high_priority'
      ELSE 'repeat_revisions'
    END,
    CASE WHEN p.kind = 'client' THEN coalesce(s.rule, 'off') END,
    a.second_review,
    rev.n::int,
    so.reviewer_id, u.name, so.created_at
  FROM actions a
    JOIN projects p ON p.id = a.project_id
    JOIN recommendations r ON r.id = a.recommendation_id
    LEFT JOIN client_review_settings s ON s.client_org_id = a.org_id AND p.kind = 'client'
    CROSS JOIN LATERAL (
      SELECT count(*) AS n FROM reviews v
      WHERE v.action_id = a.id AND v.outcome = 'revise' AND v.created_at >= coalesce(a.reopened_at, '-infinity')
    ) rev
    LEFT JOIN LATERAL (
      SELECT x.reviewer_id, x.created_at FROM review_signoffs x
      WHERE x.action_id = a.id AND a.status = 'awaiting_review' AND x.created_at >= coalesce(a.awaiting_review_at, '-infinity')
      ORDER BY x.created_at DESC LIMIT 1
    ) so ON true
    LEFT JOIN "user" u ON u.id = so.reviewer_id
  WHERE a.id = aid AND app_can_see_project(a.project_id)
    AND (a.status <> 'draft' OR app_org_kind() = 'firm')
    AND app_owner_reads_action(a.id)
$$;
--> statement-breakpoint
-- The recommendation page's "N more" line (latest: 0069). An owner is told
-- nothing about the others, not even how many: 0 for an owner, as for an id
-- the caller cannot read. A department-limited manager keeps the count.
CREATE OR REPLACE FUNCTION app_actions_left_out(rec uuid, shown uuid[]) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int
  FROM actions a JOIN recommendations r ON r.id = a.recommendation_id
  WHERE r.id = rec
    AND app_can_see_project(r.project_id) AND app_label_ok(r.visibility, r.org_id, r.created_by)
    AND (app_dept_ok(r.department_id, r.org_id) OR r.accountable_user_id = app_uid() OR app_owns_action_under(r.id))
    AND NOT (a.id = ANY (coalesce(shown, '{}'::uuid[])))
    AND (a.status <> 'draft' OR app_org_kind() = 'firm')
    AND app_role() IS DISTINCT FROM 'action_owner'
$$;
--> statement-breakpoint
-- Findings answered in another department (latest: 0069) are counted for the
-- people who read findings: the firm, the client's admins and managers. An
-- action owner reads no finding, so gets no count (review of #156, note 10).
CREATE OR REPLACE FUNCTION app_findings_answered_elsewhere(pid uuid) RETURNS TABLE (finding_id uuid, n integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.finding_id, count(*)::int
  FROM recommendations r JOIN findings f ON f.id = r.finding_id
  WHERE r.project_id = pid AND r.withdrawn_at IS NULL
    AND app_can_see_project(pid)
    AND app_role() IS DISTINCT FROM 'action_owner'
    AND app_label_ok(f.visibility, f.org_id, f.created_by)
    AND app_label_ok(r.visibility, r.org_id, r.created_by)
    AND NOT (app_dept_ok(r.department_id, r.org_id) OR coalesce(r.accountable_user_id = app_uid(), false) OR app_owns_action_under(r.id))
  GROUP BY r.finding_id
$$;
