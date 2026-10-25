CREATE TABLE "client_kpi_links" (
	"kpi_id" uuid NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_kpi_links_kpi_id_recommendation_id_pk" PRIMARY KEY("kpi_id","recommendation_id")
);
--> statement-breakpoint
CREATE TABLE "client_kpi_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kpi_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"period" date NOT NULL,
	"value" numeric NOT NULL,
	"note" text,
	"entered_by" uuid NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"on_behalf" boolean DEFAULT false NOT NULL,
	"supersedes_id" uuid,
	"checked_by" uuid,
	"checked_at" timestamp with time zone,
	CONSTRAINT "client_kpi_value_note" CHECK (char_length(coalesce("client_kpi_values"."note", '')) <= 1000),
	CONSTRAINT "client_kpi_value_checked" CHECK (("client_kpi_values"."checked_by" IS NULL) = ("client_kpi_values"."checked_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "client_kpis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"department_id" uuid,
	"name_ar" text,
	"name_en" text,
	"definition" text,
	"unit" text NOT NULL,
	"direction" "kpi_direction" NOT NULL,
	"frequency" "kpi_frequency" DEFAULT 'monthly' NOT NULL,
	"baseline" numeric NOT NULL,
	"baseline_period" date NOT NULL,
	"target" numeric,
	"target_date" date,
	"source" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_kpi_named" CHECK (coalesce("client_kpis"."name_ar", "client_kpis"."name_en") IS NOT NULL),
	CONSTRAINT "client_kpi_name_length" CHECK (char_length(coalesce("client_kpis"."name_ar", '')) <= 200 AND char_length(coalesce("client_kpis"."name_en", '')) <= 200),
	CONSTRAINT "client_kpi_unit" CHECK (char_length(btrim("client_kpis"."unit")) BETWEEN 1 AND 40),
	CONSTRAINT "client_kpi_texts" CHECK (char_length(coalesce("client_kpis"."definition", '')) <= 1000 AND char_length(coalesce("client_kpis"."source", '')) <= 300),
	CONSTRAINT "client_kpi_baseline_first" CHECK (extract(day FROM "client_kpis"."baseline_period") = 1),
	CONSTRAINT "client_kpi_target_pair" CHECK (("client_kpis"."target" IS NULL) = ("client_kpis"."target_date" IS NULL)),
	CONSTRAINT "client_kpi_target_after" CHECK ("client_kpis"."target_date" IS NULL OR "client_kpis"."target_date" > "client_kpis"."baseline_period")
);
--> statement-breakpoint
ALTER TABLE "client_kpi_links" ADD CONSTRAINT "client_kpi_links_kpi_id_client_kpis_id_fk" FOREIGN KEY ("kpi_id") REFERENCES "public"."client_kpis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_kpi_links" ADD CONSTRAINT "client_kpi_links_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_kpi_links" ADD CONSTRAINT "client_kpi_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_kpi_links" ADD CONSTRAINT "client_kpi_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_kpi_values" ADD CONSTRAINT "client_kpi_values_kpi_id_client_kpis_id_fk" FOREIGN KEY ("kpi_id") REFERENCES "public"."client_kpis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_kpi_values" ADD CONSTRAINT "client_kpi_values_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_kpi_values" ADD CONSTRAINT "client_kpi_values_entered_by_user_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_kpi_values" ADD CONSTRAINT "client_kpi_values_supersedes_id_client_kpi_values_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."client_kpi_values"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_kpi_values" ADD CONSTRAINT "client_kpi_values_checked_by_user_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_kpis" ADD CONSTRAINT "client_kpis_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_kpis" ADD CONSTRAINT "client_kpis_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_kpis" ADD CONSTRAINT "client_kpis_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_kpis" ADD CONSTRAINT "client_kpis_department_fk" FOREIGN KEY ("department_id","org_id") REFERENCES "public"."departments"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_kpi_links_rec_idx" ON "client_kpi_links" USING btree ("recommendation_id");--> statement-breakpoint
CREATE INDEX "client_kpi_values_kpi_idx" ON "client_kpi_values" USING btree ("kpi_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "client_kpi_values_supersede_once" ON "client_kpi_values" USING btree ("supersedes_id");--> statement-breakpoint
CREATE INDEX "client_kpis_org_idx" ON "client_kpis" USING btree ("org_id","department_id");--> statement-breakpoint
-- ------------------------------------------ business indicators (KPI layer B)
-- Approved 2026-10-25. The client's own business numbers (complaints, staff
-- turnover, days to close the books), for the whole company or one
-- department, entered by hand month by month or quarter by quarter, and
-- linked to the recommendations meant to move them. They sit next to the
-- implementation numbers so a reader sees "the work was done" beside "did
-- the business move", and every screen says they are the client's reported
-- figures, not verified impact. Nothing is pulled from client systems,
-- weighted or scored.
--
-- They replace the project-level KPI tables of the baseline (objectives,
-- KPIs, readings), which were never switched on or given screens: the
-- client's numbers belong to the client and outlive any one project.

-- The deviations view and the trace stop reading the old tables first.
CREATE OR REPLACE VIEW v_deviations WITH (security_invoker = true) AS
  WITH today AS (SELECT app_firm_today() AS d),
  a AS (
    SELECT a.id, a.project_id, a.org_id, a.owner_user_id, a.due_date,
      greatest(a.updated_at,
        (SELECT max(pu.created_at) FROM progress_updates pu WHERE pu.action_id = a.id),
        (SELECT max(es.created_at) FROM evidence_submissions es WHERE es.action_id = a.id)) AS last_touched,
      app_action_extensions(a.id) AS slips,
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
  SELECT r.project_id, r.org_id, 'recommendation', r.id, 'disputed', jsonb_build_object('since', s.responded_at)
    FROM (SELECT DISTINCT x.project_id FROM recommendations x WHERE x.visibility = 'shared' AND x.withdrawn_at IS NULL) rp,
      app_recommendation_stances(rp.project_id) s
      JOIN recommendations r ON r.id = s.recommendation_id
    WHERE s.stance = 'disagree';
--> statement-breakpoint
-- The trace: an indicator shows above the project's recommendations meant
-- to move it (the indicator itself belongs to the client, not the project).
CREATE OR REPLACE FUNCTION app_trace(pid uuid)
RETURNS TABLE (node_type text, node_id uuid, parent_type text, parent_id uuid, label text, state text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT 'kpi', k.id, NULL, NULL::uuid, coalesce(k.name_ar, k.name_en), CASE WHEN k.active THEN 'active' ELSE 'inactive' END
    FROM client_kpi_links l JOIN client_kpis k ON k.id = l.kpi_id JOIN recommendations r ON r.id = l.recommendation_id
    WHERE r.project_id = pid
  UNION ALL
  SELECT 'assessment', a.id, NULL, NULL, a.title, a.status::text FROM assessments a WHERE a.project_id = pid
  UNION ALL
  SELECT 'finding', f.id, CASE WHEN a.id IS NOT NULL THEN 'assessment' END, a.id, f.title, x.basis::text
    FROM findings f LEFT JOIN assessment_answers x ON x.id = f.assessment_answer_id LEFT JOIN assessments a ON a.id = x.assessment_id
    WHERE f.project_id = pid
  UNION ALL
  SELECT 'recommendation', r.id, CASE WHEN f.id IS NOT NULL THEN 'finding' END, f.id, r.title, r.priority::text
    FROM recommendations r LEFT JOIN findings f ON f.id = r.finding_id WHERE r.project_id = pid
  UNION ALL
  SELECT 'recommendation', r.id, 'kpi', k.id, r.title, r.priority::text
    FROM client_kpi_links l JOIN recommendations r ON r.id = l.recommendation_id JOIN client_kpis k ON k.id = l.kpi_id
    WHERE r.project_id = pid
  UNION ALL
  SELECT 'action', a.id, CASE WHEN r.id IS NOT NULL THEN 'recommendation' END, r.id, a.title, a.status::text
    FROM actions a LEFT JOIN recommendations r ON r.id = a.recommendation_id WHERE a.project_id = pid
  UNION ALL
  SELECT 'action', n.id, 'action', old.id, n.title, n.status::text
    FROM actions old JOIN actions n ON n.id = old.superseded_by WHERE old.project_id = pid
  UNION ALL
  SELECT 'evidence', es.id, 'action', a.id, d.title, es.source::text
    FROM evidence_submissions es JOIN actions a ON a.id = es.action_id LEFT JOIN documents d ON d.id = es.document_id
    WHERE es.project_id = pid
  UNION ALL
  SELECT 'review', rv.id, 'action', a.id, NULL, rv.outcome::text
    FROM reviews rv JOIN actions a ON a.id = rv.action_id WHERE rv.project_id = pid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_document_settled(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
      SELECT 1 FROM info_request_files f JOIN info_requests r ON r.id = f.request_id
      WHERE f.document_id = doc AND r.status = 'reviewed')
    OR EXISTS (
      SELECT 1 FROM assessment_evidence e JOIN assessment_answers a ON a.id = e.answer_id JOIN assessments s ON s.id = a.assessment_id
      WHERE e.document_id = doc AND s.status <> 'draft')
$$;
--> statement-breakpoint
DROP TABLE recommendation_kpis;
--> statement-breakpoint
DROP TABLE kpi_readings;
--> statement-breakpoint
DROP TABLE kpis;
--> statement-breakpoint
DROP TABLE strategic_objectives;
--> statement-breakpoint
DROP FUNCTION app_kpi_periods(uuid, date);
--> statement-breakpoint
DROP FUNCTION check_kpi_reading();
--> statement-breakpoint
DROP FUNCTION check_kpi();
--> statement-breakpoint
DROP FUNCTION check_recommendation_kpi();
--> statement-breakpoint
DROP FUNCTION app_kpi_step(kpi_frequency);
--> statement-breakpoint
DROP FUNCTION app_kpis_on(uuid);
--> statement-breakpoint
DROP FUNCTION app_kpi_grace(uuid);
--> statement-breakpoint
-- Indicators need no firm-wide switch: a client that keeps none shows none.
ALTER TABLE firm_settings DROP COLUMN client_kpis_enabled;
--> statement-breakpoint
DROP TYPE kpi_perspective;
--> statement-breakpoint
DROP TYPE kpi_reading_status;
--> statement-breakpoint
-- Who reads a client's indicators: the firm admin and the client's
-- consultants; the client's admin; and its managers, for the whole company
-- and the departments they are in (app_dept_ok). Action owners don't: their
-- view is their own work, as with the progress numbers.
CREATE FUNCTION app_kpi_readable(org uuid, dept uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_firm_works_with(org)
    OR (org = app_org() AND app_role() IN ('client_admin', 'client_manager') AND app_dept_ok(dept, org))
$$;
--> statement-breakpoint
CREATE FUNCTION app_kpi_id_readable(kid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT app_kpi_readable(k.org_id, k.department_id) FROM client_kpis k WHERE k.id = kid), false)
$$;
--> statement-breakpoint
-- Who sets indicators up, changes them and links them: the firm admin, the
-- client's consultants, and the client's admin.
CREATE FUNCTION app_kpi_writer(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_firm_works_with(org) OR (app_role() = 'client_admin' AND org = app_org())
$$;
--> statement-breakpoint
-- The firm's grace days after a period ends before a missing value shows as missing.
CREATE FUNCTION app_kpi_grace_days() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT fs.kpi_grace_days FROM firm_settings fs JOIN organizations o ON o.id = fs.org_id WHERE o.kind = 'firm' LIMIT 1), 10)
$$;
--> statement-breakpoint
-- The months between an indicator's periods.
CREATE FUNCTION app_kpi_months(f kpi_frequency) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE f WHEN 'quarterly' THEN 3 ELSE 1 END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON client_kpis TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON client_kpi_values TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON client_kpi_links TO selah_app;
--> statement-breakpoint
ALTER TABLE client_kpis ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_kpi_values ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_kpi_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY scoped_read ON client_kpis FOR SELECT TO selah_app USING (app_kpi_readable(org_id, department_id));
--> statement-breakpoint
CREATE POLICY writer_insert ON client_kpis FOR INSERT TO selah_app WITH CHECK (app_kpi_writer(org_id));
--> statement-breakpoint
CREATE POLICY writer_update ON client_kpis FOR UPDATE TO selah_app USING (app_kpi_writer(org_id)) WITH CHECK (app_kpi_writer(org_id));
--> statement-breakpoint
CREATE POLICY writer_delete ON client_kpis FOR DELETE TO selah_app USING (app_kpi_writer(org_id));
--> statement-breakpoint
CREATE POLICY scoped_read ON client_kpi_values FOR SELECT TO selah_app USING (app_kpi_id_readable(kpi_id));
--> statement-breakpoint
-- Anyone who reads an indicator, except action owners, enters its values in their own name.
CREATE POLICY report ON client_kpi_values FOR INSERT TO selah_app WITH CHECK (
  entered_by = app_uid() AND app_role() IN ('firm_admin', 'consultant', 'client_admin', 'client_manager') AND app_kpi_id_readable(kpi_id)
);
--> statement-breakpoint
-- The firm checks a value against the client's source (check_client_kpi_value).
CREATE POLICY firm_check ON client_kpi_values FOR UPDATE TO selah_app
  USING (app_org_kind() = 'firm' AND app_firm_works_with(org_id)) WITH CHECK (app_org_kind() = 'firm' AND app_firm_works_with(org_id));
--> statement-breakpoint
-- A link shows only to those who read both the indicator and the recommendation.
CREATE POLICY scoped_read ON client_kpi_links FOR SELECT TO selah_app
  USING (app_kpi_id_readable(kpi_id) AND EXISTS (SELECT 1 FROM recommendations r WHERE r.id = recommendation_id));
--> statement-breakpoint
CREATE POLICY writer_insert ON client_kpi_links FOR INSERT TO selah_app
  WITH CHECK (app_kpi_writer(org_id) AND EXISTS (SELECT 1 FROM recommendations r WHERE r.id = recommendation_id));
--> statement-breakpoint
CREATE POLICY writer_delete ON client_kpi_links FOR DELETE TO selah_app USING (app_kpi_writer(org_id));
--> statement-breakpoint
-- An indicator stays with its client and its creator. Once it has values,
-- what they are measured against (baseline, its period, the frequency and
-- the direction) is fixed: a different measure is a new indicator. It is
-- deleted only while it has no values; after that it is switched off.
CREATE FUNCTION check_client_kpi() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF app_uid() IS NOT NULL AND EXISTS (SELECT 1 FROM client_kpi_values v WHERE v.kpi_id = OLD.id) THEN
      RAISE EXCEPTION 'this indicator has values; switch it off instead' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  NEW.unit := btrim(NEW.unit);
  NEW.name_ar := nullif(btrim(NEW.name_ar), '');
  NEW.name_en := nullif(btrim(NEW.name_en), '');
  IF TG_OP = 'INSERT' THEN
    IF (SELECT o.kind FROM organizations o WHERE o.id = NEW.org_id) IS DISTINCT FROM 'client' THEN
      RAISE EXCEPTION 'indicators belong to a client' USING ERRCODE = 'check_violation';
    END IF;
    IF app_uid() IS NOT NULL THEN
      NEW.created_by := app_uid();
    END IF;
    NEW.created_at := now();
    NEW.updated_by := NULL;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF NEW.org_id <> OLD.org_id OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'an indicator stays with its client' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.baseline, NEW.baseline_period, NEW.frequency, NEW.direction) IS DISTINCT FROM (OLD.baseline, OLD.baseline_period, OLD.frequency, OLD.direction)
     AND EXISTS (SELECT 1 FROM client_kpi_values v WHERE v.kpi_id = OLD.id) THEN
    RAISE EXCEPTION 'this indicator has values, so its baseline, frequency and direction stay; start a new indicator instead'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_by := app_uid();
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER client_kpi_rules BEFORE INSERT OR UPDATE OR DELETE ON client_kpis FOR EACH ROW EXECUTE FUNCTION check_client_kpi();
--> statement-breakpoint
-- Filed under an active department of its own client (the composite foreign key keeps the org).
CREATE TRIGGER row_department BEFORE INSERT OR UPDATE OF department_id ON client_kpis
  FOR EACH ROW EXECUTE FUNCTION check_row_department();
--> statement-breakpoint
-- A value: for an active indicator, for one of its periods after the
-- baseline that has started, in the name of whoever enters it; the first
-- value of a period, or a correction that replaces the current one. The
-- database marks a value firm staff entered for the client. Afterwards only
-- the firm's check is added, once, by someone other than who entered it.
CREATE FUNCTION check_client_kpi_value() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  k client_kpis;
  months integer;
  cur uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.checked_by IS NOT NULL OR NEW.checked_by IS NULL
       OR (to_jsonb(NEW) - '{checked_by,checked_at}'::text[]) <> (to_jsonb(OLD) - '{checked_by,checked_at}'::text[]) THEN
      RAISE EXCEPTION 'a value is only checked, once; a different value is a correction' USING ERRCODE = 'check_violation';
    END IF;
    IF app_org_kind() IS DISTINCT FROM 'firm' THEN
      RAISE EXCEPTION 'the firm checks a value against the client''s source' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF app_uid() IS NOT DISTINCT FROM OLD.entered_by THEN
      RAISE EXCEPTION 'a value is checked by someone other than who entered it' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF EXISTS (SELECT 1 FROM client_kpi_values c WHERE c.supersedes_id = OLD.id) THEN
      RAISE EXCEPTION 'this value was corrected; check the current one' USING ERRCODE = 'check_violation';
    END IF;
    NEW.checked_by := app_uid();
    NEW.checked_at := now();
    RETURN NEW;
  END IF;

  SELECT * INTO k FROM client_kpis WHERE id = NEW.kpi_id;
  IF k.id IS NULL OR NOT k.active THEN
    RAISE EXCEPTION 'values are entered for active indicators' USING ERRCODE = 'check_violation';
  END IF;
  NEW.org_id := k.org_id;
  months := (extract(year FROM NEW.period)::int * 12 + extract(month FROM NEW.period)::int)
          - (extract(year FROM k.baseline_period)::int * 12 + extract(month FROM k.baseline_period)::int);
  IF extract(day FROM NEW.period) <> 1 OR months <= 0 OR months % app_kpi_months(k.frequency) <> 0 THEN
    RAISE EXCEPTION 'that is not one of the indicator''s periods after its baseline' USING ERRCODE = 'check_violation';
  END IF;
  IF app_uid() IS NOT NULL AND NEW.period > app_firm_today() THEN
    RAISE EXCEPTION 'that period has not started yet' USING ERRCODE = 'check_violation';
  END IF;
  NEW.note := nullif(btrim(NEW.note), '');
  IF app_uid() IS NOT NULL THEN
    NEW.entered_by := app_uid();
    NEW.entered_at := clock_timestamp();
    NEW.on_behalf := app_org_kind() = 'firm';
    IF NEW.checked_by IS NOT NULL OR NEW.checked_at IS NOT NULL THEN
      RAISE EXCEPTION 'a new value is not checked yet' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- The period's current value: the latest one nobody has replaced.
  SELECT v.id INTO cur FROM client_kpi_values v
  WHERE v.kpi_id = NEW.kpi_id AND v.period = NEW.period
    AND NOT EXISTS (SELECT 1 FROM client_kpi_values c WHERE c.supersedes_id = v.id)
  ORDER BY v.entered_at DESC LIMIT 1;
  IF NEW.supersedes_id IS DISTINCT FROM cur THEN
    RAISE EXCEPTION '%', CASE WHEN cur IS NULL THEN 'there is no value for that period to correct'
      ELSE 'that period already has a value; correct it instead' END USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER client_kpi_value_rules BEFORE INSERT OR UPDATE ON client_kpi_values FOR EACH ROW EXECUTE FUNCTION check_client_kpi_value();
--> statement-breakpoint
-- A value the firm entered for the client tells the client's admins.
CREATE FUNCTION notify_client_kpi_value() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.on_behalf THEN
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT m.user_id, 'indicator.entered_for_you', 'kpi', NEW.kpi_id FROM org_memberships m
      WHERE m.active AND m.org_id = NEW.org_id AND m.role = 'client_admin';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER client_kpi_value_notify AFTER INSERT ON client_kpi_values FOR EACH ROW EXECUTE FUNCTION notify_client_kpi_value();
--> statement-breakpoint
-- A link joins an indicator and a recommendation of the same client.
CREATE FUNCTION check_client_kpi_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE org uuid;
BEGIN
  SELECT k.org_id INTO org FROM client_kpis k WHERE k.id = NEW.kpi_id;
  IF org IS NULL OR NOT EXISTS (SELECT 1 FROM recommendations r WHERE r.id = NEW.recommendation_id AND r.org_id = org) THEN
    RAISE EXCEPTION 'the indicator and the recommendation must belong to the same client' USING ERRCODE = 'check_violation';
  END IF;
  NEW.org_id := org;
  IF app_uid() IS NOT NULL THEN
    NEW.created_by := app_uid();
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER client_kpi_link_rules BEFORE INSERT ON client_kpi_links FOR EACH ROW EXECUTE FUNCTION check_client_kpi_link();
--> statement-breakpoint
-- An archived client's indicators freeze with the rest of its client-level
-- records (lib/offboarding.ts CLIENT_FROZEN_TABLES).
CREATE TRIGGER client_open BEFORE INSERT OR UPDATE OR DELETE ON client_kpis FOR EACH ROW EXECUTE FUNCTION check_client_open();
--> statement-breakpoint
CREATE TRIGGER client_open BEFORE INSERT OR UPDATE OR DELETE ON client_kpi_values FOR EACH ROW EXECUTE FUNCTION check_client_open();
--> statement-breakpoint
CREATE TRIGGER client_open BEFORE INSERT OR UPDATE OR DELETE ON client_kpi_links FOR EACH ROW EXECUTE FUNCTION check_client_open();
--> statement-breakpoint
-- Each period of an indicator after its baseline, up to as_of, with the
-- value known on that day (the latest entered by then; a correction entered
-- later does not rewrite a frozen report). A period with no value is "due"
-- until its end plus the firm's grace days, then "missing", never a zero.
-- With the caller's rights.
CREATE FUNCTION app_kpi_series(kid uuid, as_of date)
RETURNS TABLE (period date, period_end date, value_id uuid, value numeric, note text, entered_by uuid, entered_at timestamptz,
  on_behalf boolean, checked boolean, corrected boolean, status text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH k AS (SELECT * FROM client_kpis WHERE id = kid),
  periods AS (
    SELECT g::date AS period, (g + make_interval(months => app_kpi_months(k.frequency)))::date - 1 AS period_end
    FROM k, generate_series((k.baseline_period + make_interval(months => app_kpi_months(k.frequency)))::timestamp,
                            as_of::timestamp, make_interval(months => app_kpi_months(k.frequency))) g
  ),
  known AS (
    SELECT DISTINCT ON (v.period) v.* FROM client_kpi_values v
    WHERE v.kpi_id = kid AND (v.entered_at AT TIME ZONE app_firm_tz())::date <= as_of
    ORDER BY v.period, v.entered_at DESC, v.id DESC
  )
  SELECT p.period, p.period_end, v.id, v.value, v.note, v.entered_by, v.entered_at, v.on_behalf, v.checked_by IS NOT NULL,
    v.supersedes_id IS NOT NULL,
    CASE WHEN v.id IS NOT NULL THEN 'reported' WHEN p.period_end + app_kpi_grace_days() < as_of THEN 'missing' ELSE 'due' END
  FROM periods p LEFT JOIN known v ON v.period = p.period
  ORDER BY p.period
$$;
--> statement-breakpoint
-- On the 1st, after the status packs: each client with an active indicator
-- whose last period ended without a value tells its admins once. Run by the
-- monthly job as the schema owner. Returns how many clients were told.
CREATE FUNCTION app_remind_kpis(today date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF app_uid() IS NOT NULL THEN
    RAISE EXCEPTION 'reminders are sent by the monthly job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  WITH due AS (
    SELECT DISTINCT k.org_id FROM client_kpis k JOIN organizations o ON o.id = k.org_id
    WHERE k.active AND o.status = 'active'
      -- The period that ended yesterday: it starts a whole number of periods after the baseline.
      AND ((extract(year FROM today - 1)::int * 12 + extract(month FROM today - 1)::int)
          - (extract(year FROM k.baseline_period)::int * 12 + extract(month FROM k.baseline_period)::int) + 1)
          % app_kpi_months(k.frequency) = 0
      AND date_trunc('month', today - 1)::date - make_interval(months => app_kpi_months(k.frequency) - 1) > k.baseline_period
      AND NOT EXISTS (
        SELECT 1 FROM client_kpi_values v
        WHERE v.kpi_id = k.id AND v.period = (date_trunc('month', today - 1) - make_interval(months => app_kpi_months(k.frequency) - 1))::date)
      AND NOT EXISTS (
        SELECT 1 FROM notifications x WHERE x.kind = 'indicator.due' AND x.entity_id = k.org_id AND x.created_at::date >= today - 20)
  ), sent AS (
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT m.user_id, 'indicator.due', 'organization', d.org_id FROM due d
      JOIN org_memberships m ON m.org_id = d.org_id AND m.active AND m.role = 'client_admin'
    RETURNING entity_id
  )
  SELECT count(DISTINCT entity_id) INTO n FROM sent;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_kpi_readable(uuid, uuid), app_kpi_id_readable(uuid), app_kpi_writer(uuid), app_kpi_grace_days(),
  app_kpi_series(uuid, date), app_remind_kpis(date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_kpi_readable(uuid, uuid), app_kpi_id_readable(uuid), app_kpi_writer(uuid), app_kpi_grace_days(),
  app_kpi_months(kpi_frequency), app_kpi_series(uuid, date) TO selah_app;
