-- Metrics (2026-10-20, docs/metrics.md).
--
-- Layer A, implementation metrics: computed from the workflow, never typed
-- in, and read under the caller's row-level security. "On time" is measured
-- against the due date agreed at release (baseline_due_date).
-- Team view: admins see each colleague's workload (no ranking, no scores)
-- and the team's review turnaround as a whole.
-- Layer B, client KPIs: optional, off until the firm turns
-- firm_settings.client_kpis_enabled on. Readings are the client's claims
-- until the firm verifies them; a missing period shows as not reported.

-- ------------------------------------------------------------ baseline

UPDATE actions SET baseline_due_date = due_date WHERE status <> 'draft';
--> statement-breakpoint
CREATE FUNCTION keep_baseline() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status = 'draft' THEN
    -- Set when the action is released, from the due date agreed then.
    NEW.baseline_due_date := CASE WHEN NEW.status <> 'draft' THEN NEW.due_date END;
  ELSE
    -- Frozen afterwards; only an action released without a date takes its first one.
    NEW.baseline_due_date := COALESCE(OLD.baseline_due_date, NEW.due_date);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER action_baseline BEFORE INSERT OR UPDATE ON actions FOR EACH ROW EXECUTE FUNCTION keep_baseline();
--> statement-breakpoint

-- -------------------------------------------- implementation metrics

-- One row per project the caller can see. security_invoker: every table
-- underneath is read with the caller's row-level security.
CREATE VIEW v_project_metrics WITH (security_invoker = true) AS
  WITH a AS (
    SELECT a.*,
      -- (closure_outcome is set exactly when closed; the 'closed' literal cannot
      -- be used in the same migration run that added it.)
      a.status <> 'verified_complete' AND a.closure_outcome IS NULL AS is_open,
      (SELECT max(r.created_at) FROM reviews r WHERE r.action_id = a.id AND r.outcome = 'accept') AS verified_at,
      greatest(a.updated_at,
        (SELECT max(pu.created_at) FROM progress_updates pu WHERE pu.action_id = a.id),
        (SELECT max(es.created_at) FROM evidence_submissions es WHERE es.action_id = a.id)) AS last_touched
    FROM actions a WHERE a.status <> 'draft'
  )
  SELECT
    p.id AS project_id,
    p.org_id,
    count(a.id)::int AS actions_total,
    count(a.id) FILTER (WHERE a.status = 'verified_complete')::int AS verified,
    count(a.id) FILTER (WHERE a.status = 'awaiting_review')::int AS awaiting_review,
    count(a.id) FILTER (WHERE a.status = 'blocked')::int AS blocked,
    count(a.id) FILTER (WHERE a.is_open AND a.due_date < (now() AT TIME ZONE 'Asia/Riyadh')::date)::int AS overdue,
    -- Verified by the agreed date, out of verified actions that had one.
    round(100.0 * count(a.id) FILTER (
        WHERE a.status = 'verified_complete' AND (a.verified_at AT TIME ZONE 'Asia/Riyadh')::date <= a.baseline_due_date)
      / nullif(count(a.id) FILTER (WHERE a.status = 'verified_complete' AND a.baseline_due_date IS NOT NULL), 0), 1) AS on_time_rate,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM now() - a.awaiting_review_at) / 86400)
      FILTER (WHERE a.status = 'awaiting_review'))::numeric, 1) AS median_days_awaiting_review,
    (SELECT count(*) FROM deadline_change_requests d WHERE d.project_id = p.id AND d.status = 'approved')::int AS deadline_slips,
    (SELECT round(100.0 * count(*) FILTER (WHERE r.outcome = 'revise') / nullif(count(*), 0), 1)
       FROM reviews r WHERE r.project_id = p.id) AS revision_rate,
    count(a.id) FILTER (WHERE a.is_open AND a.last_touched < now() - interval '14 days')::int AS stale_actions
  FROM projects p LEFT JOIN a ON a.project_id = p.id
  GROUP BY p.id, p.org_id;
--> statement-breakpoint
GRANT SELECT ON v_project_metrics TO selah_app;
--> statement-breakpoint

-- Snapshots are written by the monthly job only, and read like the project.
GRANT SELECT ON metric_snapshots TO selah_app;
--> statement-breakpoint
ALTER TABLE metric_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY scoped_read ON metric_snapshots FOR SELECT TO selah_app USING (app_can_see_project(project_id));
--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON metric_snapshots FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
-- Copy today's metrics of every active project; safe to run twice.
CREATE FUNCTION app_snapshot_metrics(as_of date) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  INSERT INTO metric_snapshots (project_id, org_id, metric, value, as_of)
    SELECT m.project_id, m.org_id, e.key, e.value::numeric, as_of
    FROM v_project_metrics m JOIN projects p ON p.id = m.project_id AND p.state = 'active',
         jsonb_each_text(to_jsonb(m) - '{project_id,org_id}'::text[]) e
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_snapshot_metrics(date) FROM PUBLIC;
--> statement-breakpoint

