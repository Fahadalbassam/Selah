-- ==========================================================================
-- The firm's day and "open action" in one place each (second review,
-- 2026-10-23, approved by Fahad). Every function and view that needed
-- "today" wrote out (now() AT TIME ZONE 'Asia/Riyadh')::date, and several
-- wrote out the open action states. They now call the functions below.
-- TypeScript holds the same values once (FIRM_TIME_ZONE and firmToday() in
-- src/lib/dates.ts, OPEN_STATUSES in src/authz/workflow.ts), and
-- tests/db/rule-parity.test.ts checks the two sides agree.
-- The functions and views after these are the baseline's (and 0001's) with
-- only those expressions replaced: no behaviour change.
-- ==========================================================================

CREATE FUNCTION app_firm_tz() RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$ SELECT 'Asia/Riyadh'::text $$;
--> statement-breakpoint
CREATE FUNCTION app_firm_today() RETURNS date
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$ SELECT (now() AT TIME ZONE app_firm_tz())::date $$;
--> statement-breakpoint
CREATE FUNCTION app_firm_date(at timestamptz) RETURNS date
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$ SELECT (at AT TIME ZONE app_firm_tz())::date $$;
--> statement-breakpoint
-- Released and not finished: assigned, in progress, blocked, awaiting review, sent back.
CREATE FUNCTION app_action_open(st action_status) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$ SELECT st NOT IN ('draft', 'verified_complete', 'closed') $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_firm_tz(), app_firm_today(), app_firm_date(timestamptz), app_action_open(action_status) TO selah_app;
--> statement-breakpoint
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
    RETURN NEW;
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'a decided request is final' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'pending' OR NEW.proposed_due_date <> OLD.proposed_due_date OR NEW.reason <> OLD.reason
     OR NEW.action_id <> OLD.action_id OR NEW.project_id <> OLD.project_id OR NEW.requested_by <> OLD.requested_by THEN
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
CREATE OR REPLACE FUNCTION app_team_metrics(since date)
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
      (SELECT count(*) FROM firm_actions WHERE app_action_open(status)
         AND due_date < app_firm_today())::int;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_kpi_reading() RETURNS trigger
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
  IF app_uid() IS NOT NULL AND NEW.period_start > app_firm_today() THEN
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
CREATE OR REPLACE FUNCTION schedule_checkins() RETURNS trigger
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
           ((NEW.handover_on + d)::timestamp + time '09:00') AT TIME ZONE app_firm_tz(),
           who, 'firm_private', author, d
    FROM unnest(app_checkin_days(NEW.firm_org_id)) d
  ON CONFLICT (project_id, checkin_day) DO UPDATE SET due_at = EXCLUDED.due_at
    WHERE follow_ups.status = 'open';
  RETURN NEW;
END $$;
--> statement-breakpoint
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
    WHERE k.active AND p.rag = 'red';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_inquiry_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  is_admin boolean := app_role() = 'firm_admin';
  owner_cols text[] := ARRAY['status', 'updated_at'];
  admin_cols text[] := ARRAY['status', 'owner_user_id', 'conflict_status', 'conflict_note', 'client_org_id', 'updated_at'];
  purge_cols text[] := ARRAY['org_name', 'org_name_ar', 'cr_number', 'contact_name', 'contact_role', 'contact_email', 'contact_phone',
                             'message', 'ip_hash', 'user_agent_hash', 'anonymised_at', 'updated_at'];
