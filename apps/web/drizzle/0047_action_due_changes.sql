CREATE TABLE "action_due_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"from_date" date,
	"to_date" date,
	"changed_by" uuid,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deadline_change_requests" ADD COLUMN "due_date_then" date;--> statement-breakpoint
ALTER TABLE "deadline_change_requests" ADD COLUMN "raised_late" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "action_due_changes" ADD CONSTRAINT "action_due_changes_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_due_changes" ADD CONSTRAINT "action_due_changes_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_due_changes" ADD CONSTRAINT "action_due_changes_request_id_deadline_change_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."deadline_change_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_due_changes" ADD CONSTRAINT "action_due_changes_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_due_changes_action_idx" ON "action_due_changes" USING btree ("action_id","created_at");
--> statement-breakpoint
-- ------------------------------------------------ slips and aging (F17)
-- Before this, approved date changes were only counted per project and an
-- action was flagged at two. Now every move of a released action's due date
-- is kept (action_due_changes), with who moved it and whether a request
-- did; the slip is read against the date agreed at release
-- (baseline_due_date); a request raised after the due date had passed is
-- marked; and the third extension needs the client's lead consultant (the
-- internal project's lead) or a firm admin.

-- lib/slips.ts EXTENSIONS_BEFORE_LEAD.
CREATE FUNCTION app_extensions_before_lead() RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$ SELECT 2 $$;
--> statement-breakpoint
-- lib/slips.ts AGING_BUCKETS: days past due, as audit committees report them.
CREATE FUNCTION app_aging_bucket(days integer) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN days IS NULL OR days < 1 THEN NULL
    WHEN days <= 30 THEN 'd1_30' WHEN days <= 60 THEN 'd31_60' WHEN days <= 90 THEN 'd61_90' ELSE 'd90_plus' END
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_extensions_before_lead(), app_aging_bucket(integer) TO selah_app;
--> statement-breakpoint
GRANT SELECT ON action_due_changes TO selah_app;
--> statement-breakpoint
ALTER TABLE action_due_changes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- As visible as the action (project, recommendation label, department).
CREATE POLICY scoped_read ON action_due_changes FOR SELECT TO selah_app
  USING (app_can_see_project(project_id) AND app_can_see_action(action_id));