-- ------------------------------------------------------------- the team

-- Each colleague's current load, for the firm admin's staffing decisions.
-- Sorted by name; there is no score or ranking.
CREATE FUNCTION app_team_workload()
RETURNS TABLE (user_id uuid, name text, role role, clients integer, projects integer, open_reviews integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_role() IS DISTINCT FROM 'firm_admin' THEN
    RAISE EXCEPTION 'only the firm admin sees the team' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT u.id, u.name, m.role,
      (SELECT count(*) FROM client_assignments ca WHERE ca.user_id = u.id)::int,
      (SELECT count(*) FROM project_members pm JOIN projects p ON p.id = pm.project_id AND p.state <> 'closed'
         WHERE pm.user_id = u.id)::int,
      (SELECT count(*) FROM actions a JOIN projects p ON p.id = a.project_id
         WHERE a.status = 'awaiting_review' AND (
           EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = a.project_id AND pm.user_id = u.id)
           OR (p.kind = 'client' AND EXISTS (
             SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = p.org_id AND ca.user_id = u.id AND ca.is_lead))))::int
    FROM org_memberships m JOIN "user" u ON u.id = m.user_id
    WHERE m.org_id = app_org() AND m.active
    ORDER BY u.name, u.id;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_team_workload() TO selah_app;
--> statement-breakpoint
-- The team as a whole: how long reviews take (from the evidence that started
-- the round to the review), and what is waiting. Never per person.
CREATE FUNCTION app_team_metrics(since date)
RETURNS TABLE (reviews integer, median_review_days numeric, awaiting_review integer, overdue integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_role() IS DISTINCT FROM 'firm_admin' THEN
    RAISE EXCEPTION 'only the firm admin sees the team' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    WITH firm_actions AS (
      SELECT a.* FROM actions a JOIN projects p ON p.id = a.project_id WHERE p.firm_org_id = app_org()
    ),
    rounds AS (
      SELECT r.created_at - (
        SELECT min(es.created_at) FROM evidence_submissions es
        WHERE es.action_id = r.action_id AND es.created_at <= r.created_at
          AND es.created_at > COALESCE((SELECT max(r0.created_at) FROM reviews r0
                                          WHERE r0.action_id = r.action_id AND r0.created_at < r.created_at), '-infinity')
      ) AS took
      FROM reviews r JOIN firm_actions fa ON fa.id = r.action_id
      WHERE r.created_at >= since
    )
    SELECT
      (SELECT count(*) FROM rounds)::int,
      (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM took) / 86400))::numeric, 1)
         FROM rounds WHERE took IS NOT NULL),
      (SELECT count(*) FROM firm_actions WHERE status = 'awaiting_review')::int,
      (SELECT count(*) FROM firm_actions WHERE status NOT IN ('draft', 'verified_complete', 'closed')
         AND due_date < (now() AT TIME ZONE 'Asia/Riyadh')::date)::int;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_team_metrics(date) TO selah_app;
--> statement-breakpoint

-- --------------------------------------------------------- firm settings

GRANT SELECT, INSERT, UPDATE ON firm_settings TO selah_app;
--> statement-breakpoint
ALTER TABLE firm_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY firm_read ON firm_settings FOR SELECT TO selah_app USING (org_id = app_org() AND app_org_kind() = 'firm');
--> statement-breakpoint
CREATE POLICY admin_write ON firm_settings FOR ALL TO selah_app
  USING (org_id = app_org() AND app_role() = 'firm_admin')
  WITH CHECK (org_id = app_org() AND app_role() = 'firm_admin');
--> statement-breakpoint

-- --------------------------------------------- client KPIs (optional)

CREATE FUNCTION app_kpis_on(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
    SELECT fs.client_kpis_enabled FROM projects p JOIN firm_settings fs ON fs.org_id = p.firm_org_id WHERE p.id = pid
  ), false)
$$;
--> statement-breakpoint
CREATE FUNCTION app_kpi_grace(pid uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
    SELECT fs.kpi_grace_days FROM projects p JOIN firm_settings fs ON fs.org_id = p.firm_org_id WHERE p.id = pid
  ), 10)
$$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON strategic_objectives, kpis, recommendation_kpis TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON kpi_readings TO selah_app;
--> statement-breakpoint
ALTER TABLE strategic_objectives ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE kpis ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE kpi_readings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recommendation_kpis ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY scoped_read ON strategic_objectives FOR SELECT TO selah_app
  USING (app_kpis_on(project_id) AND app_can_see_project(project_id));
