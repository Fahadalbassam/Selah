CREATE TYPE "public"."closure_disposition" AS ENUM('handed_over', 'deferred', 'withdrawn', 'waived');--> statement-breakpoint
CREATE TYPE "public"."closure_request_status" AS ENUM('pending', 'accepted', 'declined');--> statement-breakpoint
ALTER TYPE "public"."project_state" ADD VALUE 'closing';--> statement-breakpoint
CREATE TABLE "project_closure_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"closure_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"disposition" "closure_disposition" NOT NULL,
	"note" text,
	"sustainer_user_id" uuid,
	"sustainer_contact_id" uuid,
	"decided_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closure_item_one_sustainer" CHECK (sustainer_user_id IS NULL OR sustainer_contact_id IS NULL),
	CONSTRAINT "closure_item_sustainer_handover" CHECK (disposition = 'handed_over' OR (sustainer_user_id IS NULL AND sustainer_contact_id IS NULL)),
	CONSTRAINT "closure_item_reason" CHECK (disposition = 'handed_over' OR length(btrim(coalesce(note, ''))) >= 3)
);
--> statement-breakpoint
CREATE TABLE "project_closure_lessons" (
	"closure_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"went_well" text NOT NULL,
	"to_improve" text NOT NULL,
	"next_time" text,
	"written_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_closure_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"requested_by" uuid,
	"note" text,
	"status" "closure_request_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"reply" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"reopened_by" uuid,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text
);
--> statement-breakpoint
ALTER TABLE "project_closure_items" ADD CONSTRAINT "project_closure_items_closure_id_project_closures_id_fk" FOREIGN KEY ("closure_id") REFERENCES "public"."project_closures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_closure_items" ADD CONSTRAINT "project_closure_items_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_closure_items" ADD CONSTRAINT "project_closure_items_sustainer_user_id_user_id_fk" FOREIGN KEY ("sustainer_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_closure_items" ADD CONSTRAINT "project_closure_items_sustainer_contact_id_client_contacts_id_fk" FOREIGN KEY ("sustainer_contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_closure_items" ADD CONSTRAINT "project_closure_items_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_closure_items" ADD CONSTRAINT "project_closure_items_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_closure_lessons" ADD CONSTRAINT "project_closure_lessons_closure_id_project_closures_id_fk" FOREIGN KEY ("closure_id") REFERENCES "public"."project_closures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_closure_lessons" ADD CONSTRAINT "project_closure_lessons_written_by_user_id_fk" FOREIGN KEY ("written_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_closure_lessons" ADD CONSTRAINT "project_closure_lessons_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_closure_requests" ADD CONSTRAINT "project_closure_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_closure_requests" ADD CONSTRAINT "project_closure_requests_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_closure_requests" ADD CONSTRAINT "project_closure_requests_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_closures" ADD CONSTRAINT "project_closures_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_closures" ADD CONSTRAINT "project_closures_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_closures" ADD CONSTRAINT "project_closures_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_closures" ADD CONSTRAINT "project_closures_reopened_by_user_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_closures" ADD CONSTRAINT "project_closures_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_closure_items_one" ON "project_closure_items" USING btree ("closure_id","action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_closure_requests_one_pending" ON "project_closure_requests" USING btree ("project_id") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "project_closures_one_open" ON "project_closures" USING btree ("project_id") WHERE cancelled_at IS NULL AND reopened_at IS NULL;--> statement-breakpoint
-- ------------------------------------------------------------- closing
-- Closing a project is a gate (full picture item 25, journey J12.3-J12.4).
-- The firm admin, or the lead of an internal project (N5), starts closing.
-- While it closes, every action still open gets a disposition (handed to a
-- named person who sustains it, deferred, withdrawn or waived with a reason),
-- every submission is reviewed, every deadline request decided and the firm
-- writes its lessons. Only then can it close. A closed project is read-only
-- for everyone; the firm admin reopens it with a reason. The client never
-- closes, but its sponsor or admin can ask the firm to (N9). State changes
-- go only through the functions below.

-- Who closes: the firm admin, or the lead of an internal project.
CREATE FUNCTION app_can_close_project(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = pid AND app_org_kind() = 'firm' AND p.firm_org_id = app_org()
      AND (app_role() = 'firm_admin' OR (p.kind = 'internal' AND app_is_project_lead(pid)))
  )
$$;
--> statement-breakpoint
-- The closing round under way (closing or closed), if any.
CREATE FUNCTION app_open_closure(pid uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id FROM project_closures c WHERE c.project_id = pid AND c.cancelled_at IS NULL AND c.reopened_at IS NULL
$$;
--> statement-breakpoint
-- A project's state changes to or from closing and closed only through the
-- closing functions, and a closed project's own record does not change.
-- Jobs and migrations (no user) are not limited.
CREATE FUNCTION check_project_state() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state::text IN ('closing', 'closed') THEN
      RAISE EXCEPTION 'a new project is not closing or closed' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state
     AND (OLD.state::text IN ('closing', 'closed') OR NEW.state::text IN ('closing', 'closed'))
     AND current_setting('selah.project_state', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'close or reopen a project through its closing steps' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state::text = 'closed' AND NEW.state::text = 'closed'
     AND (to_jsonb(NEW) - '{closed_at,minimal_purged_at}'::text[]) <> (to_jsonb(OLD) - '{closed_at,minimal_purged_at}'::text[]) THEN
    RAISE EXCEPTION 'this project is closed; the firm admin can reopen it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER project_state_gate BEFORE INSERT OR UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION check_project_state();
--> statement-breakpoint
-- No writes to a closed project's records. Check-ins and KPI readings stay
-- open (after-care follows closing), as do the assistant, translations,
-- visits and watches, which change nothing in the record. Jobs and the
-- deletion of an unsigned client are not limited.
CREATE FUNCTION check_project_open() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r jsonb;
  pids uuid[];
BEGIN
  IF app_uid() IS NULL OR (TG_OP = 'DELETE' AND current_setting('selah.discard', true) = 'on') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  -- Leaving a project stays possible after it closes.
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'project_members' THEN
    RETURN OLD;
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
  IF EXISTS (SELECT 1 FROM projects p WHERE p.id = ANY (pids) AND p.state::text = 'closed') THEN
    RAISE EXCEPTION 'this project is closed; the firm admin can reopen it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  -- The tables a closed project freezes (lib/closure.ts FROZEN_TABLES, checked by tests/db/closure.test.ts).
  FOREACH t IN ARRAY ARRAY[
    'actions', 'action_notes', 'assessments', 'assessment_answers', 'assessment_evidence', 'assessment_notes',
    'deadline_change_requests', 'document_shares', 'documents', 'engagement_deliverables', 'evidence_requests',
    'evidence_submissions', 'findings', 'info_request_files', 'info_requests', 'kpis', 'meeting_attendees', 'meeting_decisions', 'meeting_notes',
    'meeting_summaries', 'meeting_summary_sources', 'meeting_transcripts', 'meetings', 'progress_updates',
    'project_client_roles', 'project_closure_items', 'project_closure_lessons', 'project_closure_requests',
    'project_members', 'recommendation_kpis', 'recommendations', 'reports', 'reviews', 'risk_acceptances',
    'strategic_objectives'
  ] LOOP
    EXECUTE format('CREATE TRIGGER project_open BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION check_project_open()', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- What still stands between a closing project and closed. Each row is one
-- thing to settle: an open action without a disposition, a handed-over
-- action without the person who sustains it, a submission waiting for
-- review, a deadline request waiting for a decision, or the firm's lessons.
-- For the firm on the project; nobody else gets rows.
CREATE FUNCTION app_closure_blockers(pid uuid)
RETURNS TABLE (kind text, action_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH me AS (
    SELECT app_open_closure(pid) AS round
    WHERE app_org_kind() = 'firm' AND app_can_see_project(pid)
  )
  SELECT 'action', a.id FROM me, actions a
    WHERE a.project_id = pid AND a.status::text NOT IN ('verified_complete', 'closed')
      AND NOT EXISTS (SELECT 1 FROM project_closure_items i WHERE i.closure_id = me.round AND i.action_id = a.id)
  UNION ALL
  SELECT 'sustainer', i.action_id FROM me, project_closure_items i JOIN actions a ON a.id = i.action_id
    WHERE i.closure_id = me.round AND i.disposition = 'handed_over' AND i.sustainer_user_id IS NULL AND i.sustainer_contact_id IS NULL
      AND a.status::text NOT IN ('verified_complete', 'closed')
  UNION ALL
  SELECT 'review', a.id FROM me, actions a WHERE a.project_id = pid AND a.status = 'awaiting_review'
  UNION ALL
  SELECT 'deadline_request', d.action_id FROM me, deadline_change_requests d WHERE d.project_id = pid AND d.status = 'pending'
  UNION ALL
  SELECT 'lessons', NULL::uuid FROM me
    WHERE me.round IS NULL OR NOT EXISTS (SELECT 1 FROM project_closure_lessons l WHERE l.closure_id = me.round)
$$;
--> statement-breakpoint
-- Begin closing. A pending request from the client is answered by it.
CREATE FUNCTION app_start_closing(pid uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  p projects;
  round uuid;
BEGIN
  SELECT * INTO p FROM projects WHERE id = pid;
  IF p.id IS NULL OR NOT app_can_see_project(pid) THEN
    RAISE EXCEPTION 'no such project' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT app_can_close_project(pid) THEN
    RAISE EXCEPTION 'only the firm admin, or the lead of an internal project, closes it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p.state::text NOT IN ('planned', 'active') THEN
    RAISE EXCEPTION 'only a planned or active project can start closing' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO project_closures (project_id, org_id, started_by) VALUES (pid, p.org_id, app_uid()) RETURNING id INTO round;
  PERFORM set_config('selah.project_state', 'on', true);
  UPDATE projects SET state = 'closing' WHERE id = pid;
  PERFORM set_config('selah.project_state', '', true);
  WITH answered AS (
    UPDATE project_closure_requests SET status = 'accepted', decided_by = app_uid(), decided_at = now()
    WHERE project_id = pid AND status = 'pending' RETURNING requested_by, id
  )
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT requested_by, 'closure.started', 'project', pid FROM answered WHERE requested_by IS NOT NULL;
  RETURN round;
END $$;
--> statement-breakpoint
-- Stop closing and carry on working. The round and its dispositions stay as history.
CREATE FUNCTION app_cancel_closing(pid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app_can_see_project(pid) OR NOT app_can_close_project(pid) THEN
    RAISE EXCEPTION 'no such project' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT state::text FROM projects WHERE id = pid) <> 'closing' THEN
    RAISE EXCEPTION 'this project is not closing' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE project_closures SET cancelled_by = app_uid(), cancelled_at = now() WHERE id = app_open_closure(pid);
  PERFORM set_config('selah.project_state', 'on', true);
  UPDATE projects SET state = 'active' WHERE id = pid;
  PERFORM set_config('selah.project_state', '', true);
END $$;
--> statement-breakpoint
-- Close, once nothing stands in the way. The firm on the project and the
-- client's sponsor are told.
CREATE FUNCTION app_close_project(pid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF NOT app_can_see_project(pid) OR NOT app_can_close_project(pid) THEN
    RAISE EXCEPTION 'no such project' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT state::text FROM projects WHERE id = pid) <> 'closing' THEN
    RAISE EXCEPTION 'start closing the project first' USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO n FROM app_closure_blockers(pid);
  IF n > 0 THEN
    RAISE EXCEPTION 'settle every open item before closing (% left)', n USING ERRCODE = 'check_violation';
  END IF;
  UPDATE project_closures SET closed_by = app_uid(), closed_at = now() WHERE id = app_open_closure(pid);
  PERFORM set_config('selah.project_state', 'on', true);
  UPDATE projects SET state = 'closed' WHERE id = pid;
  PERFORM set_config('selah.project_state', '', true);
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT DISTINCT u, 'project.closed', 'project', pid FROM (
      SELECT app_project_audience(pid) AS u
      UNION
      SELECT r.user_id FROM project_client_roles r
        JOIN org_memberships m ON m.user_id = r.user_id AND m.org_id = r.org_id AND m.active
        WHERE r.project_id = pid AND r.role = 'sponsor'
    ) x WHERE u IS NOT NULL AND u <> app_uid();
END $$;
--> statement-breakpoint
-- Reopen a closed project, with a reason. The firm admin only.
CREATE FUNCTION app_reopen_project(pid uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app_can_see_project(pid) OR app_role() IS DISTINCT FROM 'firm_admin' THEN
    RAISE EXCEPTION 'only the firm admin reopens a project' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT state::text FROM projects WHERE id = pid) <> 'closed' THEN
    RAISE EXCEPTION 'this project is not closed' USING ERRCODE = 'check_violation';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 5 OR length(p_reason) > 2000 THEN
    RAISE EXCEPTION 'say why the project reopens' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE project_closures SET reopened_by = app_uid(), reopened_at = now(), reopen_reason = btrim(p_reason)
    WHERE id = app_open_closure(pid);
  PERFORM set_config('selah.project_state', 'on', true);
  UPDATE projects SET state = 'active' WHERE id = pid;
  PERFORM set_config('selah.project_state', '', true);
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT u, 'project.reopened', 'project', pid FROM app_project_audience(pid) u WHERE u <> app_uid();
END $$;
--> statement-breakpoint
-- The firm on a closing project disposes of an action that is still open.
-- A handed-over action may name who sustains it now or later: an active
-- account or a contact of the project's own organisation.
CREATE FUNCTION app_check_sustainer(org uuid, s_user uuid, s_contact uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF s_user IS NOT NULL AND s_contact IS NOT NULL THEN
    RAISE EXCEPTION 'name one person who sustains it' USING ERRCODE = 'check_violation';
  END IF;
  IF s_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = s_user AND m.org_id = org AND m.active) THEN
    RAISE EXCEPTION 'the person who sustains it must be an active account of the project''s organisation' USING ERRCODE = 'check_violation';
  END IF;
  IF s_contact IS NOT NULL AND NOT EXISTS (SELECT 1 FROM client_contacts c WHERE c.id = s_contact AND c.org_id = org) THEN
    RAISE EXCEPTION 'the person who sustains it must be a contact of the project''s organisation' USING ERRCODE = 'check_violation';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION app_dispose_action(act uuid, p_disp closure_disposition, p_note text, s_user uuid, s_contact uuid) RETURNS uuid
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
CREATE FUNCTION app_clear_disposition(act uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pid uuid;
BEGIN
  SELECT project_id INTO pid FROM actions WHERE id = act;
  IF pid IS NULL OR app_org_kind() IS DISTINCT FROM 'firm' OR NOT app_can_see_project(pid) THEN
    RAISE EXCEPTION 'no such action' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT state::text FROM projects WHERE id = pid) <> 'closing' THEN
    RAISE EXCEPTION 'this project is not closing' USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM project_closure_items WHERE closure_id = app_open_closure(pid) AND action_id = act;
END $$;
--> statement-breakpoint
-- Who sustains a handed-over action can also be named by the client: its
-- admin, or the project's sponsor (J12.4, "the client names who sustains each").
CREATE FUNCTION app_name_sustainer(act uuid, s_user uuid, s_contact uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a actions;
  ok boolean;
BEGIN
  SELECT * INTO a FROM actions WHERE id = act;
  -- The action must be one the caller can see.
  IF a.id IS NULL OR NOT app_can_see_project(a.project_id)
     OR NOT EXISTS (SELECT 1 FROM project_closure_items i WHERE i.action_id = act AND i.closure_id = app_open_closure(a.project_id)
                    AND i.disposition = 'handed_over') THEN
    RAISE EXCEPTION 'no such handed-over action' USING ERRCODE = 'insufficient_privilege';
  END IF;
  ok := app_org_kind() = 'firm'
    OR (app_role() = 'client_admin' AND a.org_id = app_org())
    OR EXISTS (SELECT 1 FROM project_client_roles r WHERE r.project_id = a.project_id AND r.role = 'sponsor' AND r.user_id = app_uid());
  IF NOT ok THEN
    RAISE EXCEPTION 'the client''s admin or sponsor names who sustains it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- A client user may only name someone for an action they can read.
  IF app_org_kind() = 'client' AND NOT EXISTS (
    SELECT 1 FROM actions x JOIN recommendations rec ON rec.id = x.recommendation_id
    WHERE x.id = act AND app_label_ok(rec.visibility, rec.org_id, rec.created_by)
  ) THEN
    RAISE EXCEPTION 'no such handed-over action' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT state::text FROM projects WHERE id = a.project_id) <> 'closing' THEN
    RAISE EXCEPTION 'this project is not closing' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM app_check_sustainer(a.org_id, s_user, s_contact);
  UPDATE project_closure_items SET sustainer_user_id = s_user, sustainer_contact_id = s_contact, updated_at = now()
    WHERE action_id = act AND closure_id = app_open_closure(a.project_id);
END $$;
--> statement-breakpoint
-- The firm's lessons for this round: what went well, what to improve, and
-- optionally what to do next time.
CREATE FUNCTION app_write_lessons(pid uuid, p_went_well text, p_to_improve text, p_next_time text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  round uuid;
BEGIN
  IF app_org_kind() IS DISTINCT FROM 'firm' OR NOT app_can_see_project(pid) THEN
    RAISE EXCEPTION 'no such project' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT state::text FROM projects WHERE id = pid) <> 'closing' THEN
    RAISE EXCEPTION 'this project is not closing' USING ERRCODE = 'check_violation';
  END IF;
  IF length(btrim(coalesce(p_went_well, ''))) < 3 OR length(btrim(coalesce(p_to_improve, ''))) < 3 THEN
    RAISE EXCEPTION 'say what went well and what to improve' USING ERRCODE = 'check_violation';
  END IF;
  IF length(p_went_well) > 4000 OR length(p_to_improve) > 4000 OR length(coalesce(p_next_time, '')) > 4000 THEN
    RAISE EXCEPTION 'the lessons are too long' USING ERRCODE = 'check_violation';
  END IF;
  round := app_open_closure(pid);
  INSERT INTO project_closure_lessons (closure_id, project_id, org_id, went_well, to_improve, next_time, written_by)
  SELECT round, pid, p.org_id, btrim(p_went_well), btrim(p_to_improve), nullif(btrim(p_next_time), ''), app_uid() FROM projects p WHERE p.id = pid
  ON CONFLICT (closure_id) DO UPDATE SET went_well = EXCLUDED.went_well, to_improve = EXCLUDED.to_improve,
    next_time = EXCLUDED.next_time, written_by = EXCLUDED.written_by, updated_at = now();
END $$;
--> statement-breakpoint
-- The client's sponsor or admin asks the firm to close (N9). The firm
-- admins and the client's lead consultant hear about it.
CREATE FUNCTION app_can_request_closure(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = pid AND p.kind = 'client' AND app_org_kind() = 'client' AND p.org_id = app_org() AND app_can_see_project(pid)
      AND (app_role() = 'client_admin'
           OR EXISTS (SELECT 1 FROM project_client_roles r WHERE r.project_id = pid AND r.role = 'sponsor' AND r.user_id = app_uid()))
  )
$$;
--> statement-breakpoint
CREATE FUNCTION app_request_closure(pid uuid, p_note text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  p projects;
  req uuid;
BEGIN
  SELECT * INTO p FROM projects WHERE id = pid;
  IF p.id IS NULL OR NOT app_can_see_project(pid) OR NOT app_can_request_closure(pid) THEN
    RAISE EXCEPTION 'the client''s sponsor or admin asks to close' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p.state::text NOT IN ('planned', 'active') THEN
    RAISE EXCEPTION 'this project is already closing or closed' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM project_closure_requests r WHERE r.project_id = pid AND r.status = 'pending') THEN
    RAISE EXCEPTION 'the firm already has a request to close this project' USING ERRCODE = 'check_violation';
  END IF;
  IF length(coalesce(p_note, '')) > 2000 THEN
    RAISE EXCEPTION 'the note is too long' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO project_closure_requests (project_id, org_id, requested_by, note)
  VALUES (pid, p.org_id, app_uid(), nullif(btrim(p_note), '')) RETURNING id INTO req;
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT DISTINCT m.user_id, 'closure.requested', 'project', pid FROM org_memberships m
    WHERE m.active AND m.org_id = p.firm_org_id AND (
      m.role = 'firm_admin'
      OR EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = p.org_id AND ca.user_id = m.user_id AND ca.is_lead));
  RETURN req;
END $$;
--> statement-breakpoint
-- The firm admin declines a request, saying why. Starting to close answers it too.
CREATE FUNCTION app_decline_closure_request(req uuid, p_reply text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r project_closure_requests;
BEGIN
  SELECT * INTO r FROM project_closure_requests WHERE id = req;
  IF r.id IS NULL OR NOT app_can_see_project(r.project_id) OR NOT app_can_close_project(r.project_id) THEN
    RAISE EXCEPTION 'no such request' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'this request was already answered' USING ERRCODE = 'check_violation';
  END IF;
  IF length(btrim(coalesce(p_reply, ''))) < 3 OR length(p_reply) > 2000 THEN
    RAISE EXCEPTION 'tell the client why' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE project_closure_requests SET status = 'declined', decided_by = app_uid(), decided_at = now(), reply = btrim(p_reply) WHERE id = req;
  IF r.requested_by IS NOT NULL THEN
    INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES (r.requested_by, 'closure.declined', 'project', r.project_id);
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE project_closures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_closure_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_closure_lessons ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_closure_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON project_closures, project_closure_items, project_closure_lessons, project_closure_requests TO selah_app;
--> statement-breakpoint
CREATE POLICY closure_read ON project_closures FOR SELECT TO selah_app USING (app_can_see_project(project_id));
--> statement-breakpoint
-- A disposition is seen by whoever can see its action (the actions policies decide).
CREATE POLICY closure_item_read ON project_closure_items FOR SELECT TO selah_app
  USING (app_can_see_project(project_id) AND EXISTS (SELECT 1 FROM actions a WHERE a.id = action_id));
--> statement-breakpoint
CREATE POLICY closure_lessons_read ON project_closure_lessons FOR SELECT TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id));
--> statement-breakpoint
CREATE POLICY closure_request_read ON project_closure_requests FOR SELECT TO selah_app USING (app_can_see_project(project_id));
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_close_project(uuid), app_open_closure(uuid), app_closure_blockers(uuid), app_start_closing(uuid),
  app_cancel_closing(uuid), app_close_project(uuid), app_reopen_project(uuid, text), app_check_sustainer(uuid, uuid, uuid),
  app_dispose_action(uuid, closure_disposition, text, uuid, uuid), app_clear_disposition(uuid), app_name_sustainer(uuid, uuid, uuid),
  app_write_lessons(uuid, text, text, text), app_can_request_closure(uuid), app_request_closure(uuid, text),
  app_decline_closure_request(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_close_project(uuid), app_closure_blockers(uuid), app_start_closing(uuid),
  app_cancel_closing(uuid), app_close_project(uuid), app_reopen_project(uuid, text),
  app_dispose_action(uuid, closure_disposition, text, uuid, uuid), app_clear_disposition(uuid), app_name_sustainer(uuid, uuid, uuid),
  app_write_lessons(uuid, text, text, text), app_can_request_closure(uuid), app_request_closure(uuid, text),
  app_decline_closure_request(uuid, text) TO selah_app;
--> statement-breakpoint
-- Reminders keep going while a project closes, except for actions already disposed of.
CREATE OR REPLACE FUNCTION app_follow_ups_due(today date)
RETURNS TABLE (action_id uuid, project_id uuid, kind follow_up_kind, level integer, due_date date, recipients uuid[])
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH open_actions AS (
    SELECT a.id, a.project_id, a.org_id, a.owner_user_id, a.due_date, a.department_id, p.kind AS project_kind, p.firm_org_id,
           EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = a.owner_user_id AND m.org_id = a.org_id AND m.active) AS owner_active,
           (p.kind = 'client' AND o.engagement_mode = 'consultant_managed') AS firm_managed,
           o.departments_enabled,
           p.remind_days_before, p.escalate_level2_days, p.escalate_level3_days,
           today - a.due_date AS days_over
    FROM actions a JOIN projects p ON p.id = a.project_id JOIN organizations o ON o.id = a.org_id
    WHERE a.due_date IS NOT NULL AND app_owner_holds(a.status) AND p.state::text IN ('active', 'closing')
      -- While a project closes, an action with a disposition is no longer chased.
      AND NOT EXISTS (SELECT 1 FROM project_closure_items i JOIN project_closures c ON c.id = i.closure_id
                      WHERE i.action_id = a.id AND c.cancelled_at IS NULL AND c.reopened_at IS NULL)
      AND (a.owner_user_id IS NOT NULL OR (p.kind = 'client' AND o.engagement_mode = 'consultant_managed'))
  ),
  ladder AS (
    SELECT o.*, 'due_soon'::follow_up_kind AS kind, 0 AS step FROM open_actions o
      WHERE o.days_over BETWEEN -o.remind_days_before AND 0
    UNION ALL
    SELECT o.*, 'overdue'::follow_up_kind,
      CASE WHEN o.days_over >= o.escalate_level3_days THEN 3 WHEN o.days_over >= o.escalate_level2_days THEN 2 ELSE 1 END
    FROM open_actions o WHERE o.days_over > 0
  ),
  -- An owner who has left cannot be reminded: go straight to level 2. A
  -- firm-managed client has no owners in Selah; its lead is reminded instead.
  steps AS (
    SELECT l.*, CASE WHEN l.owner_active OR l.firm_managed THEN l.step ELSE greatest(l.step, 2) END AS level FROM ladder l
  ),
  people AS (
    SELECT s.id, s.kind, s.level, s.owner_user_id AS u FROM steps s WHERE s.owner_active
    UNION
    -- firm-managed: the client's lead consultant chases the client
    SELECT s.id, s.kind, s.level, ca.user_id FROM steps s
      JOIN client_assignments ca ON ca.client_org_id = s.org_id AND ca.is_lead
      JOIN org_memberships m ON m.user_id = ca.user_id AND m.org_id = s.firm_org_id AND m.active
      WHERE s.firm_managed
    UNION
    -- level 2+: client managers staffed on the project, and the firm's lead
    SELECT s.id, s.kind, s.level, pm.user_id FROM steps s
      JOIN project_members pm ON pm.project_id = s.project_id
      JOIN org_memberships m ON m.user_id = pm.user_id AND m.org_id = s.org_id AND m.active AND m.role = 'client_manager'
      WHERE s.level >= 2 AND s.project_kind = 'client'
    UNION
    -- level 2+: the head of the action's department
    SELECT s.id, s.kind, s.level, dm.user_id FROM steps s
      JOIN department_members dm ON dm.department_id = s.department_id AND dm.is_head
      JOIN org_memberships m ON m.user_id = dm.user_id AND m.org_id = s.org_id AND m.active
      WHERE s.level >= 2 AND s.project_kind = 'client' AND s.departments_enabled
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
    -- level 3: the client's sponsor, when the sponsor has an account that is
    -- still active (a sponsor named as a contact is not mailed)
    SELECT s.id, s.kind, s.level, r.user_id FROM steps s
      JOIN project_client_roles r ON r.project_id = s.project_id AND r.role = 'sponsor'
      JOIN org_memberships m ON m.user_id = r.user_id AND m.org_id = s.org_id AND m.active
        AND m.role IN ('client_admin', 'client_manager')
      WHERE s.level >= 3 AND s.project_kind = 'client'
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
