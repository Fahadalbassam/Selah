CREATE TYPE "public"."response_stance" AS ENUM('agree', 'partly_agree', 'disagree');--> statement-breakpoint
CREATE TABLE "recommendation_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"stance" "response_stance" NOT NULL,
	"reason" text,
	"planned_action" text,
	"action_owner" text,
	"target_date" date,
	"recorded_by" uuid NOT NULL,
	"source" "record_source" DEFAULT 'client_portal' NOT NULL,
	"received_via" "received_via",
	"received_on" date,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"firm_reply" text,
	"replied_by" uuid,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_responses_received" CHECK (("recommendation_responses"."source" = 'consultant_recorded') = ("recommendation_responses"."received_via" IS NOT NULL AND "recommendation_responses"."received_on" IS NOT NULL)),
	CONSTRAINT "recommendation_responses_received_only" CHECK ("recommendation_responses"."source" = 'consultant_recorded' OR ("recommendation_responses"."received_via" IS NULL AND "recommendation_responses"."received_on" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "recommendation_responses" ADD CONSTRAINT "recommendation_responses_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_responses" ADD CONSTRAINT "recommendation_responses_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_responses" ADD CONSTRAINT "recommendation_responses_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_responses" ADD CONSTRAINT "recommendation_responses_replied_by_user_id_fk" FOREIGN KEY ("replied_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_responses" ADD CONSTRAINT "recommendation_responses_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recommendation_responses_rec_idx" ON "recommendation_responses" USING btree ("recommendation_id","created_at");--> statement-breakpoint
-- Hand-written: the client's formal response to each recommendation (F10).
-- Before this the client could only block an action with a reason, so a
-- recommendation the client never accepted looked the same as one it did.
--
-- Who records it, by how the client takes part:
--   full: the client's admin, or the project's sponsor;
--   restricted: the client's admin;
--   consultant-managed (no client accounts): firm staff on the project,
--   saying how and when the client gave it, and a different colleague confirms.
-- Only a shared, live recommendation on a client project that isn't closed.
CREATE FUNCTION app_can_respond(rec uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM recommendations r
      JOIN projects p ON p.id = r.project_id AND p.kind = 'client' AND p.state <> 'closed'
      JOIN organizations o ON o.id = p.org_id
    WHERE r.id = rec AND r.visibility = 'shared' AND r.withdrawn_at IS NULL
      AND app_can_see_project(p.id)
      AND CASE
        WHEN app_org_kind() = 'client' THEN
          p.org_id = app_org() AND o.engagement_mode <> 'consultant_managed'
          AND (app_role() = 'client_admin'
               OR (o.engagement_mode = 'full' AND app_role() = 'client_manager' AND EXISTS (
                 SELECT 1 FROM project_client_roles cr WHERE cr.project_id = p.id AND cr.role = 'sponsor' AND cr.user_id = app_uid())))
        WHEN app_org_kind() = 'firm' THEN o.engagement_mode = 'consultant_managed'
        ELSE false
      END
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_respond(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_respond(uuid) TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON recommendation_responses TO selah_app;
--> statement-breakpoint
ALTER TABLE recommendation_responses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Whoever reads the recommendation reads its responses.
CREATE POLICY scoped_read ON recommendation_responses FOR SELECT TO selah_app
  USING (app_can_see_project(project_id) AND app_recommendation_label_ok(recommendation_id));
--> statement-breakpoint
CREATE POLICY respond ON recommendation_responses FOR INSERT TO selah_app
  WITH CHECK (app_can_respond(recommendation_id) AND recorded_by = app_uid()
    AND EXISTS (SELECT 1 FROM recommendations r WHERE r.id = recommendation_id AND r.project_id = recommendation_responses.project_id));
--> statement-breakpoint
-- The firm confirms or answers (the trigger says which changes exist).
CREATE POLICY firm_update ON recommendation_responses FOR UPDATE TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id))
  WITH CHECK (app_org_kind() = 'firm' AND app_can_see_project(project_id));
--> statement-breakpoint
-- A response says what it needs: agreeing (fully or partly) gives the
-- planned action and its date; partly agreeing or disagreeing gives the
-- reason. The side that records it decides its source.
CREATE FUNCTION check_recommendation_response() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.stance IN ('agree', 'partly_agree') AND (coalesce(btrim(NEW.planned_action), '') = '' OR NEW.target_date IS NULL) THEN
    RAISE EXCEPTION 'agreeing needs the planned action and its date' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.stance IN ('partly_agree', 'disagree') AND coalesce(btrim(NEW.reason), '') = '' THEN
    RAISE EXCEPTION 'partly agreeing or disagreeing needs the reason' USING ERRCODE = 'check_violation';
  END IF;
  -- Set from the caller's side, never from the request (as set_record_source()).
  NEW.source := CASE WHEN app_org_kind() = 'firm' THEN 'consultant_recorded' ELSE 'client_portal' END::record_source;
  IF NEW.received_on > current_date THEN
    RAISE EXCEPTION 'received_on cannot be in the future' USING ERRCODE = 'check_violation';
  END IF;
  NEW.confirmed_by := NULL;
  NEW.confirmed_at := NULL;
  NEW.firm_reply := NULL;
  NEW.replied_by := NULL;
  NEW.replied_at := NULL;
  NEW.created_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Append-only, but for two firm steps, each taken once: a colleague other
-- than the recorder confirms a response the firm recorded; and the firm
-- answers a response. The database stamps who and when.
CREATE FUNCTION check_recommendation_response_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  steps constant text[] := ARRAY['confirmed_by', 'confirmed_at', 'firm_reply', 'replied_by', 'replied_at'];
BEGIN
  IF current_setting('selah.purge', true) = 'on' AND current_user NOT IN ('selah_app', 'selah_auth') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF current_user NOT IN ('selah_app', 'selah_auth') THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'recommendation_responses is append-only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - steps) IS DISTINCT FROM (to_jsonb(OLD) - steps) THEN
    RAISE EXCEPTION 'a response is not edited; record a new one' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
    IF OLD.confirmed_by IS NOT NULL THEN
      RAISE EXCEPTION 'the response is already confirmed' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.source <> 'consultant_recorded' THEN
      RAISE EXCEPTION 'only a response the firm recorded is confirmed' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.confirmed_by IS DISTINCT FROM app_uid() OR app_uid() = OLD.recorded_by THEN
      RAISE EXCEPTION 'a colleague other than the one who recorded it confirms it' USING ERRCODE = 'check_violation';
    END IF;
    NEW.confirmed_at := now();
  END IF;
  IF NEW.firm_reply IS DISTINCT FROM OLD.firm_reply OR NEW.replied_by IS DISTINCT FROM OLD.replied_by OR NEW.replied_at IS DISTINCT FROM OLD.replied_at THEN
    IF OLD.firm_reply IS NOT NULL THEN
      RAISE EXCEPTION 'the firm already answered this response' USING ERRCODE = 'check_violation';
    END IF;
    IF coalesce(btrim(NEW.firm_reply), '') = '' OR NEW.replied_by IS DISTINCT FROM app_uid() THEN
      RAISE EXCEPTION 'an answer needs its text, recorded by the one answering' USING ERRCODE = 'check_violation';
    END IF;
    NEW.replied_at := now();
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_recommendation_response(), check_recommendation_response_change() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER response_rules BEFORE INSERT ON recommendation_responses FOR EACH ROW EXECUTE FUNCTION check_recommendation_response();
--> statement-breakpoint
CREATE TRIGGER response_steps BEFORE UPDATE OR DELETE ON recommendation_responses FOR EACH ROW EXECUTE FUNCTION check_recommendation_response_change();
--> statement-breakpoint
-- Where each recommendation stands with the client, under the caller's
-- rights: the latest response that counts (a firm-recorded one counts once
-- confirmed), "unconfirmed" when only a firm-recorded one waits for its
-- check, "awaiting" when a released recommendation has none, and nothing for
-- firm-only or withdrawn ones. "disagree" is the disputed state.
CREATE FUNCTION app_recommendation_stances(pid uuid)
RETURNS TABLE (recommendation_id uuid, stance text, response_id uuid, responded_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT r.id,
    coalesce(c.stance::text, CASE WHEN u.id IS NOT NULL THEN 'unconfirmed' ELSE 'awaiting' END),
    coalesce(c.id, u.id), coalesce(c.created_at, u.created_at)
  FROM recommendations r
  JOIN projects p ON p.id = r.project_id AND p.kind = 'client'
  LEFT JOIN LATERAL (
    SELECT x.id, x.stance, x.created_at FROM recommendation_responses x
    WHERE x.recommendation_id = r.id AND (x.source = 'client_portal' OR x.confirmed_at IS NOT NULL)
    ORDER BY x.created_at DESC LIMIT 1) c ON true
  LEFT JOIN LATERAL (
    SELECT x.id, x.created_at FROM recommendation_responses x
    WHERE x.recommendation_id = r.id AND x.source = 'consultant_recorded' AND x.confirmed_at IS NULL
      AND (c.created_at IS NULL OR x.created_at > c.created_at)
    ORDER BY x.created_at DESC LIMIT 1) u ON true
  WHERE r.project_id = pid AND r.visibility = 'shared' AND r.withdrawn_at IS NULL
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_recommendation_stances(uuid) TO selah_app;
--> statement-breakpoint
-- Disputed recommendations need the firm's attention, like a slipped action.
CREATE OR REPLACE VIEW v_deviations WITH (security_invoker = true) AS
  WITH today AS (SELECT app_firm_today() AS d),
  a AS (
    SELECT a.id, a.project_id, a.org_id, a.owner_user_id, a.due_date,
      greatest(a.updated_at,
        (SELECT max(pu.created_at) FROM progress_updates pu WHERE pu.action_id = a.id),
        (SELECT max(es.created_at) FROM evidence_submissions es WHERE es.action_id = a.id)) AS last_touched,
      (SELECT count(*) FROM deadline_change_requests d WHERE d.action_id = a.id AND d.status = 'approved') AS slips,
      (SELECT count(*) FROM reviews r WHERE r.action_id = a.id AND r.outcome = 'revise') AS revisions
    -- Open: released, not verified, not closed (closure_outcome is set
    -- exactly when closed).
    FROM actions a WHERE a.status NOT IN ('draft', 'verified_complete') AND a.closure_outcome IS NULL
  )
  SELECT a.project_id, a.org_id, 'action'::text AS entity_type, a.id AS entity_id, 'overdue'::text AS rule,
         jsonb_build_object('days', (SELECT d FROM today) - a.due_date) AS detail
    FROM a WHERE a.due_date < (SELECT d FROM today)
  UNION ALL
  SELECT a.project_id, a.org_id, 'action', a.id, 'stale',
         jsonb_build_object('days', extract(day FROM now() - a.last_touched)::int)
    FROM a WHERE a.last_touched < now() - make_interval(days => app_stale_days(a.project_id))
  UNION ALL
  SELECT a.project_id, a.org_id, 'action', a.id, 'slipped', jsonb_build_object('count', a.slips)
    FROM a WHERE a.slips >= 2
  UNION ALL
  SELECT a.project_id, a.org_id, 'action', a.id, 'churn', jsonb_build_object('count', a.revisions)
    FROM a WHERE a.revisions >= 2
  UNION ALL
  SELECT a.project_id, a.org_id, 'action', a.id, 'orphaned', '{}'::jsonb
    FROM a WHERE a.owner_user_id IS NOT NULL AND NOT app_member_active(a.owner_user_id, a.org_id)
  UNION ALL
  SELECT k.project_id, k.org_id, 'kpi', k.id, 'kpi_not_reported', jsonb_build_object('period_start', p.period_start)
    FROM kpis k, app_kpi_periods(k.id, (SELECT d FROM today)) p
    WHERE k.active AND p.status = 'not_reported'
  UNION ALL
  SELECT k.project_id, k.org_id, 'kpi', k.id, 'kpi_off_target', jsonb_build_object('period_start', p.period_start, 'value', p.value)
    FROM kpis k, LATERAL (
      SELECT * FROM app_kpi_periods(k.id, (SELECT d FROM today)) x WHERE x.reading_id IS NOT NULL AND x.status <> 'rejected'
      ORDER BY x.period_start DESC LIMIT 1) p
    WHERE k.active AND p.rag = 'red'
  UNION ALL
  SELECT r.project_id, r.org_id, 'recommendation', r.id, 'disputed', jsonb_build_object('since', s.responded_at)
    FROM (SELECT DISTINCT x.project_id FROM recommendations x WHERE x.visibility = 'shared' AND x.withdrawn_at IS NULL) rp,
      app_recommendation_stances(rp.project_id) s
      JOIN recommendations r ON r.id = s.recommendation_id
    WHERE s.stance = 'disagree';
--> statement-breakpoint
-- Minimal records: a response's written text goes with the rest after handover.
CREATE OR REPLACE FUNCTION app_purge_minimal_records(today date) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  pid uuid;
  n integer := 0;
  gone constant text := '—';
BEGIN
  PERFORM set_config('selah.purge', 'on', true);
  FOR pid IN
    SELECT p.id FROM projects p
      JOIN organizations o ON o.id = p.org_id AND o.minimal_records
      LEFT JOIN firm_settings fs ON fs.org_id = p.firm_org_id
    WHERE p.handover_on IS NOT NULL AND p.minimal_purged_at IS NULL
      AND p.handover_on + coalesce(fs.minimal_purge_days, 90) <= today
  LOOP
    UPDATE progress_updates SET body = gone WHERE project_id = pid AND body <> gone;
    UPDATE action_notes SET body = gone WHERE project_id = pid AND body <> gone;
    UPDATE meeting_notes SET body = gone WHERE project_id = pid AND body <> gone;
    UPDATE meeting_decisions SET text = gone WHERE project_id = pid AND text <> gone;
    UPDATE meeting_summaries SET main_points_md = gone WHERE project_id = pid AND main_points_md <> gone;
    UPDATE meetings SET agenda_md = gone WHERE project_id = pid AND agenda_md <> gone;
    UPDATE findings SET description = gone WHERE project_id = pid AND description <> gone;
    UPDATE recommendations SET rationale = gone WHERE project_id = pid AND rationale <> gone;
    UPDATE recommendations SET target_outcome = gone WHERE project_id = pid AND target_outcome <> gone;
    UPDATE recommendations SET required_evidence = gone WHERE project_id = pid AND required_evidence <> gone;
    UPDATE recommendation_responses SET reason = gone WHERE project_id = pid AND reason <> gone;
    UPDATE recommendation_responses SET planned_action = gone WHERE project_id = pid AND planned_action <> gone;
    UPDATE recommendation_responses SET firm_reply = gone WHERE project_id = pid AND firm_reply <> gone;
    UPDATE actions SET description = gone WHERE project_id = pid AND description <> gone;
    UPDATE actions SET closure_note = gone WHERE project_id = pid AND closure_note <> gone;
    UPDATE actions SET blocked_reason = gone WHERE project_id = pid AND blocked_reason <> gone;
    UPDATE assessment_answers SET text_answer = gone WHERE project_id = pid AND text_answer <> gone;
    UPDATE assessment_answers SET comment = gone WHERE project_id = pid AND comment <> gone;
    UPDATE assessment_notes SET body = gone WHERE project_id = pid AND body <> gone;
    UPDATE projects SET minimal_purged_at = now() WHERE id = pid;
    n := n + 1;
  END LOOP;
  PERFORM set_config('selah.purge', 'off', true);
  RETURN n;
END $$;
--> statement-breakpoint
-- Telling the other side. The server can't read who is on the firm's team
-- or who answers for the client, so the database writes these:
--   recommendation.released: a shared recommendation now needs the client's
--     response (its admins, and the project's sponsor in full mode);
--   recommendation.responded: the caller recorded a response (the firm's team
--     on the project);
--   recommendation.answered: the firm answered a response (whoever recorded it).
CREATE FUNCTION app_notify_recommendation(rec uuid, note_kind text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r recommendations%ROWTYPE; eng engagement_mode; n integer;
BEGIN
  SELECT * INTO r FROM recommendations WHERE id = rec;
  IF NOT FOUND OR NOT app_can_see_project(r.project_id) OR NOT app_label_ok(r.visibility, r.org_id, r.created_by) THEN
    RAISE EXCEPTION 'recommendation not visible' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT o.engagement_mode INTO eng FROM organizations o JOIN projects p ON p.org_id = o.id WHERE p.id = r.project_id AND p.kind = 'client';
  IF note_kind = 'recommendation.released' AND app_org_kind() = 'firm' AND r.visibility = 'shared' AND r.withdrawn_at IS NULL THEN
    IF eng IS NULL OR eng = 'consultant_managed' THEN
      RETURN 0; -- no client accounts to tell
    END IF;
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT DISTINCT u, note_kind, 'recommendation', rec FROM (
        SELECT m.user_id AS u FROM org_memberships m WHERE m.org_id = r.org_id AND m.active AND m.role = 'client_admin'
        UNION
        SELECT cr.user_id FROM project_client_roles cr JOIN org_memberships m ON m.user_id = cr.user_id AND m.org_id = r.org_id AND m.active
          WHERE eng = 'full' AND cr.project_id = r.project_id AND cr.role = 'sponsor' AND cr.user_id IS NOT NULL
      ) who WHERE u <> app_uid();
  ELSIF note_kind = 'recommendation.responded' AND EXISTS (
      SELECT 1 FROM recommendation_responses x WHERE x.recommendation_id = rec AND x.recorded_by = app_uid() AND x.created_at > now() - interval '1 minute') THEN
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT u, note_kind, 'recommendation', rec FROM app_project_audience(r.project_id) u WHERE u <> app_uid();
  ELSIF note_kind = 'recommendation.answered' AND app_org_kind() = 'firm' THEN
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT DISTINCT x.recorded_by, note_kind, 'recommendation', rec FROM recommendation_responses x
      WHERE x.recommendation_id = rec AND x.replied_by = app_uid() AND x.replied_at > now() - interval '1 minute' AND x.recorded_by <> app_uid();
  ELSE
    RAISE EXCEPTION 'notification does not match the recommendation' USING ERRCODE = 'check_violation';
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_notify_recommendation(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_notify_recommendation(uuid, text) TO selah_app;
--> statement-breakpoint
-- A closed project takes no more responses (lib/closure.ts FROZEN_TABLES).
CREATE TRIGGER project_open BEFORE INSERT OR UPDATE OR DELETE ON recommendation_responses FOR EACH ROW EXECUTE FUNCTION check_project_open();
--> statement-breakpoint
-- A read-only observer (N6) neither records, confirms nor answers a response.
CREATE TRIGGER project_observer BEFORE INSERT OR UPDATE OR DELETE ON recommendation_responses FOR EACH ROW EXECUTE FUNCTION check_not_observer();