BEGIN
  -- Switching a client to minimal records clears its inquiry at once
  -- (forget_client_inquiries below): the requester's details to null, nothing else.
  IF (to_jsonb(NEW) - purge_cols) = (to_jsonb(OLD) - purge_cols) AND OLD.anonymised_at IS NULL AND NEW.anonymised_at IS NOT NULL
     AND NOT (jsonb_strip_nulls(to_jsonb(NEW)) ?| purge_cols[1:10])
     AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = NEW.client_org_id AND o.minimal_records) THEN
    RETURN NEW;
  END IF;
  IF app_uid() IS NULL THEN
    IF (to_jsonb(NEW) - purge_cols) <> (to_jsonb(OLD) - purge_cols) THEN
      RAISE EXCEPTION 'jobs only anonymise inquiries' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - CASE WHEN is_admin THEN admin_cols ELSE owner_cols END)
     <> (to_jsonb(OLD) - CASE WHEN is_admin THEN admin_cols ELSE owner_cols END) THEN
    RAISE EXCEPTION 'that change to an inquiry is not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.updated_at := now();

  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id AND NEW.owner_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM org_memberships m WHERE m.user_id = NEW.owner_user_id AND m.org_id = NEW.firm_org_id AND m.active
  ) THEN
    RAISE EXCEPTION 'the owner must be an active member of the firm' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.conflict_status IS DISTINCT FROM OLD.conflict_status OR NEW.conflict_note IS DISTINCT FROM OLD.conflict_note THEN
    IF NEW.conflict_status IN ('flagged', 'waived') AND NEW.conflict_note IS NULL THEN
      RAISE EXCEPTION 'say what the conflict is, or why it was waived' USING ERRCODE = 'check_violation';
    END IF;
    NEW.conflict_checked_by := app_uid();
    NEW.conflict_checked_at := now();
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT (
      (OLD.status, NEW.status) IN (('new', 'triaged'), ('triaged', 'discovery_scheduled'),
                                   ('discovery_scheduled', 'discovery_done'), ('discovery_done', 'proposal_sent'))
      OR (is_admin AND (
        (OLD.status IN ('discovery_done', 'proposal_sent') AND NEW.status = 'won')
        OR (OLD.status IN ('new', 'triaged', 'discovery_scheduled', 'discovery_done', 'proposal_sent')
            AND NEW.status IN ('lost', 'declined', 'withdrawn'))
        OR (OLD.status IN ('new', 'triaged') AND NEW.status = 'spam')
        OR (OLD.status = 'spam' AND NEW.status = 'new')))
    ) THEN
      RAISE EXCEPTION 'invalid inquiry status change % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'won' AND NEW.conflict_status NOT IN ('clear', 'waived') THEN
      RAISE EXCEPTION 'check for conflicts before winning an inquiry' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IN ('won', 'lost', 'declined', 'spam', 'withdrawn') THEN
      NEW.closed_at := now();
      NEW.purge_after := CASE NEW.status
        WHEN 'won' THEN NULL
        WHEN 'spam' THEN app_firm_today() + 30
        ELSE (app_firm_today() + interval '12 months')::date END;
    ELSE
      NEW.closed_at := NULL;
      NEW.purge_after := NULL;
    END IF;
  END IF;

  IF NEW.client_org_id IS DISTINCT FROM OLD.client_org_id THEN
    IF OLD.client_org_id IS NOT NULL OR NEW.status <> 'won'
       OR NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = NEW.client_org_id AND o.kind = 'client') THEN
      RAISE EXCEPTION 'a won inquiry becomes a client once' USING ERRCODE = 'check_violation';
    END IF;
    NEW.converted_by := app_uid();
    NEW.converted_at := now();
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_access_reviews_due(today date)
RETURNS TABLE (org_id uuid, admin_user_id uuid, last_review date)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH orgs AS (
    SELECT o.id, o.kind,
           coalesce((SELECT max(r.created_at) FROM access_reviews r WHERE r.org_id = o.id), o.created_at) AS since,
           (SELECT coalesce(max(s.access_review_days), 90) FROM firm_settings s) AS days
    FROM organizations o
    WHERE o.status = 'active' AND EXISTS (SELECT 1 FROM org_memberships m WHERE m.org_id = o.id AND m.active)
  ), admins AS (
    SELECT g.id AS org_id, m.user_id, g.since
    FROM orgs g JOIN org_memberships m ON m.org_id = g.id AND m.active
      AND m.role = CASE g.kind WHEN 'firm' THEN 'firm_admin'::role ELSE 'client_admin'::role END
    WHERE app_firm_date(g.since) + g.days <= today
  )
  SELECT a.org_id, a.user_id, app_firm_date(a.since) FROM admins a
  UNION ALL
  SELECT g.id, m.user_id, app_firm_date(g.since)
  FROM orgs g JOIN organizations f ON f.kind = 'firm'
  JOIN org_memberships m ON m.org_id = f.id AND m.active AND m.role = 'firm_admin'
  WHERE g.kind = 'client' AND app_firm_date(g.since) + g.days <= today
    AND NOT EXISTS (SELECT 1 FROM admins a WHERE a.org_id = g.id)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_notify_access_reviews(today date) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n integer := 0; r record;
