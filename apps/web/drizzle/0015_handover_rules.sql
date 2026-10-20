-- Handover continuity and deviations (2026-10-20, research section 8).
--
--  1. The client's sponsor: an active client admin or manager of the
--     project's client, told at the last escalation level.
--  2. Setting handover_on creates check-in follow-ups (30, 60, 90 days by
--     default); moving it moves the open ones.
--  3. v_deviations: the report's "deviation criteria" as fixed rules, read
--     under the caller's row-level security. AI may summarise these rows
--     later; the rules decide what counts.
--  4. ai_drafts: the outcome of each AI draft, for evaluation.

-- ------------------------------------------------------------ 1. sponsor

CREATE FUNCTION check_project_sponsor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.client_sponsor_user_id IS NOT NULL AND (
    NEW.kind <> 'client' OR NOT EXISTS (
      SELECT 1 FROM org_memberships m
      WHERE m.user_id = NEW.client_sponsor_user_id AND m.org_id = NEW.org_id AND m.active
        AND m.role IN ('client_admin', 'client_manager'))
  ) THEN
    RAISE EXCEPTION 'the sponsor must be an active admin or manager of the client' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER project_sponsor BEFORE INSERT OR UPDATE OF client_sponsor_user_id, org_id ON projects
  FOR EACH ROW EXECUTE FUNCTION check_project_sponsor();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_follow_ups_due(today date)
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
    -- level 3: the client's sponsor (if still an active admin or manager)
    SELECT s.id, s.kind, s.level, p.client_sponsor_user_id FROM steps s
      JOIN projects p ON p.id = s.project_id
      JOIN org_memberships m ON m.user_id = p.client_sponsor_user_id AND m.org_id = s.org_id AND m.active
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

--> statement-breakpoint
REVOKE ALL ON FUNCTION app_follow_ups_due(date) FROM PUBLIC;
--> statement-breakpoint

-- ------------------------------------------------------- 2. check-ins

CREATE FUNCTION app_checkin_days(firm uuid) RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT fs.checkin_days FROM firm_settings fs WHERE fs.org_id = firm), '{30,60,90}')
$$;
--> statement-breakpoint
-- Check-ins are firm tasks (firm_private), assigned to the client's lead
-- consultant (internal projects: a project lead), due at 09:00 Riyadh time.
CREATE FUNCTION schedule_checkins() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE who uuid; author uuid;
BEGIN
  IF NEW.handover_on IS NULL OR (TG_OP = 'UPDATE' AND NEW.handover_on IS NOT DISTINCT FROM OLD.handover_on) THEN
    RETURN NEW;
  END IF;
  who := CASE WHEN NEW.kind = 'client'
    THEN (SELECT ca.user_id FROM client_assignments ca WHERE ca.client_org_id = NEW.org_id AND ca.is_lead)
    ELSE (SELECT pm.user_id FROM project_members pm WHERE pm.project_id = NEW.id AND pm.is_lead ORDER BY pm.created_at LIMIT 1) END;
  author := COALESCE(app_uid(), NEW.created_by, who);
  IF author IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO follow_ups (project_id, org_id, title, due_at, assignee_user_id, visibility, created_by, checkin_day)
    SELECT NEW.id, NEW.org_id, format('Check-in %s days after handover', d),
           ((NEW.handover_on + d)::timestamp + time '09:00') AT TIME ZONE 'Asia/Riyadh',
           who, 'firm_private', author, d
    FROM unnest(app_checkin_days(NEW.firm_org_id)) d
  ON CONFLICT (project_id, checkin_day) DO UPDATE SET due_at = EXCLUDED.due_at
    WHERE follow_ups.status = 'open';
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER project_checkins AFTER INSERT OR UPDATE OF handover_on ON projects
  FOR EACH ROW EXECUTE FUNCTION schedule_checkins();
--> statement-breakpoint

-- ------------------------------------------------------- 3. deviations

CREATE FUNCTION app_stale_days(pid uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
    SELECT fs.stale_days FROM projects p JOIN firm_settings fs ON fs.org_id = p.firm_org_id WHERE p.id = pid
  ), 14)
$$;
--> statement-breakpoint
-- "Stale" now follows firm_settings.stale_days here too.
CREATE OR REPLACE VIEW v_project_metrics WITH (security_invoker = true) AS
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
    count(a.id) FILTER (WHERE a.is_open AND a.last_touched < now() - make_interval(days => app_stale_days(p.id)))::int AS stale_actions
  FROM projects p LEFT JOIN a ON a.project_id = p.id
  GROUP BY p.id, p.org_id;

--> statement-breakpoint
-- Is the user an active member of the org? (Readable for any user id: the
-- caller already sees the action that names them.)
CREATE FUNCTION app_member_active(uid uuid, org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = uid AND m.org_id = org AND m.active)
$$;
--> statement-breakpoint
-- One row per (open action or KPI, rule it breaks):
--   overdue           the current due date has passed
--   stale             no status change, progress update or evidence in stale_days
--   slipped           2 or more approved deadline changes
--   churn             2 or more revision requests
--   orphaned          the owner is no longer an active member
--   kpi_not_reported  a KPI period passed its grace days with no reading
--   kpi_off_target    the latest reading is in the red band
-- The KPI rules return nothing while client KPIs are off (their tables read
-- as empty).
CREATE VIEW v_deviations WITH (security_invoker = true) AS
  WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date AS d),
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
    WHERE k.active AND p.rag = 'red';
--> statement-breakpoint
GRANT SELECT ON v_deviations TO selah_app;
--> statement-breakpoint

-- -------------------------------------------------------- 4. AI drafts

-- Whoever saw the draft records its outcome; the firm reads them to
-- evaluate. Append-only.
GRANT SELECT, INSERT ON ai_drafts TO selah_app;
--> statement-breakpoint
ALTER TABLE ai_drafts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY firm_read ON ai_drafts FOR SELECT TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id));
--> statement-breakpoint
CREATE POLICY record ON ai_drafts FOR INSERT TO selah_app
  WITH CHECK (app_can_see_project(project_id) AND created_by = app_uid());
--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON ai_drafts FOR EACH ROW EXECUTE FUNCTION forbid_change();
