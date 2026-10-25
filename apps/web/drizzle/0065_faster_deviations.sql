-- ------------------------------------------------ the deviations view, computed per project
-- The open actions inside v_deviations were a materialised CTE, so every read
-- of the view worked out every open action of the whole firm (with its date
-- changes, updates and reviews) before filtering, even when the caller asked
-- for one project and one rule. app_project_health() reads it several times
-- per project, so the oversight page took about 1.5 s for six projects on the
-- walkthrough data and grew with projects x actions. NOT MATERIALIZED lets
-- Postgres push the project and rule filters into each branch and skip the
-- columns a branch does not use: same rows (checked on the walkthrough data),
-- about eight times faster. Found 2026-10-25 while profiling slow pages.
--
-- app_project_health() also read the view three times per project (stale,
-- orphaned, disputed); it now reads it once for all three counts.
CREATE OR REPLACE VIEW v_deviations WITH (security_invoker = true) AS
  WITH today AS (SELECT app_firm_today() AS d),
  a AS NOT MATERIALIZED (
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
CREATE OR REPLACE FUNCTION app_project_health(pid uuid, today date DEFAULT app_firm_today())
RETURNS TABLE (
  total integer, open integer, overdue integer,
  late_d1_30 integer, late_d31_60 integer, late_d61_90 integer, late_d90_plus integer, late_long integer,
  extended_twice integer, blocked integer, awaiting_review integer, review_waiting integer, oldest_review_days integer,
  stale integer, orphaned integer, disputed integer, risk_accepted integer, cautions integer, signal text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH x AS (
    SELECT g.*,
      (SELECT count(*) FROM app_action_slips(pid, today) s WHERE s.days_late > app_health_late_days())::int AS late_long,
      (SELECT count(*) FROM actions a WHERE a.project_id = pid AND a.status = 'blocked' AND a.closure_outcome IS NULL)::int AS blocked,
      (SELECT count(*) FROM actions a WHERE a.project_id = pid AND a.status = 'awaiting_review')::int AS awaiting_review,
      (SELECT count(*) FROM actions a WHERE a.project_id = pid AND a.status = 'awaiting_review'
         AND today - app_firm_date(a.updated_at) > app_review_wait_days())::int AS review_waiting,
      (SELECT max(today - app_firm_date(a.updated_at)) FROM actions a WHERE a.project_id = pid AND a.status = 'awaiting_review')::int AS oldest_review_days,
      dv.stale, dv.orphaned, dv.disputed
    FROM app_project_progress(pid, today) g,
      -- One read of the deviations for the three counts.
      (SELECT count(DISTINCT d.entity_id) FILTER (WHERE d.rule = 'stale')::int AS stale,
              count(DISTINCT d.entity_id) FILTER (WHERE d.rule = 'orphaned')::int AS orphaned,
              count(DISTINCT d.entity_id) FILTER (WHERE d.rule = 'disputed')::int AS disputed
       FROM v_deviations d WHERE d.project_id = pid AND d.rule IN ('stale', 'orphaned', 'disputed')) dv
  ),
  y AS (SELECT x.*, x.blocked + x.extended_twice + x.orphaned + x.stale + x.review_waiting + x.disputed AS cautions FROM x)
  SELECT y.total, y.open, y.overdue, y.late_d1_30, y.late_d31_60, y.late_d61_90, y.late_d90_plus, y.late_long,
    y.extended_twice, y.blocked, y.awaiting_review, y.review_waiting, y.oldest_review_days,
    y.stale, y.orphaned, y.disputed, y.risk_accepted, y.cautions,
    app_health_signal(y.total, y.open, y.overdue, y.late_long, y.cautions)
  FROM y
$$;