--> statement-breakpoint
CREATE POLICY firm_write ON strategic_objectives FOR ALL TO selah_app
  USING (app_kpis_on(project_id) AND app_org_kind() = 'firm' AND app_can_see_project(project_id))
  WITH CHECK (app_kpis_on(project_id) AND app_org_kind() = 'firm' AND app_can_see_project(project_id));
--> statement-breakpoint
CREATE POLICY scoped_read ON kpis FOR SELECT TO selah_app
  USING (app_kpis_on(project_id) AND app_can_see_project(project_id));
--> statement-breakpoint
CREATE POLICY firm_write ON kpis FOR ALL TO selah_app
  USING (app_kpis_on(project_id) AND app_org_kind() = 'firm' AND app_can_see_project(project_id))
  WITH CHECK (app_kpis_on(project_id) AND app_org_kind() = 'firm' AND app_can_see_project(project_id));
--> statement-breakpoint
CREATE POLICY scoped_read ON recommendation_kpis FOR SELECT TO selah_app
  USING (app_kpis_on(project_id) AND app_can_see_project(project_id));
--> statement-breakpoint
CREATE POLICY firm_write ON recommendation_kpis FOR ALL TO selah_app
  USING (app_kpis_on(project_id) AND app_org_kind() = 'firm' AND app_can_see_project(project_id))
  WITH CHECK (app_kpis_on(project_id) AND app_org_kind() = 'firm' AND app_can_see_project(project_id));
--> statement-breakpoint
CREATE POLICY scoped_read ON kpi_readings FOR SELECT TO selah_app
  USING (app_kpis_on(project_id) AND app_can_see_project(project_id));
--> statement-breakpoint
-- The KPI's owner (or the firm) reports a value, in their own name.
CREATE POLICY report ON kpi_readings FOR INSERT TO selah_app WITH CHECK (
  app_kpis_on(project_id) AND app_can_see_project(project_id) AND reported_by = app_uid()
  AND status = 'reported' AND verified_by IS NULL
  AND (app_org_kind() = 'firm' OR EXISTS (SELECT 1 FROM kpis k WHERE k.id = kpi_id AND k.owner_user_id = app_uid()))
);
--> statement-breakpoint
CREATE POLICY firm_verify ON kpi_readings FOR UPDATE TO selah_app
  USING (app_kpis_on(project_id) AND app_org_kind() = 'firm' AND app_can_see_project(project_id))
  WITH CHECK (app_kpis_on(project_id) AND app_org_kind() = 'firm' AND app_can_see_project(project_id));
--> statement-breakpoint
CREATE FUNCTION check_kpi() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM strategic_objectives o WHERE o.id = NEW.objective_id AND o.project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'the objective must be in the same project' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.owner_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM org_memberships m JOIN project_members pm ON pm.user_id = m.user_id AND pm.project_id = NEW.project_id
    WHERE m.user_id = NEW.owner_user_id AND m.org_id = NEW.org_id AND m.active
  ) THEN
    RAISE EXCEPTION 'the owner must be an active member of the project team' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER kpi_rules BEFORE INSERT OR UPDATE ON kpis FOR EACH ROW EXECUTE FUNCTION check_kpi();
