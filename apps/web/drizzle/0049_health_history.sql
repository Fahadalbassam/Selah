CREATE TABLE "project_health_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"signal" text NOT NULL,
	"open" integer NOT NULL,
	"overdue" integer NOT NULL,
	"cautions" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_health_weeks" ADD CONSTRAINT "project_health_weeks_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_health_weeks_once" ON "project_health_weeks" USING btree ("project_id","week_start");
--> statement-breakpoint
-- --------------------------------- health history and quiet clients (F18)
-- The daily job keeps each open project's signal per week
-- (project_health_weeks), and tells a client's lead consultant when no one
-- at the client has done anything on an active project for two weeks.

-- The job runs as the schema owner with no user: it counts every move. Under
-- the app role the caller still sees only actions they can see.
CREATE OR REPLACE FUNCTION app_action_extensions(act uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int FROM action_due_changes c
  WHERE c.action_id = act AND c.to_date > c.from_date
    AND (app_can_see_action(act) OR (app_uid() IS NULL AND session_user NOT IN ('selah_app', 'selah_auth')))
$$;
--> statement-breakpoint
-- One project's counts and signal, under the caller's row-level security
-- (the job's owner sees everything). app_portfolio() and the job share it.
CREATE FUNCTION app_project_health(pid uuid, today date DEFAULT app_firm_today())
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
      (SELECT count(DISTINCT d.entity_id) FROM v_deviations d WHERE d.project_id = pid AND d.rule = 'stale')::int AS stale,
      (SELECT count(DISTINCT d.entity_id) FROM v_deviations d WHERE d.project_id = pid AND d.rule = 'orphaned')::int AS orphaned,
      (SELECT count(DISTINCT d.entity_id) FROM v_deviations d WHERE d.project_id = pid AND d.rule = 'disputed')::int AS disputed
    FROM app_project_progress(pid, today) g
  ),
  y AS (SELECT x.*, x.blocked + x.extended_twice + x.orphaned + x.stale + x.review_waiting + x.disputed AS cautions FROM x)
  SELECT y.total, y.open, y.overdue, y.late_d1_30, y.late_d31_60, y.late_d61_90, y.late_d90_plus, y.late_long,
    y.extended_twice, y.blocked, y.awaiting_review, y.review_waiting, y.oldest_review_days,
    y.stale, y.orphaned, y.disputed, y.risk_accepted, y.cautions,
    app_health_signal(y.total, y.open, y.overdue, y.late_long, y.cautions)
  FROM y
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_project_health(uuid, date) TO selah_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_portfolio(today date DEFAULT app_firm_today())
RETURNS TABLE (
  project_id uuid, org_id uuid, kind text, state text, total integer, open integer, overdue integer,
  late_d1_30 integer, late_d31_60 integer, late_d61_90 integer, late_d90_plus integer, late_long integer,
  extended_twice integer, blocked integer, awaiting_review integer, review_waiting integer, oldest_review_days integer,
  stale integer, orphaned integer, disputed integer, risk_accepted integer, lead_id uuid, client_last_active timestamptz, signal text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.org_id, p.kind::text, p.state::text, h.total, h.open, h.overdue,
    h.late_d1_30, h.late_d31_60, h.late_d61_90, h.late_d90_plus, h.late_long,
    h.extended_twice, h.blocked, h.awaiting_review, h.review_waiting, h.oldest_review_days,
    h.stale, h.orphaned, h.disputed, h.risk_accepted, app_project_lead(p.id), app_client_last_active(p.id), h.signal
  FROM projects p, app_project_health(p.id, today) h
  WHERE app_org_kind() = 'firm' AND p.state::text IN ('planned', 'active', 'closing')
$$;
--> statement-breakpoint
-- lib/health.ts CLIENT_QUIET_DAYS.
CREATE FUNCTION app_client_quiet_days() RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$ SELECT 14 $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_client_quiet_days() TO selah_app;
--> statement-breakpoint
-- The Sunday a firm day's week starts on.
CREATE FUNCTION app_week_start(day date) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$ SELECT day - extract(dow FROM day)::int $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_week_start(date) TO selah_app;
--> statement-breakpoint
GRANT SELECT ON project_health_weeks TO selah_app;
--> statement-breakpoint
ALTER TABLE project_health_weeks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY firm_read ON project_health_weeks FOR SELECT TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id));
--> statement-breakpoint
-- The job, as the schema owner: this week's row for every open project,
-- kept up to date until the week ends. Safe to run twice.
CREATE FUNCTION app_snapshot_health(today date) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  INSERT INTO project_health_weeks (project_id, org_id, week_start, signal, open, overdue, cautions)
    SELECT p.id, p.org_id, app_week_start(today), h.signal, h.open, h.overdue, h.cautions
    FROM projects p, app_project_health(p.id, today) h
    WHERE p.state::text IN ('planned', 'active', 'closing')
  ON CONFLICT (project_id, week_start) DO UPDATE
    SET signal = excluded.signal, open = excluded.open, overdue = excluded.overdue, cautions = excluded.cautions, updated_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_snapshot_health(date) FROM PUBLIC;
