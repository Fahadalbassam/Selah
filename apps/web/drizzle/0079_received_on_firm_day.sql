-- ==========================================================================
-- "Received on" of a recommendation response is checked against the firm's
-- day (page audit, batch 0: the midnight bug). Migration 0045 compared it
-- with current_date, the day of the database session's time zone (UTC on
-- the server). Between midnight and 03:00 in Riyadh that is still
-- yesterday, so a consultant recording an answer the client gave "today"
-- was told the date was in the future. Migration 0001 fixed the same
-- mistake for progress and evidence (set_record_source()); every other
-- "today" in the database is app_firm_today().
--
-- The search for the same mistake elsewhere (current_date, now()::date or a
-- date compared with now(), in the latest definition of every function,
-- trigger, view and check) found one more place, not compared with a typed
-- date today but waiting to be: app_project_progress()'s default "today".
-- Every caller passes the firm's day, so nothing changes for them; a caller
-- that leaves it out now gets the firm's day too. Its body is 0047's.
-- ==========================================================================

CREATE OR REPLACE FUNCTION check_recommendation_response() RETURNS trigger
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
  IF NEW.received_on > app_firm_today() THEN
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
CREATE OR REPLACE FUNCTION app_project_progress(pid uuid, today date DEFAULT app_firm_today())
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