--> statement-breakpoint
-- Periods start on the 1st, so monthly and quarterly steps never drift.
ALTER TABLE kpis ADD CONSTRAINT kpi_starts_on_first CHECK (extract(day FROM start_date) = 1);
--> statement-breakpoint
CREATE FUNCTION check_recommendation_kpi() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM recommendations r WHERE r.id = NEW.recommendation_id AND r.project_id = NEW.project_id)
     OR NOT EXISTS (SELECT 1 FROM kpis k WHERE k.id = NEW.kpi_id AND k.project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'the recommendation and the KPI must be in the same project' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER recommendation_kpi_rules BEFORE INSERT OR UPDATE ON recommendation_kpis
  FOR EACH ROW EXECUTE FUNCTION check_recommendation_kpi();
--> statement-breakpoint
-- The months between a KPI's periods.
CREATE FUNCTION app_kpi_step(f kpi_frequency) RETURNS interval
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE f WHEN 'monthly' THEN interval '1 month' ELSE interval '3 months' END $$;
--> statement-breakpoint
CREATE FUNCTION check_kpi_reading() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k kpis;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- The firm verifies or rejects a reported value, once; nothing else changes.
    IF OLD.status <> 'reported' OR NEW.status = 'reported'
       OR (to_jsonb(NEW) - '{status,verified_by,verified_at,note}'::text[])
          <> (to_jsonb(OLD) - '{status,verified_by,verified_at,note}'::text[]) THEN
      RAISE EXCEPTION 'a reading is only verified or rejected, once' USING ERRCODE = 'check_violation';
    END IF;
    -- Nobody verifies their own report, as with action reviews.
    IF NEW.status = 'verified' AND app_uid() IS NOT DISTINCT FROM OLD.reported_by THEN
      RAISE EXCEPTION 'a reading is verified by someone other than its reporter' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.verified_by := app_uid();
    NEW.verified_at := now();
    RETURN NEW;
  END IF;

  SELECT * INTO k FROM kpis WHERE id = NEW.kpi_id;
  IF k.id IS NULL OR k.project_id <> NEW.project_id OR NOT k.active THEN
    RAISE EXCEPTION 'readings are for active KPIs of the project' USING ERRCODE = 'check_violation';
  END IF;
  -- A reading is for one of the KPI's periods.
  IF NOT EXISTS (
    SELECT 1 FROM generate_series(k.start_date::timestamp, k.target_date::timestamp, app_kpi_step(k.frequency)) g
    WHERE g::date = NEW.period_start
  ) THEN
    RAISE EXCEPTION 'that is not one of the KPI''s periods' USING ERRCODE = 'check_violation';
  END IF;
  IF app_uid() IS NOT NULL AND NEW.period_start > (now() AT TIME ZONE 'Asia/Riyadh')::date THEN
    RAISE EXCEPTION 'that period has not started yet' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM kpi_readings r WHERE r.id = NEW.supersedes_id AND r.kpi_id = NEW.kpi_id AND r.period_start = NEW.period_start
  ) THEN
    RAISE EXCEPTION 'a correction replaces a reading of the same KPI and period' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.evidence_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM documents d WHERE d.id = NEW.evidence_document_id AND d.project_id = NEW.project_id
      AND d.scan_status IN ('clean', 'skipped')
  ) THEN
    RAISE EXCEPTION 'the evidence must be a scanned file of this project' USING ERRCODE = 'check_violation';
  END IF;
  IF app_uid() IS NOT NULL AND (NEW.status <> 'reported' OR NEW.verified_by IS NOT NULL) THEN
    RAISE EXCEPTION 'a reading starts as reported; the firm verifies it afterwards' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER kpi_reading_rules BEFORE INSERT OR UPDATE ON kpi_readings FOR EACH ROW EXECUTE FUNCTION check_kpi_reading();
--> statement-breakpoint
-- Each period of a KPI up to as_of, with its current reading (the latest
-- one not replaced by a correction). A period with no reading is "due"
-- until its end plus the firm's grace days, then "not_reported", never a
-- zero.
--   progress_pct  how far the value is from baseline to target
--   expected_pct  how far it should be by the period's end, on a straight
--                 line from start_date to target_date
--   rag           progress against expected: green at green_threshold % of
--                 expected or better, amber at amber_threshold %, else red
CREATE FUNCTION app_kpi_periods(kid uuid, as_of date)
RETURNS TABLE (
  period_start date, period_end date, reading_id uuid, value numeric, status text,
  progress_pct numeric, expected_pct numeric, rag text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH k AS (SELECT * FROM kpis WHERE id = kid),
  periods AS (
    SELECT g::date AS period_start, (g + app_kpi_step(k.frequency))::date - 1 AS period_end
    FROM k, generate_series(k.start_date::timestamp, least(k.target_date, as_of)::timestamp, app_kpi_step(k.frequency)) g
  ),
  current AS (
    SELECT DISTINCT ON (r.period_start) r.* FROM kpi_readings r
    WHERE r.kpi_id = kid AND NOT EXISTS (SELECT 1 FROM kpi_readings c WHERE c.supersedes_id = r.id)
    ORDER BY r.period_start, r.created_at DESC, r.id DESC
  ),
  scored AS (
    SELECT p.*, c.id AS reading_id, c.value, c.status AS reading_status, k.project_id, k.green_threshold, k.amber_threshold,
      100 * (c.value - k.baseline) / nullif(k.target - k.baseline, 0) AS progress,
      least(100.0, 100.0 * (least(p.period_end, k.target_date) - k.start_date + 1) / (k.target_date - k.start_date + 1)) AS expected
    FROM k, periods p LEFT JOIN current c ON c.period_start = p.period_start
  )
  SELECT s.period_start, s.period_end, s.reading_id, s.value,
    COALESCE(s.reading_status::text, CASE WHEN s.period_end + app_kpi_grace(s.project_id) < as_of THEN 'not_reported' ELSE 'due' END),
    round(s.progress, 1),
    round(s.expected, 1),
    CASE WHEN s.reading_id IS NULL OR s.reading_status = 'rejected' THEN NULL
         WHEN 100 * s.progress / s.expected >= s.green_threshold THEN 'green'
         WHEN 100 * s.progress / s.expected >= s.amber_threshold THEN 'amber'
         ELSE 'red' END
  FROM scored s
  ORDER BY s.period_start
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_kpi_periods(uuid, date) TO selah_app;
