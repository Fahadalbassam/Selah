ALTER TABLE "project_members" ADD COLUMN "observer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_member_observer_not_lead" CHECK (NOT ("project_members"."observer" AND "project_members"."is_lead"));--> statement-breakpoint
-- A read-only observer on a project (wave 1, N6): a firm consultant (on a
-- client project, one on the client's team) who reads the record and adds
-- notes to actions but changes nothing else, never reviews, never owns
-- work and is left out of the team's work notifications. Whoever staffs
-- the project adds them (member_insert); the client's lead is never one.
CREATE FUNCTION app_observes_project(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = pid AND pm.user_id = app_uid() AND pm.observer)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_observes_project(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_observes_project(uuid) TO selah_app;
--> statement-breakpoint
CREATE FUNCTION check_project_observer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT NEW.observer THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM projects p JOIN org_memberships m ON m.org_id = p.firm_org_id AND m.user_id = NEW.user_id AND m.active AND m.role = 'consultant'
    WHERE p.id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'an observer is a consultant of the firm' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM projects p JOIN client_assignments ca ON ca.client_org_id = p.org_id AND ca.user_id = NEW.user_id AND ca.is_lead
    WHERE p.id = NEW.project_id AND p.kind = 'client'
  ) THEN
    RAISE EXCEPTION 'the client''s lead consultant works on its projects, not as an observer' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM actions a WHERE a.project_id = NEW.project_id AND a.owner_user_id = NEW.user_id AND app_action_open(a.status)
  ) THEN
    RAISE EXCEPTION 'hand over their open actions here before making them an observer' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER project_member_observer BEFORE INSERT OR UPDATE OF observer, user_id ON project_members
  FOR EACH ROW EXECUTE FUNCTION check_project_observer();
--> statement-breakpoint
-- Becoming the client's lead ends observing its projects.
CREATE FUNCTION end_observing_as_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.is_lead THEN
    UPDATE project_members pm SET observer = false FROM projects p
      WHERE p.id = pm.project_id AND p.org_id = NEW.client_org_id AND pm.user_id = NEW.user_id AND pm.observer;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER client_lead_not_observer AFTER INSERT OR UPDATE OF is_lead ON client_assignments
  FOR EACH ROW EXECUTE FUNCTION end_observing_as_lead();
--> statement-breakpoint
-- An observer writes nothing in the project's record, except notes on
-- actions (their comments) and leaving the team. Jobs are not limited.
CREATE FUNCTION check_not_observer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r jsonb;
  pids uuid[];
BEGIN
  IF app_uid() IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  FOREACH r IN ARRAY CASE TG_OP WHEN 'INSERT' THEN ARRAY[to_jsonb(NEW)] WHEN 'DELETE' THEN ARRAY[to_jsonb(OLD)]
                     ELSE ARRAY[to_jsonb(NEW), to_jsonb(OLD)] END LOOP
    IF TG_TABLE_NAME = 'document_shares' THEN
      pids := pids || (SELECT d.project_id FROM documents d WHERE d.id = (r ->> 'document_id')::uuid);
    ELSIF TG_TABLE_NAME = 'info_request_files' THEN
      pids := pids || (SELECT q.project_id FROM info_requests q WHERE q.id = (r ->> 'request_id')::uuid);
    ELSIF TG_TABLE_NAME = 'meeting_attendees' THEN
      pids := pids || (SELECT m.project_id FROM meetings m WHERE m.id = (r ->> 'meeting_id')::uuid);
    ELSE
      pids := pids || (r ->> 'project_id')::uuid;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM unnest(pids) pid WHERE app_observes_project(pid)) THEN
    RAISE EXCEPTION 'you observe this project; ask its lead to staff you to change anything' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  -- OBSERVER_READ_ONLY_TABLES in lib/observers.ts: what closing freezes, less action_notes and project_members.
  FOREACH t IN ARRAY ARRAY[
    'actions', 'assessments', 'assessment_answers', 'assessment_evidence', 'assessment_notes',
    'deadline_change_requests', 'document_shares', 'documents', 'engagement_deliverables', 'evidence_requests',
    'evidence_submissions', 'findings', 'info_request_files', 'info_requests', 'kpis', 'meeting_attendees', 'meeting_decisions', 'meeting_notes',
    'meeting_summaries', 'meeting_summary_sources', 'meeting_transcripts', 'meetings', 'progress_updates',
    'project_client_roles', 'project_closure_items', 'project_closure_lessons', 'project_closure_requests',
    'recommendation_kpis', 'recommendations', 'reports', 'reviews', 'risk_acceptances',
    'strategic_objectives'
  ] LOOP
    EXECUTE format('CREATE TRIGGER project_observer BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION check_not_observer()', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Observers own no actions or KPIs.
CREATE OR REPLACE FUNCTION check_action_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_uid() IS NULL OR NEW.owner_user_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM org_memberships m JOIN project_members pm ON pm.user_id = m.user_id AND pm.project_id = NEW.project_id AND NOT pm.observer
    WHERE m.user_id = NEW.owner_user_id AND m.org_id = NEW.org_id AND m.active
  ) THEN
    RAISE EXCEPTION 'the owner must be an active member of the project team' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_kpi() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM strategic_objectives o WHERE o.id = NEW.objective_id AND o.project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'the objective must be in the same project' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.owner_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM org_memberships m JOIN project_members pm ON pm.user_id = m.user_id AND pm.project_id = NEW.project_id AND NOT pm.observer
    WHERE m.user_id = NEW.owner_user_id AND m.org_id = NEW.org_id AND m.active
  ) THEN
    RAISE EXCEPTION 'the owner must be an active member of the project team' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- The team's work notifications (waiting for review, deadline requests,
