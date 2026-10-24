CREATE TYPE "public"."case_study_level" AS ENUM('none', 'metrics_only', 'anonymised', 'named');--> statement-breakpoint
CREATE TABLE "case_study_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"level" "case_study_level" NOT NULL,
	"testimonial" boolean DEFAULT false NOT NULL,
	"conditions" text,
	"recorded_by_firm" boolean DEFAULT false NOT NULL,
	"source_note" text,
	"given_by" uuid,
	"given_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "case_study_source" CHECK (recorded_by_firm = (source_note IS NOT NULL)),
	CONSTRAINT "case_study_text" CHECK (length(coalesce(conditions, '')) <= 2000 AND length(coalesce(source_note, '')) <= 2000),
	CONSTRAINT "case_study_revoked" CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
--> statement-breakpoint
ALTER TABLE "case_study_consents" ADD CONSTRAINT "case_study_consents_given_by_user_id_fk" FOREIGN KEY ("given_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_study_consents" ADD CONSTRAINT "case_study_consents_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_study_consents" ADD CONSTRAINT "case_study_consents_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_study_consents_project_idx" ON "case_study_consents" USING btree ("project_id","given_at");--> statement-breakpoint
-- ------------------------------------------------- case-study consent
-- Case-study consent (F37; research: confidentiality outlives the work, and
-- citing it needs the client's written consent at a level it chooses).
-- Per client project: none, metrics only, anonymised or named, a separate
-- yes or no for quoting a testimonial, and optional conditions. The client's
-- sponsor or admin gives it once the project is closing or closed, and may
-- withdraw it at any time, also while the client is archived and can still
-- read. The firm admin may record a consent the client gave outside Selah,
-- saying where it came from. Nothing is overwritten: a new record follows
-- the last, and a withdrawal is dated on the record it ends. The latest
-- record is the consent; with none, or once withdrawn, it is "none".
-- Everyone who can open the project reads it; nobody else.
--
-- Not frozen by check_project_open(): consent is given and withdrawn after closing.

-- The client's sponsor of the project, or the client's admin.
CREATE FUNCTION app_is_consent_giver(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = pid AND p.kind = 'client' AND app_org_kind() = 'client' AND p.org_id = app_org() AND app_can_see_project(pid)
      AND (app_role() = 'client_admin'
           OR EXISTS (SELECT 1 FROM project_client_roles r WHERE r.project_id = pid AND r.role = 'sponsor' AND r.user_id = app_uid()))
  )
$$;
--> statement-breakpoint
-- Who records a consent now: on a closing or closed client project, the
-- client's sponsor or admin (an active client), or the firm admin.
CREATE FUNCTION app_can_record_case_study(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = pid AND p.kind = 'client' AND p.state::text IN ('closing', 'closed') AND app_can_see_project(pid)
      AND ((app_is_consent_giver(pid) AND app_is_active_client(p.org_id))
           OR (app_org_kind() = 'firm' AND app_role() = 'firm_admin' AND p.firm_org_id = app_org()))
  )
$$;
--> statement-breakpoint
-- The record in force: the latest one, unless it was withdrawn.
CREATE FUNCTION app_case_study_current(pid uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id FROM (
    SELECT x.id, x.revoked_at FROM case_study_consents x WHERE x.project_id = pid ORDER BY x.given_at DESC, x.id DESC LIMIT 1
  ) c WHERE c.revoked_at IS NULL
$$;
--> statement-breakpoint
-- Whether the caller may withdraw the consent in force: the client's sponsor
-- or admin, at any time, when it allows something (a level or a testimonial).
CREATE FUNCTION app_can_revoke_case_study(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_is_consent_giver(pid) AND EXISTS (
    SELECT 1 FROM case_study_consents c WHERE c.id = app_case_study_current(pid) AND (c.level <> 'none' OR c.testimonial)
  )
$$;
--> statement-breakpoint
CREATE FUNCTION app_record_case_study(pid uuid, p_level case_study_level, p_testimonial boolean, p_conditions text, p_source text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  p projects;
  firm boolean := app_org_kind() = 'firm';
  row_id uuid;
BEGIN
  SELECT * INTO p FROM projects WHERE id = pid;
  IF p.id IS NULL OR NOT app_can_see_project(pid) THEN
    RAISE EXCEPTION 'no such project' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT app_can_record_case_study(pid) THEN
    RAISE EXCEPTION 'the client''s sponsor or admin gives case-study consent once the project is closing or closed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_level IS NULL OR p_testimonial IS NULL THEN
    RAISE EXCEPTION 'choose a level and whether a testimonial may be quoted' USING ERRCODE = 'check_violation';
  END IF;
  IF length(coalesce(p_conditions, '')) > 2000 OR length(coalesce(p_source, '')) > 2000 THEN
    RAISE EXCEPTION 'the text is too long' USING ERRCODE = 'check_violation';
  END IF;
  -- The firm says where the client gave it; the client gives it here.
  IF firm AND length(btrim(coalesce(p_source, ''))) < 5 THEN
    RAISE EXCEPTION 'say where the client gave this consent' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO case_study_consents (project_id, org_id, level, testimonial, conditions, recorded_by_firm, source_note, given_by, given_at)
  VALUES (pid, p.org_id, p_level, p_testimonial, nullif(btrim(p_conditions), ''), firm, CASE WHEN firm THEN btrim(p_source) END, app_uid(), clock_timestamp())
  RETURNING id INTO row_id;
  RETURN row_id;
END $$;
--> statement-breakpoint
-- Withdraw the consent in force. The firm admins and the client's lead hear.
CREATE FUNCTION app_revoke_case_study(pid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p projects;
BEGIN
  SELECT * INTO p FROM projects WHERE id = pid;
  IF p.id IS NULL OR NOT app_can_see_project(pid) OR NOT app_is_consent_giver(pid) THEN
    RAISE EXCEPTION 'the client''s sponsor or admin withdraws case-study consent' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT app_can_revoke_case_study(pid) THEN
    RAISE EXCEPTION 'there is no consent to withdraw' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE case_study_consents SET revoked_at = now(), revoked_by = app_uid() WHERE id = app_case_study_current(pid);
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT DISTINCT m.user_id, 'case_study.revoked', 'project', pid FROM org_memberships m
    WHERE m.active AND m.org_id = p.firm_org_id AND (
      m.role = 'firm_admin'
      OR EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = p.org_id AND ca.user_id = m.user_id AND ca.is_lead));
END $$;
--> statement-breakpoint
ALTER TABLE case_study_consents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON case_study_consents TO selah_app;
--> statement-breakpoint
CREATE POLICY case_study_read ON case_study_consents FOR SELECT TO selah_app USING (app_can_see_project(project_id));
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_is_consent_giver(uuid), app_can_record_case_study(uuid), app_case_study_current(uuid), app_can_revoke_case_study(uuid),
  app_record_case_study(uuid, case_study_level, boolean, text, text), app_revoke_case_study(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_record_case_study(uuid), app_can_revoke_case_study(uuid),
  app_record_case_study(uuid, case_study_level, boolean, text, text), app_revoke_case_study(uuid) TO selah_app;