--> statement-breakpoint
-- The job, as the schema owner: tell the client's lead (and the firm admins
-- when there is none) about an active project with open released work where
-- no one at the client has done anything for CLIENT_QUIET_DAYS, counted from
-- the client's last activity or, before any, the first release. Once per
-- quiet spell: not again until the client acts. A consultant-managed client
-- never signs in, so it is never quiet.
CREATE FUNCTION app_alert_quiet_clients(today date) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  WITH q AS (
    SELECT p.id AS project_id, p.org_id, p.firm_org_id,
      coalesce(
        (SELECT max(e.created_at) FROM activity_events e JOIN org_memberships m ON m.user_id = e.actor_id AND m.org_id = p.org_id
         WHERE e.project_id = p.id),
        (SELECT min(e.created_at) FROM activity_events e WHERE e.project_id = p.id AND e.entity_type = 'action' AND e.to_state = 'assigned'),
        p.created_at) AS since
    FROM projects p JOIN organizations o ON o.id = p.org_id
    WHERE p.kind = 'client' AND p.state = 'active' AND o.engagement_mode IN ('full', 'restricted') AND o.status = 'active'
      AND EXISTS (SELECT 1 FROM actions a WHERE a.project_id = p.id AND a.status NOT IN ('draft', 'verified_complete') AND a.closure_outcome IS NULL)
  ),
  quiet AS (
    SELECT q.* FROM q WHERE app_firm_date(q.since) <= today - app_client_quiet_days()
      AND NOT EXISTS (SELECT 1 FROM notifications x WHERE x.kind = 'project.client_quiet' AND x.entity_id = q.project_id AND x.created_at > q.since)
  ),
  who AS (
    SELECT quiet.project_id, ca.user_id FROM quiet JOIN client_assignments ca ON ca.client_org_id = quiet.org_id AND ca.is_lead
    UNION
    SELECT quiet.project_id, m.user_id FROM quiet JOIN org_memberships m ON m.org_id = quiet.firm_org_id AND m.role = 'firm_admin' AND m.active
    WHERE NOT EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = quiet.org_id AND ca.is_lead)
  )
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT who.user_id, 'project.client_quiet', 'project', who.project_id FROM who
    WHERE app_member_active(who.user_id, (SELECT p.firm_org_id FROM projects p WHERE p.id = who.project_id));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_alert_quiet_clients(date) FROM PUBLIC;
--> statement-breakpoint
-- The quiet-client alert is mailed with the person's reminders (migration 0019).
CREATE OR REPLACE FUNCTION app_queue_digests(today date) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  WITH due AS (
    SELECT x.id FROM notifications x
    CROSS JOIN LATERAL app_mail_choice(x.user_id) c
    WHERE x.mailed_at IS NULL AND x.read_at IS NULL
      AND x.created_at > now() - interval '8 days'
      AND CASE
        WHEN x.entity_type = 'action' AND x.kind LIKE 'follow_up.%' THEN app_cadence_due(c.reminders, today)
        -- information requests waiting on the client (migration 0017), one per project
        WHEN x.entity_type = 'project' AND x.kind IN ('info_request.due_soon', 'info_request.overdue') THEN app_cadence_due(c.reminders, today)
        -- a client quiet for two weeks (F18)
        WHEN x.entity_type = 'project' AND x.kind = 'project.client_quiet' THEN app_cadence_due(c.reminders, today)
        WHEN x.entity_type = 'action' AND x.kind = ANY (app_update_mail_kinds()) THEN c.updates <> 'instant' AND app_cadence_due(c.updates, today)
        ELSE false
      END
      AND NOT EXISTS (SELECT 1 FROM mail_mutes m WHERE m.user_id = x.user_id AND m.action_id = x.entity_id)
    FOR UPDATE OF x SKIP LOCKED
  ),
  marked AS (
    UPDATE notifications x SET mailed_at = now() FROM due WHERE x.id = due.id RETURNING x.user_id
  ),
  mailed AS (
    INSERT INTO outbound_emails (to_email, kind, link)
    SELECT u.email, 'follow_up.digest', '/notifications'
    FROM (SELECT DISTINCT user_id FROM marked) m
    JOIN "user" u ON u.id = m.user_id
    WHERE app_can_reset_password(m.user_id)
      AND NOT EXISTS (
        SELECT 1 FROM outbound_emails o
        WHERE o.kind = 'follow_up.digest' AND lower(o.to_email) = lower(u.email) AND app_firm_date(o.created_at) = app_firm_today()
      )
    RETURNING 1
  )
  SELECT count(*) INTO n FROM mailed;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_queue_digests(date) FROM PUBLIC;