--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON action_due_changes FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
-- How many times an action the caller can see moved later after release.
CREATE FUNCTION app_action_extensions(act uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int FROM action_due_changes c WHERE c.action_id = act AND c.to_date > c.from_date AND app_can_see_action(act)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_action_extensions(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_action_extensions(uuid) TO selah_app;
--> statement-breakpoint
-- Whether the caller may move an action's due date later now: anyone who
-- may change it, until it has moved app_extensions_before_lead() times;
-- after that the client's lead consultant (the internal project's lead) or
-- a firm admin.
CREATE FUNCTION app_can_extend(act uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_action_extensions(act) < app_extensions_before_lead()
    OR app_role() = 'firm_admin'
    OR EXISTS (SELECT 1 FROM actions a JOIN projects p ON p.id = a.project_id WHERE a.id = act
               AND ((p.kind = 'client' AND app_is_client_lead(p.org_id)) OR (p.kind = 'internal' AND app_is_project_lead(p.id))))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_extend(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_extend(uuid) TO selah_app;
--> statement-breakpoint
-- Every move of a released action's due date is kept, with the request
-- that moved it if one did; the third move later needs the lead.
CREATE FUNCTION record_due_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('selah.purge', true) = 'on' OR OLD.status = 'draft' OR NEW.due_date IS NOT DISTINCT FROM OLD.due_date THEN
    RETURN NEW;
  END IF;
  IF app_uid() IS NOT NULL AND NEW.due_date > OLD.due_date AND NOT app_can_extend(NEW.id) THEN
    RAISE EXCEPTION 'a third extension needs the lead consultant or a firm admin' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO action_due_changes (project_id, org_id, action_id, from_date, to_date, changed_by, request_id)
  VALUES (NEW.project_id, NEW.org_id, NEW.id, OLD.due_date, NEW.due_date, app_uid(),
    (SELECT d.id FROM deadline_change_requests d
     WHERE d.action_id = NEW.id AND d.status = 'pending' AND d.proposed_due_date = NEW.due_date
     ORDER BY d.created_at DESC LIMIT 1));
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION record_due_change() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER due_change BEFORE UPDATE OF due_date ON actions FOR EACH ROW EXECUTE FUNCTION record_due_change();
--> statement-breakpoint
-- A request keeps the date it asked to move and whether that date had passed.
CREATE OR REPLACE FUNCTION decide_deadline_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM actions a WHERE a.id = NEW.action_id AND a.project_id = NEW.project_id
                   AND a.status NOT IN ('verified_complete', 'closed')) THEN
      RAISE EXCEPTION 'deadline changes are for open actions of the project' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.proposed_due_date IS NOT DISTINCT FROM (SELECT a.due_date FROM actions a WHERE a.id = NEW.action_id)
       OR NEW.proposed_due_date < app_firm_today() THEN
      RAISE EXCEPTION 'propose a new date, from today on' USING ERRCODE = 'check_violation';
    END IF;
    NEW.due_date_then := (SELECT a.due_date FROM actions a WHERE a.id = NEW.action_id);
    NEW.raised_late := coalesce(NEW.due_date_then < app_firm_today(), false);
    RETURN NEW;
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'a decided request is final' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'pending' OR NEW.proposed_due_date <> OLD.proposed_due_date OR NEW.reason <> OLD.reason
     OR NEW.action_id <> OLD.action_id OR NEW.project_id <> OLD.project_id OR NEW.requested_by <> OLD.requested_by
     OR NEW.due_date_then IS DISTINCT FROM OLD.due_date_then OR NEW.raised_late <> OLD.raised_late THEN
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
-- The history so far, from the approved requests (the only way a date moved
-- with a record before): each starts from the one before it, the first from
-- the date agreed at release.
INSERT INTO action_due_changes (project_id, org_id, action_id, from_date, to_date, changed_by, request_id, created_at)
  SELECT d.project_id, d.org_id, d.action_id,
    coalesce(lag(d.proposed_due_date) OVER w, a.baseline_due_date), d.proposed_due_date, d.decided_by, d.id, coalesce(d.decided_at, d.created_at)
  FROM deadline_change_requests d JOIN actions a ON a.id = d.action_id
  WHERE d.status = 'approved'
  WINDOW w AS (PARTITION BY d.action_id ORDER BY coalesce(d.decided_at, d.created_at));
--> statement-breakpoint
-- Where each of a project's released actions stands against its original
-- date, under the caller's row-level security.
CREATE FUNCTION app_action_slips(pid uuid, today date DEFAULT app_firm_today())
RETURNS TABLE (action_id uuid, baseline_due_date date, due_date date, extensions integer, slip_days integer, days_late integer, bucket text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.baseline_due_date, a.due_date, app_action_extensions(a.id),
    greatest(coalesce(a.due_date - a.baseline_due_date, 0), 0),
    CASE WHEN a.closure_outcome IS NULL AND a.status <> 'verified_complete' THEN greatest(today - a.baseline_due_date, 0) END,
    CASE WHEN a.closure_outcome IS NULL AND a.status <> 'verified_complete' THEN app_aging_bucket(today - a.baseline_due_date) END
  FROM actions a WHERE a.project_id = pid AND a.status <> 'draft'
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_action_slips(uuid, date) TO selah_app;
--> statement-breakpoint
-- The project's numbers gain slips and aging, so a frozen report keeps them.
DROP FUNCTION app_project_progress(uuid, date);
--> statement-breakpoint
CREATE FUNCTION app_project_progress(pid uuid, today date DEFAULT current_date)
RETURNS TABLE (
  total integer, verified integer, partially integer, risk_accepted integer, not_applicable integer,
  superseded integer, open integer, overdue integer, implemented_pct numeric,
  extended integer, extended_twice integer, slip_days integer,
  late_d1_30 integer, late_d31_60 integer, late_d61_90 integer, late_d90_plus integer
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH a AS (SELECT * FROM actions WHERE project_id = pid AND status <> 'draft'),
  s AS (SELECT * FROM app_action_slips(pid, today))
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE status = 'verified_complete')::int,
    count(*) FILTER (WHERE closure_outcome = 'partially_implemented')::int,
    count(*) FILTER (WHERE closure_outcome = 'risk_accepted')::int,
    count(*) FILTER (WHERE closure_outcome = 'not_applicable')::int,
    count(*) FILTER (WHERE closure_outcome = 'superseded')::int,
    count(*) FILTER (WHERE closure_outcome IS NULL AND status <> 'verified_complete')::int,
    count(*) FILTER (WHERE closure_outcome IS NULL AND status <> 'verified_complete' AND a.due_date < today)::int,
    round(100.0 * count(*) FILTER (WHERE status = 'verified_complete') / nullif(count(*) FILTER (WHERE closure_outcome IS NULL OR closure_outcome NOT IN ('not_applicable', 'superseded')), 0), 1),
    (SELECT count(*) FROM s WHERE s.extensions >= 1)::int,
    (SELECT count(*) FROM s WHERE s.extensions >= 2)::int,
    (SELECT coalesce(sum(s.slip_days), 0) FROM s)::int,
    (SELECT count(*) FROM s WHERE s.bucket = 'd1_30')::int,
    (SELECT count(*) FROM s WHERE s.bucket = 'd31_60')::int,
    (SELECT count(*) FROM s WHERE s.bucket = 'd61_90')::int,
    (SELECT count(*) FROM s WHERE s.bucket = 'd90_plus')::int
  FROM a
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_project_progress(uuid, date) TO selah_app;
--> statement-breakpoint
-- "Slipped" counts every move later, not only approved requests.
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