-- closing) skip observers; they read the record when they choose.
CREATE OR REPLACE FUNCTION app_project_audience(pid uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT u FROM (
    SELECT ca.user_id AS u FROM projects p
      JOIN client_assignments ca ON ca.client_org_id = p.org_id AND ca.is_lead
      JOIN org_memberships m ON m.user_id = ca.user_id AND m.org_id = p.firm_org_id AND m.active AND m.role = 'consultant'
      WHERE p.id = pid AND p.kind = 'client'
    UNION
    SELECT pm.user_id FROM projects p JOIN project_members pm ON pm.project_id = p.id AND NOT pm.observer
      JOIN org_memberships m ON m.user_id = pm.user_id AND m.org_id = p.firm_org_id AND m.active
      WHERE p.id = pid AND (p.kind = 'client' OR pm.is_lead)
    UNION
    SELECT w.user_id FROM projects p
      JOIN watches w ON w.project_id = p.id OR (p.kind = 'client' AND w.client_org_id = p.org_id)
      JOIN org_memberships m ON m.user_id = w.user_id AND m.org_id = p.firm_org_id AND m.active AND m.role = 'firm_admin'
      WHERE p.id = pid
  ) audience
  WHERE app_can_see_project(pid)
$$;
--> statement-breakpoint
-- People leaving (0027): an observer never does a review, and whoever takes
-- over reviews or a project's lead stops observing it.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_person_holdings_of(uid uuid)
RETURNS TABLE (kind text, entity_id uuid, project_id uuid, org_id uuid, title text, detail text, blocking boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- open actions they own
  SELECT 'action', a.id, a.project_id, a.org_id, a.title, a.status::text, true
  FROM actions a JOIN projects p ON p.id = a.project_id
  WHERE a.owner_user_id = uid AND a.status NOT IN ('verified_complete', 'closed') AND p.state <> 'closed'
  UNION ALL
  -- clients they lead (prospects included: whoever pitched leads them)
  SELECT 'client_lead', o.id, NULL, o.id, o.name, o.name_ar, true
  FROM client_assignments ca JOIN organizations o ON o.id = ca.client_org_id
  WHERE ca.user_id = uid AND ca.is_lead AND o.status = 'active'
  UNION ALL
  -- projects they lead
  SELECT 'project_lead', p.id, p.id, p.org_id, p.title, p.state::text, true
  FROM project_members pm JOIN projects p ON p.id = pm.project_id
  WHERE pm.user_id = uid AND pm.is_lead AND p.state <> 'closed'
  UNION ALL
  -- work waiting for review that only they can do: they are staffed on the
  -- project or lead its client, and no other active firm person is (being
  -- on the client's team alone does not open its projects)
  SELECT 'review', a.id, a.project_id, a.org_id, a.title, NULL, true
  FROM actions a JOIN projects p ON p.id = a.project_id
  WHERE a.status = 'awaiting_review' AND p.state <> 'closed'
    AND EXISTS (
      SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = uid AND NOT pm.observer
      UNION ALL
      SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = p.org_id AND ca.user_id = uid AND ca.is_lead AND p.kind = 'client'
    )
    AND NOT EXISTS (
      SELECT 1 FROM (
        SELECT pm.user_id FROM project_members pm WHERE pm.project_id = p.id AND NOT pm.observer
        UNION
        SELECT ca.user_id FROM client_assignments ca WHERE ca.client_org_id = p.org_id AND ca.is_lead AND p.kind = 'client'
      ) other
      JOIN org_memberships m ON m.user_id = other.user_id AND m.org_id = p.firm_org_id AND m.active
      WHERE other.user_id <> uid
    )
  UNION ALL
  -- named client roles (sponsor, coordinator, ...)
  SELECT 'client_role', r.id, r.project_id, r.org_id, p.title, r.role::text, false
  FROM project_client_roles r JOIN projects p ON p.id = r.project_id
  WHERE r.user_id = uid AND p.state <> 'closed'
  UNION ALL
  -- departments they head
  SELECT 'department_head', d.id, NULL, d.org_id, coalesce(d.name_en, d.name_ar), d.name_ar, false
  FROM department_members dm JOIN departments d ON d.id = dm.department_id
  WHERE dm.user_id = uid AND dm.is_head
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_hand_over(from_uid uuid, to_uid uuid, kinds text[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  org uuid;
  moved integer := 0;
  k integer;
  counts jsonb := '{}'::jsonb;
  r record;
BEGIN
  IF NOT app_can_manage_person(from_uid) THEN
    RAISE EXCEPTION 'not visible' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF from_uid = to_uid THEN
    RAISE EXCEPTION 'hand over to someone else' USING ERRCODE = 'check_violation';
  END IF;
  SELECT m.org_id INTO org FROM org_memberships m WHERE m.user_id = from_uid;
  IF NOT EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = to_uid AND m.org_id = org AND m.active) THEN
    RAISE EXCEPTION 'hand over to an active member of the same organisation' USING ERRCODE = 'check_violation';
  END IF;
  IF kinds <@ ARRAY['action', 'client_lead', 'project_lead', 'review', 'client_role'] IS NOT TRUE THEN
    RAISE EXCEPTION 'unknown kind of work' USING ERRCODE = 'check_violation';
  END IF;

  IF 'action' = ANY (kinds) THEN
    INSERT INTO project_members (project_id, user_id, added_by)
      SELECT DISTINCT h.project_id, to_uid, app_uid() FROM app_person_holdings_of(from_uid) h WHERE h.kind = 'action'
      ON CONFLICT DO NOTHING;
    WITH handed AS (
      UPDATE actions a SET owner_user_id = to_uid
        FROM app_person_holdings_of(from_uid) h WHERE h.kind = 'action' AND a.id = h.entity_id
        RETURNING a.id, a.status
    ), told AS (
      -- released work tells its new owner (and mails them, by their choices)
      INSERT INTO notifications (user_id, kind, entity_type, entity_id)
        SELECT to_uid, 'action.assigned', 'action', x.id FROM handed x WHERE app_action_open(x.status)
        RETURNING 1
    )
    SELECT count(*) INTO k FROM handed;
    moved := moved + k;
    counts := counts || jsonb_build_object('action', k);
  END IF;

  -- before the leads move: a new lead would no longer see these as sole reviews
  IF 'review' = ANY (kinds) THEN
    INSERT INTO project_members (project_id, user_id, added_by)
      SELECT DISTINCT h.project_id, to_uid, app_uid() FROM app_person_holdings_of(from_uid) h WHERE h.kind = 'review'
      ON CONFLICT (project_id, user_id) DO UPDATE SET observer = false;
    GET DIAGNOSTICS k = ROW_COUNT;
    moved := moved + k;
    counts := counts || jsonb_build_object('review', k);
  END IF;

  IF 'client_lead' = ANY (kinds) THEN
    k := 0;
    FOR r IN SELECT h.entity_id FROM app_person_holdings_of(from_uid) h WHERE h.kind = 'client_lead' LOOP
      UPDATE client_assignments SET is_lead = false WHERE client_org_id = r.entity_id AND user_id = from_uid;
      INSERT INTO client_assignments (client_org_id, user_id, is_lead, assigned_by) VALUES (r.entity_id, to_uid, true, app_uid())
        ON CONFLICT (client_org_id, user_id) DO UPDATE SET is_lead = true;
      k := k + 1;
    END LOOP;
    moved := moved + k;
    counts := counts || jsonb_build_object('client_lead', k);
  END IF;

  IF 'project_lead' = ANY (kinds) THEN
    k := 0;
    FOR r IN SELECT h.entity_id FROM app_person_holdings_of(from_uid) h WHERE h.kind = 'project_lead' LOOP
      UPDATE project_members SET is_lead = false WHERE project_id = r.entity_id AND user_id = from_uid;
      INSERT INTO project_members (project_id, user_id, is_lead, added_by) VALUES (r.entity_id, to_uid, true, app_uid())
        ON CONFLICT (project_id, user_id) DO UPDATE SET is_lead = true, observer = false;
      k := k + 1;
    END LOOP;
    moved := moved + k;
    counts := counts || jsonb_build_object('project_lead', k);
  END IF;

  IF 'client_role' = ANY (kinds) THEN
    k := 0;
    FOR r IN SELECT x.* FROM project_client_roles x JOIN app_person_holdings_of(from_uid) h ON h.kind = 'client_role' AND h.entity_id = x.id LOOP
      DELETE FROM project_client_roles WHERE id = r.id;
      IF NOT EXISTS (SELECT 1 FROM project_client_roles x WHERE x.project_id = r.project_id AND x.role = r.role AND x.user_id = to_uid) THEN
        INSERT INTO project_client_roles (project_id, org_id, role, user_id, created_by) VALUES (r.project_id, r.org_id, r.role, to_uid, app_uid());
      END IF;
      k := k + 1;
    END LOOP;
    moved := moved + k;
    counts := counts || jsonb_build_object('client_role', k);
  END IF;

  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
    VALUES (app_uid(), org, 'membership.hand_over', 'user', from_uid, 'allow', counts || jsonb_build_object('to', to_uid));
  RETURN moved;
END $$;
