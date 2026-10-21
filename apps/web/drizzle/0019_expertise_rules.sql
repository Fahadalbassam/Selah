-- Consultant expertise and lead suggestions (2026-10-20, research section 1).
--
-- The firm admin records which services and sectors each consultant can
-- lead; the consultant keeps their own languages and whether they can take
-- a new client. For a new inquiry, app_suggest_leads() lists the active
-- consultants whose declared services match it. It only suggests: the admin
-- still assigns the lead. No performance data is used, so it is a match
-- for one inquiry, not a ranking of people.

ALTER TABLE consultant_profiles ADD CONSTRAINT languages_known
  CHECK (cardinality(languages) > 0 AND languages <@ ARRAY['ar', 'en']);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON consultant_profiles, consultant_service_areas, consultant_sectors TO selah_app;
--> statement-breakpoint
ALTER TABLE consultant_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE consultant_service_areas ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE consultant_sectors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The firm's members read profiles (they staff each other); the admin
-- writes them, and a consultant updates their own.
CREATE POLICY firm_read ON consultant_profiles FOR SELECT TO selah_app
  USING (firm_org_id = app_org() AND app_org_kind() = 'firm');
--> statement-breakpoint
CREATE POLICY admin_insert ON consultant_profiles FOR INSERT TO selah_app
  WITH CHECK (firm_org_id = app_org() AND app_role() = 'firm_admin');
--> statement-breakpoint
CREATE POLICY firm_update ON consultant_profiles FOR UPDATE TO selah_app
  USING (firm_org_id = app_org() AND app_org_kind() = 'firm' AND (app_role() = 'firm_admin' OR user_id = app_uid()))
  WITH CHECK (firm_org_id = app_org());
--> statement-breakpoint
CREATE POLICY admin_delete ON consultant_profiles FOR DELETE TO selah_app
  USING (firm_org_id = app_org() AND app_role() = 'firm_admin');
--> statement-breakpoint
CREATE FUNCTION app_is_firm_profile(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM consultant_profiles p WHERE p.user_id = target AND p.firm_org_id = app_org() AND app_org_kind() = 'firm')
$$;
--> statement-breakpoint
CREATE POLICY firm_read ON consultant_service_areas FOR SELECT TO selah_app USING (app_is_firm_profile(user_id));
--> statement-breakpoint
CREATE POLICY admin_write ON consultant_service_areas FOR ALL TO selah_app
  USING (app_is_firm_profile(user_id) AND app_role() = 'firm_admin')
  WITH CHECK (app_is_firm_profile(user_id) AND app_role() = 'firm_admin');
--> statement-breakpoint
CREATE POLICY firm_read ON consultant_sectors FOR SELECT TO selah_app USING (app_is_firm_profile(user_id));
--> statement-breakpoint
CREATE POLICY admin_write ON consultant_sectors FOR ALL TO selah_app
  USING (app_is_firm_profile(user_id) AND app_role() = 'firm_admin')
  WITH CHECK (app_is_firm_profile(user_id) AND app_role() = 'firm_admin');
--> statement-breakpoint
-- A profile belongs to an active consultant of that firm, and stays theirs.
-- A consultant may change only their languages and availability.
CREATE FUNCTION check_consultant_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  own_cols text[] := ARRAY['languages', 'accepting_new_clients', 'updated_at'];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id <> OLD.user_id OR NEW.firm_org_id <> OLD.firm_org_id THEN
      RAISE EXCEPTION 'a profile stays with its consultant' USING ERRCODE = 'check_violation';
    END IF;
    IF app_uid() IS NOT NULL AND app_role() IS DISTINCT FROM 'firm_admin'
       AND (to_jsonb(NEW) - own_cols) <> (to_jsonb(OLD) - own_cols) THEN
      RAISE EXCEPTION 'that change to a profile is not allowed' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM org_memberships m
    WHERE m.user_id = NEW.user_id AND m.org_id = NEW.firm_org_id AND m.active AND m.role = 'consultant'
  ) THEN
    RAISE EXCEPTION 'a profile is for an active consultant of the firm' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER consultant_profile BEFORE INSERT OR UPDATE ON consultant_profiles
  FOR EACH ROW EXECUTE FUNCTION check_consultant_profile();
--> statement-breakpoint

-- ----------------------------------------------------------- suggestions

-- Up to five consultants for one inquiry, for its firm's admins. Each row
-- says why it is there: the inquiry's services they cover, whether they
-- know its sector and speak its language, whether they are taking new
-- clients, and how many active clients they already have. Consultants who
-- cover none of the services are left out, so an empty list means nobody
-- fits. The order puts available people with the closest match and the
-- lightest load first.
CREATE FUNCTION app_suggest_leads(iid uuid)
RETURNS TABLE (user_id uuid, name text, matched_services text[], sector_match boolean, speaks_language boolean,
               accepting_new_clients boolean, active_clients integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  inq inquiries%ROWTYPE;
BEGIN
  SELECT * INTO inq FROM inquiries i WHERE i.id = iid;
  IF NOT FOUND OR inq.firm_org_id IS DISTINCT FROM app_org() OR app_role() IS DISTINCT FROM 'firm_admin' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT COALESCE((SELECT s.suggestions_enabled FROM firm_settings s WHERE s.org_id = inq.firm_org_id), true) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT p.user_id, u.name,
         array_agg(sa.code ORDER BY sa.sort_order, sa.code),
         EXISTS (SELECT 1 FROM consultant_sectors cs WHERE cs.user_id = p.user_id AND cs.sector_id = inq.sector_id),
         inq.preferred_language = ANY (p.languages),
         p.accepting_new_clients,
         (SELECT count(*)::integer FROM client_assignments ca JOIN organizations o ON o.id = ca.client_org_id
           WHERE ca.user_id = p.user_id AND o.status = 'active')
  FROM consultant_profiles p
  JOIN "user" u ON u.id = p.user_id
  JOIN org_memberships m ON m.user_id = p.user_id AND m.org_id = p.firm_org_id AND m.active AND m.role = 'consultant'
  JOIN consultant_service_areas csa ON csa.user_id = p.user_id
  JOIN inquiry_services isv ON isv.service_area_id = csa.service_area_id AND isv.inquiry_id = inq.id
  JOIN service_areas sa ON sa.id = csa.service_area_id
  WHERE p.firm_org_id = inq.firm_org_id
  GROUP BY p.user_id, u.name, p.languages, p.accepting_new_clients
  ORDER BY 6 DESC, cardinality(array_agg(sa.code)) DESC, 4 DESC, 5 DESC, 7 ASC, 2 ASC
  LIMIT 5;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_suggest_leads(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_suggest_leads(uuid) TO selah_app;