BEGIN
  FOR r IN SELECT d.org_id, d.admin_user_id, d.last_review FROM app_access_reviews_due(today) d LOOP
    IF NOT EXISTS (
      SELECT 1 FROM notifications x WHERE x.user_id = r.admin_user_id AND x.kind = 'access_review.due' AND x.entity_id = r.org_id
        AND app_firm_date(x.created_at) >= r.last_review
    ) THEN
      INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES (r.admin_user_id, 'access_review.due', 'organization', r.org_id);
      INSERT INTO outbound_emails (to_email, kind, link)
        SELECT u.email, 'access_review.due', '/team' FROM "user" u WHERE u.id = r.admin_user_id;
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_meeting_agenda(pid uuid, before timestamptz, lang text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  today date := app_firm_today();
  last_held timestamptz := (SELECT max(m.starts_at) FROM meetings m WHERE m.project_id = pid AND m.status = 'held' AND m.starts_at < before);
  out text := '';
  part text;
  en boolean := lang = 'en';
BEGIN
  SELECT string_agg('- ' || a.title || CASE WHEN en THEN ' (due ' ELSE ' (الاستحقاق ' END || a.due_date || ')', E'\n' ORDER BY a.due_date) INTO part FROM (
    SELECT title, due_date FROM actions
    WHERE project_id = pid AND due_date < today AND app_action_open(status)
    ORDER BY due_date LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Overdue\n' ELSE E'## متأخرة\n' END || part || E'\n\n'; END IF;
  SELECT string_agg('- ' || a.title, E'\n' ORDER BY a.title) INTO part FROM (
    SELECT title FROM actions WHERE project_id = pid AND status = 'awaiting_review' ORDER BY title LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Awaiting review\n' ELSE E'## بانتظار المراجعة\n' END || part || E'\n\n'; END IF;
  SELECT string_agg('- ' || a.title || coalesce(': ' || a.blocked_reason, ''), E'\n' ORDER BY a.title) INTO part FROM (
    SELECT title, blocked_reason FROM actions WHERE project_id = pid AND status = 'blocked' ORDER BY title LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Blocked\n' ELSE E'## متوقفة\n' END || part || E'\n\n'; END IF;
  IF last_held IS NOT NULL THEN
    SELECT string_agg('- ' || c.title || ' (' || c.status || ')', E'\n' ORDER BY c.title) INTO part FROM (
      SELECT * FROM app_changed_actions(pid, last_held) ORDER BY title LIMIT 20) c;
    IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Changed since the last meeting\n' ELSE E'## ما تغيّر منذ الاجتماع السابق\n' END || part || E'\n\n'; END IF;
  END IF;
  RETURN nullif(rtrim(out, E'\n'), '');
END $$;
--> statement-breakpoint
CREATE OR REPLACE VIEW v_schedule WITH (security_invoker = true) AS
  SELECT 'meeting'::text AS item_type, m.id AS item_id, m.project_id, m.org_id, m.title, m.kind::text AS detail,
         m.starts_at, m.ends_at, false AS all_day, m.status::text AS status, m.visibility,
         array_remove(array_append(array(SELECT a.user_id FROM meeting_attendees a WHERE a.meeting_id = m.id AND a.user_id IS NOT NULL),
                                   m.organizer_id), NULL) AS people
  FROM meetings m
  UNION ALL
  SELECT 'action', a.id, a.project_id, a.org_id, a.title, NULL,
         (a.due_date::timestamp AT TIME ZONE app_firm_tz()), NULL, true, a.status::text, 'shared'::visibility,
         array_remove(ARRAY[a.owner_user_id], NULL)
  FROM actions a
  WHERE a.due_date IS NOT NULL AND app_action_open(a.status)
  UNION ALL
  SELECT 'follow_up', f.id, f.project_id, f.org_id, f.title, NULL,
         f.due_at, NULL, false, f.status::text, f.visibility,
         array_remove(ARRAY[f.assignee_user_id], NULL)
  FROM follow_ups f
  WHERE f.due_at IS NOT NULL AND f.status = 'open';
--> statement-breakpoint
CREATE OR REPLACE VIEW v_project_metrics WITH (security_invoker = true) AS
  WITH a AS (
    SELECT a.*,
      a.status <> 'verified_complete' AND a.closure_outcome IS NULL AS is_open,
      (SELECT max(r.created_at) FROM reviews r WHERE r.action_id = a.id AND r.outcome = 'accept') AS verified_at,
      greatest(a.updated_at,
        (SELECT max(pu.created_at) FROM progress_updates pu WHERE pu.action_id = a.id),
        (SELECT max(es.created_at) FROM evidence_submissions es WHERE es.action_id = a.id)) AS last_touched,
      CASE WHEN a.status = 'verified_complete' THEN app_verified_basis(a.id) END AS basis
    FROM actions a WHERE a.status <> 'draft'
  )
  SELECT
    p.id AS project_id,
    p.org_id,
    count(a.id)::int AS actions_total,
    count(a.id) FILTER (WHERE a.status = 'verified_complete')::int AS verified,
    count(a.id) FILTER (WHERE a.status = 'awaiting_review')::int AS awaiting_review,
    count(a.id) FILTER (WHERE a.status = 'blocked')::int AS blocked,
    count(a.id) FILTER (WHERE a.is_open AND a.due_date < app_firm_today())::int AS overdue,
    round(100.0 * count(a.id) FILTER (
        WHERE a.status = 'verified_complete' AND app_firm_date(a.verified_at) <= a.baseline_due_date)
      / nullif(count(a.id) FILTER (WHERE a.status = 'verified_complete' AND a.baseline_due_date IS NOT NULL), 0), 1) AS on_time_rate,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM now() - a.awaiting_review_at) / 86400)
      FILTER (WHERE a.status = 'awaiting_review'))::numeric, 1) AS median_days_awaiting_review,
    (SELECT count(*) FROM deadline_change_requests d WHERE d.project_id = p.id AND d.status = 'approved')::int AS deadline_slips,
    (SELECT round(100.0 * count(*) FILTER (WHERE r.outcome = 'revise') / nullif(count(*), 0), 1)
       FROM reviews r WHERE r.project_id = p.id) AS revision_rate,
    count(a.id) FILTER (WHERE a.is_open AND a.last_touched < now() - make_interval(days => app_stale_days(p.id)))::int AS stale_actions,
    count(a.id) FILTER (WHERE a.basis = 'client_evidence')::int AS verified_client_evidence,
    count(a.id) FILTER (WHERE a.basis = 'consultant_recorded')::int AS verified_consultant_recorded,
    count(a.id) FILTER (WHERE a.basis = 'mixed')::int AS verified_mixed
  FROM projects p LEFT JOIN a ON a.project_id = p.id
  GROUP BY p.id, p.org_id;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_assessment_followup(aid uuid)
