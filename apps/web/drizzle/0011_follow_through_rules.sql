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
CREATE POLICY firm_delete ON actions FOR DELETE TO selah_app USING (app_org_kind() = 'firm' AND app_can_see_project(project_id));
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
BEGIN
  NEW.updated_at := now();

  -- Client users move their actions and (managers) assign owners; the plan
  -- itself is the firm's. Jobs and migrations (no user) are not limited.
  IF is_client AND (
    NEW.project_id <> OLD.project_id OR NEW.org_id <> OLD.org_id OR NEW.recommendation_id IS DISTINCT FROM OLD.recommendation_id
    OR NEW.title <> OLD.title OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.due_date IS DISTINCT FROM OLD.due_date OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.closure_outcome IS DISTINCT FROM OLD.closure_outcome OR NEW.closure_note IS DISTINCT FROM OLD.closure_note
    OR NEW.closed_by IS DISTINCT FROM OLD.closed_by OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
    OR NEW.superseded_by IS DISTINCT FROM OLD.superseded_by
    OR (NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id AND app_role() NOT IN ('client_admin', 'client_manager'))
  ) THEN
    RAISE EXCEPTION 'clients can only move an action through its workflow' USING ERRCODE = 'insufficient_privilege';
  END IF;

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

  IF NEW.status = 'verified_complete' THEN
    IF COALESCE((
      SELECT r.outcome FROM reviews r WHERE r.action_id = NEW.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1
    ), 'reject') <> 'accept' THEN
      RAISE EXCEPTION 'verified_complete needs an accept review' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM evidence_requests er WHERE er.action_id = NEW.id AND er.status NOT IN ('accepted', 'waived')) THEN
      RAISE EXCEPTION 'every evidence request must be accepted or waived first' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status = 'closed' THEN
    IF NEW.closure_outcome = 'risk_accepted' AND NOT EXISTS (
      SELECT 1 FROM risk_acceptances ra
      WHERE ra.action_id = NEW.id AND app_user_org(ra.accepted_by) = NEW.org_id
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
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- New actions start without a closure.
CREATE FUNCTION check_action_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_uid() IS NOT NULL AND NEW.status NOT IN ('draft', 'assigned') THEN
    RAISE EXCEPTION 'a new action starts as draft or assigned' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER action_insert BEFORE INSERT ON actions FOR EACH ROW EXECUTE FUNCTION check_action_insert();
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
    -- Accepted and waived are final; only a submitted file can be rejected.
    IF (NEW.status IN ('accepted', 'waived') AND OLD.status IN ('open', 'submitted', 'rejected'))
       OR (NEW.status = 'rejected' AND OLD.status = 'submitted') THEN
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
CREATE POLICY request ON deadline_change_requests FOR INSERT TO selah_app
  WITH CHECK (app_can_see_project(project_id) AND requested_by = app_uid() AND status = 'pending' AND decided_by IS NULL);
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
           p.remind_days_before, p.escalate_level2_days, p.escalate_level3_days,
           today - a.due_date AS days_over
    FROM actions a JOIN projects p ON p.id = a.project_id
    WHERE a.due_date IS NOT NULL AND a.owner_user_id IS NOT NULL AND app_owner_holds(a.status) AND p.state = 'active'
  ),
  steps AS (
    SELECT o.*, 'due_soon'::follow_up_kind AS kind, 0 AS level FROM open_actions o
      WHERE o.days_over BETWEEN -o.remind_days_before AND 0
    UNION ALL
    SELECT o.*, 'overdue'::follow_up_kind,
      CASE WHEN o.days_over >= o.escalate_level3_days THEN 3 WHEN o.days_over >= o.escalate_level2_days THEN 2 ELSE 1 END
    FROM open_actions o WHERE o.days_over > 0
  ),
  people AS (
    SELECT s.id, s.kind, s.level, s.owner_user_id AS u FROM steps s
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
         (SELECT array_agg(DISTINCT p.u ORDER BY p.u) FROM people p WHERE p.id = s.id AND p.kind = s.kind AND p.level = s.level)
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
--   implemented_pct = (verified + half of partially implemented)
--                     / (released actions that still apply) * 100
-- "Still apply" leaves out not-applicable and superseded actions. A risk the
-- client accepted counts as not implemented: the work was not done. It is
-- not called compliance: it measures the plan, not the law.
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
    round(100.0 * (
      count(*) FILTER (WHERE status = 'verified_complete')
      + 0.5 * count(*) FILTER (WHERE closure_outcome = 'partially_implemented')
    ) / nullif(count(*) FILTER (WHERE closure_outcome IS NULL OR closure_outcome NOT IN ('not_applicable', 'superseded')), 0), 1)
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
