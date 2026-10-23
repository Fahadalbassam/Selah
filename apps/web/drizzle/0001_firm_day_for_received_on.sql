-- ==========================================================================
-- "Received on" is checked against the firm's day (second review, 2026-10-23).
-- The baseline compared it with current_date, which is the database server's
-- day (UTC in the Docker image). Between midnight and 03:00 in Riyadh that is
-- still yesterday, so a consultant recording what the client sent today was
-- told the date was in the future. Every other "today" in Selah is the
-- Riyadh day (src/lib/dates.ts firmToday(), and the views and jobs).
-- ==========================================================================

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
    IF NEW.received_on > (now() AT TIME ZONE 'Asia/Riyadh')::date THEN
      RAISE EXCEPTION 'received_on cannot be in the future' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    NEW.source := 'client_portal';
  END IF;
  RETURN NEW;
END $$;