RETURNS TABLE (answer_id uuid, ref text, finding_id uuid, finding_title text, recommendations integer, actions integer,
               reported integer, evidenced integer, verified integer, verified_client_evidence integer,
               verified_consultant_recorded integer, closed integer, overdue integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT x.id, q.ref, f.id, f.title,
         (SELECT count(*) FROM recommendations r WHERE r.finding_id = f.id)::integer,
         count(a.id)::integer,
         count(a.id) FILTER (WHERE a.status::text = 'awaiting_review')::integer,
         count(a.id) FILTER (WHERE EXISTS (SELECT 1 FROM evidence_submissions es WHERE es.action_id = a.id))::integer,
         count(a.id) FILTER (WHERE a.status::text = 'verified_complete')::integer,
         count(a.id) FILTER (WHERE a.status::text = 'verified_complete' AND app_verified_basis(a.id) = 'client_evidence')::integer,
         count(a.id) FILTER (WHERE a.status::text = 'verified_complete' AND app_verified_basis(a.id) = 'consultant_recorded')::integer,
         count(a.id) FILTER (WHERE a.status::text = 'closed')::integer,
         count(a.id) FILTER (WHERE a.status::text NOT IN ('verified_complete', 'closed') AND a.due_date < app_firm_today())::integer
  FROM assessment_answers x
  JOIN template_questions q ON q.id = x.question_id
  JOIN template_sections s ON s.id = q.section_id
  JOIN findings f ON f.assessment_answer_id = x.id
  LEFT JOIN recommendations r ON r.finding_id = f.id
  LEFT JOIN actions a ON a.recommendation_id = r.id AND a.status::text <> 'draft'
  WHERE x.assessment_id = aid
  GROUP BY x.id, q.ref, f.id, f.title, s.position, q.position
  ORDER BY s.position, q.position
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_meeting_transcript() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m meetings%ROWTYPE; keep integer;
BEGIN
  SELECT * INTO m FROM meetings WHERE id = NEW.meeting_id;
  IF NOT m.transcript_consent THEN
    RAISE EXCEPTION 'record that participants were told the meeting may be transcribed before importing a transcript'
      USING ERRCODE = 'check_violation';
  END IF;
  IF m.status::text <> 'held' THEN
    RAISE EXCEPTION 'a transcript can be imported only for a held meeting' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.project_id <> m.project_id OR NEW.org_id <> m.org_id THEN
    RAISE EXCEPTION 'a transcript belongs to its meeting''s project' USING ERRCODE = 'check_violation';
  END IF;
  NEW.imported_at := now();
  -- Already summarised: keep it for the firm's days from now; otherwise 90 days at most.
  SELECT coalesce(max(s.transcript_keep_days), 30) INTO keep FROM firm_settings s;
  NEW.delete_after := CASE
    WHEN EXISTS (SELECT 1 FROM meeting_summaries x WHERE x.meeting_id = NEW.meeting_id)
      THEN app_firm_today() + keep
    ELSE app_firm_today() + 90
  END;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION transcript_summary_confirmed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE keep integer;
BEGIN
  SELECT coalesce(max(s.transcript_keep_days), 30) INTO keep FROM firm_settings s;
  UPDATE meeting_transcripts SET delete_after = least(delete_after, app_firm_today() + keep)
  WHERE meeting_id = NEW.meeting_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_chat_delete_on(last_at timestamptz, pid uuid) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT least(
    app_firm_date(p.closed_at) + coalesce(fs.chat_after_close_days, 90),
    app_firm_date(last_at) + coalesce(fs.chat_idle_delete_days, 180))
  FROM projects p LEFT JOIN firm_settings fs ON fs.org_id = p.firm_org_id
  WHERE p.id = pid AND (session_user <> 'selah_app' OR app_can_see_project(pid))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_purge_chats(today date, OUT archived integer, OUT deleted integer)
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE ai_conversations c SET archived_at = now()
    FROM projects p LEFT JOIN firm_settings fs ON fs.org_id = p.firm_org_id
    WHERE p.id = c.project_id AND c.archived_at IS NULL AND NOT c.keep
      AND app_firm_date(c.last_message_at) + coalesce(fs.chat_archive_days, 30) <= today;
  GET DIAGNOSTICS archived = ROW_COUNT;

  WITH gone AS (
    DELETE FROM ai_conversations c USING projects p
      WHERE p.id = c.project_id AND app_chat_delete_on(c.last_message_at, c.project_id) <= today
      RETURNING c.id, c.user_id, p.org_id
  )
  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, reason)
    SELECT NULL, g.org_id, 'assistant.chat_deleted', 'ai_conversation', g.id, 'allow', 'retention'
    FROM gone g;
  GET DIAGNOSTICS deleted = ROW_COUNT;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION mail_action_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; addr text; matches boolean;
BEGIN
  NEW.mailed_at := NULL;
  IF NEW.entity_type <> 'action'
     OR NEW.kind NOT IN ('action.assigned', 'action.revision_requested', 'action.verified_complete', 'evidence.requested') THEN
    RETURN NEW;
  END IF;
  SELECT x.owner_user_id, x.status INTO a FROM actions x WHERE x.id = NEW.entity_id;
  IF NOT FOUND OR a.owner_user_id IS DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;
  matches := CASE NEW.kind
    -- Released to them, or handed to them while it's under way.
    WHEN 'action.assigned' THEN app_action_open(a.status)
    WHEN 'action.revision_requested' THEN a.status = 'revision_requested'
    WHEN 'action.verified_complete' THEN a.status = 'verified_complete'
    ELSE app_action_open(a.status)
      AND EXISTS (SELECT 1 FROM evidence_requests r WHERE r.action_id = NEW.entity_id AND r.status = 'open')
  END;
  IF NOT matches THEN
    RETURN NEW;
  END IF;
  IF NOT app_can_reset_password(NEW.user_id) THEN
    RETURN NEW; -- switched off or erased: no mail
  END IF;
  IF EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.user_id = NEW.user_id AND n.kind = NEW.kind AND n.entity_id = NEW.entity_id
      AND n.mailed_at > now() - interval '1 hour'
  ) THEN
    RETURN NEW;
  END IF;
  SELECT u.email INTO addr FROM "user" u WHERE u.id = NEW.user_id;
  IF addr IS NOT NULL THEN
    INSERT INTO outbound_emails (to_email, kind, link) VALUES (addr, NEW.kind, '/actions/' || NEW.entity_id);
    NEW.mailed_at := now();
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_record_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  who uuid := coalesce(to_jsonb(NEW) ->> 'author_id', to_jsonb(NEW) ->> 'submitted_by')::uuid;
  pk project_kind;
  mode engagement_mode;
BEGIN
  SELECT p.kind, o.engagement_mode INTO pk, mode FROM projects p JOIN organizations o ON o.id = p.org_id WHERE p.id = NEW.project_id;
  IF pk = 'internal' THEN
    NEW.source := 'internal';
  ELSIF (SELECT o.kind FROM organizations o WHERE o.id = app_user_org(who)) = 'firm' THEN
    IF mode IS DISTINCT FROM 'consultant_managed' THEN
      RAISE EXCEPTION 'the client records its own progress and evidence in this engagement' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.source := 'consultant_recorded';
    IF NEW.received_on > app_firm_today() THEN
      RAISE EXCEPTION 'received_on cannot be in the future' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    NEW.source := 'client_portal';
  END IF;
  RETURN NEW;
END $$;
