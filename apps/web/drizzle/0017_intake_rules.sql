-- Client intake (2026-10-20, research section 1).
--
-- The public reaches the database through one function, submit_inquiry(),
-- which validates the form and forces a new inquiry's state; the app role
-- has no INSERT on inquiries. Firm admins see every inquiry and decide its
-- outcome; the consultant qualifying one (its owner) sees it and moves it
-- forward. Lost, declined, spam and withdrawn inquiries are anonymised after
-- a retention period by a job (PDPL data minimisation).

-- ------------------------------------------------------- reference lists

INSERT INTO service_areas (code, name_ar, name_en, sort_order) VALUES
  ('strategic_plan', 'الخطة الاستراتيجية', 'Strategic plan', 1),
  ('operational_plan', 'الخطة التشغيلية ومؤشرات الأداء', 'Operational plan and KPIs', 2),
  ('org_structure', 'الهيكل التنظيمي', 'Organizational structure', 3),
  ('delegation_matrix', 'مصفوفة الصلاحيات', 'Delegation of authority matrix', 4),
  ('policies_sops', 'السياسات والإجراءات', 'Policies and procedures', 5),
  ('corporate_governance', 'الحوكمة المؤسسية', 'Corporate governance', 6),
  ('family_business_governance', 'حوكمة الشركات العائلية', 'Family business governance', 7);
--> statement-breakpoint
INSERT INTO sectors (code, name_ar, name_en, sort_order) VALUES
  ('retail', 'التجزئة', 'Retail', 1),
  ('services', 'الخدمات', 'Services', 2),
  ('industrial', 'الصناعة', 'Industrial', 3),
  ('contracting', 'المقاولات', 'Contracting', 4),
  ('training', 'التدريب', 'Training', 5),
  ('trade_distribution', 'التجارة والتوزيع', 'Trade and distribution', 6),
  ('non_profit', 'القطاع غير الربحي', 'Non-profit', 7),
  ('other', 'أخرى', 'Other', 8);
--> statement-breakpoint
-- Everyone (the public form included) reads the lists; firm admins edit them.
GRANT SELECT, INSERT, UPDATE ON service_areas, sectors TO selah_app;
--> statement-breakpoint
ALTER TABLE service_areas ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sectors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY public_read ON service_areas FOR SELECT TO selah_app USING (true);
--> statement-breakpoint
CREATE POLICY admin_write ON service_areas FOR ALL TO selah_app
  USING (app_role() = 'firm_admin') WITH CHECK (app_role() = 'firm_admin');
--> statement-breakpoint
CREATE POLICY public_read ON sectors FOR SELECT TO selah_app USING (true);
--> statement-breakpoint
CREATE POLICY admin_write ON sectors FOR ALL TO selah_app
  USING (app_role() = 'firm_admin') WITH CHECK (app_role() = 'firm_admin');
--> statement-breakpoint

-- ---------------------------------------------------------- the public path

-- Errors the web route turns into answers: SL400 (a field is invalid; the
-- message names it) and SL429 (too many submissions from one address).
CREATE FUNCTION submit_inquiry(payload jsonb) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  firm uuid;
  sector uuid;
  services uuid[];
  codes text[];
  ref text;
  iid uuid;
  v text;
  bad text;
  fld text;
BEGIN
  IF (SELECT count(*) FROM organizations WHERE kind = 'firm') <> 1 THEN
    RAISE EXCEPTION 'intake needs exactly one firm' USING ERRCODE = 'SL500';
  END IF;
  SELECT id INTO firm FROM organizations WHERE kind = 'firm';

  -- Required and optional text, with lengths.
  FOREACH fld IN ARRAY ARRAY['org_name:1:200', 'contact_name:1:120', 'email:3:254', 'preferred_language:2:2', 'privacy_notice_version:1:40',
                             'org_name_ar:0:200', 'cr_number:0:20', 'contact_role:0:120', 'phone:0:30', 'message:0:2000'] LOOP
    v := btrim(payload ->> split_part(fld, ':', 1));
    IF (v IS NULL OR v = '') AND split_part(fld, ':', 2)::int > 0 THEN
      bad := split_part(fld, ':', 1);
    ELSIF length(v) > split_part(fld, ':', 3)::int OR length(v) < split_part(fld, ':', 2)::int THEN
      bad := split_part(fld, ':', 1);
    END IF;
    EXIT WHEN bad IS NOT NULL;
  END LOOP;
  IF bad IS NULL AND (payload ->> 'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN bad := 'email'; END IF;
  IF bad IS NULL AND coalesce(payload ->> 'phone', '') !~ '^[+0-9 ()-]*$' THEN bad := 'phone'; END IF;
  IF bad IS NULL AND coalesce(payload ->> 'cr_number', '') !~ '^[0-9]*$' THEN bad := 'cr_number'; END IF;
  IF bad IS NULL AND (payload ->> 'preferred_language') NOT IN ('ar', 'en') THEN bad := 'preferred_language'; END IF;
  IF bad IS NULL AND (payload -> 'consent') IS DISTINCT FROM 'true'::jsonb THEN bad := 'consent'; END IF;
  -- Enums.
  IF bad IS NULL AND NOT (payload ->> 'employee_band') = ANY (enum_range(NULL::employee_band)::text[]) THEN bad := 'employee_band'; END IF;
  IF bad IS NULL AND NOT (payload ->> 'ownership_type') = ANY (enum_range(NULL::ownership_type)::text[]) THEN bad := 'ownership_type'; END IF;
  IF bad IS NULL AND payload ->> 'urgency' IS NOT NULL
     AND NOT (payload ->> 'urgency') = ANY (enum_range(NULL::inquiry_urgency)::text[]) THEN bad := 'urgency'; END IF;
  IF bad IS NULL AND payload ->> 'heard_from' IS NOT NULL
     AND NOT (payload ->> 'heard_from') = ANY (enum_range(NULL::heard_from)::text[]) THEN bad := 'heard_from'; END IF;
  -- The sector and 1 to 10 services, from the active lists.
  IF bad IS NULL THEN
    SELECT s.id INTO sector FROM sectors s WHERE s.code = payload ->> 'sector' AND s.active;
    IF sector IS NULL THEN bad := 'sector'; END IF;
  END IF;
  IF bad IS NULL THEN
    IF jsonb_typeof(payload -> 'services') <> 'array' OR jsonb_array_length(payload -> 'services') NOT BETWEEN 1 AND 10 THEN
      bad := 'services';
    ELSE
      SELECT array_agg(DISTINCT x) INTO codes FROM jsonb_array_elements_text(payload -> 'services') x;
      SELECT array_agg(sa.id) INTO services FROM service_areas sa WHERE sa.code = ANY (codes) AND sa.active;
      IF coalesce(cardinality(services), 0) <> cardinality(codes) THEN bad := 'services'; END IF;
    END IF;
  END IF;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'invalid field: %', bad USING ERRCODE = 'SL400';
  END IF;

  -- At most 5 an hour from one address (the route sends the address's HMAC).
  IF payload ->> 'ip_hash' IS NOT NULL AND (
    SELECT count(*) FROM inquiries i WHERE i.ip_hash = payload ->> 'ip_hash' AND i.created_at > now() - interval '1 hour'
  ) >= 5 THEN
    RAISE EXCEPTION 'too many inquiries' USING ERRCODE = 'SL429';
  END IF;

  LOOP
    ref := 'INQ-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM inquiries WHERE public_ref = ref);
  END LOOP;

  -- Only these fields come from the form; state is always a new inquiry.
  INSERT INTO inquiries (
    firm_org_id, public_ref, org_name, org_name_ar, cr_number, sector_id, employee_band, ownership_type,
    contact_name, contact_role, contact_email, contact_phone, preferred_language, message, self_check,
    urgency, heard_from, privacy_notice_version, consented_at, ip_hash, user_agent_hash
  ) VALUES (
    firm, ref, btrim(payload ->> 'org_name'), nullif(btrim(payload ->> 'org_name_ar'), ''), nullif(btrim(payload ->> 'cr_number'), ''),
    sector, (payload ->> 'employee_band')::employee_band, (payload ->> 'ownership_type')::ownership_type,
    btrim(payload ->> 'contact_name'), nullif(btrim(payload ->> 'contact_role'), ''), lower(btrim(payload ->> 'email')),
    nullif(btrim(payload ->> 'phone'), ''), payload ->> 'preferred_language', nullif(btrim(payload ->> 'message'), ''),
    -- Only the questions answered: a skipped question is not a "no".
    jsonb_strip_nulls(jsonb_build_object(
      'has_strategy', (payload -> 'self_check' ->> 'has_strategy')::boolean,
      'has_org_chart', (payload -> 'self_check' ->> 'has_org_chart')::boolean,
      'has_delegation_matrix', (payload -> 'self_check' ->> 'has_delegation_matrix')::boolean,
      'has_policies', (payload -> 'self_check' ->> 'has_policies')::boolean,
      'has_sops', (payload -> 'self_check' ->> 'has_sops')::boolean,
      'has_kpis', (payload -> 'self_check' ->> 'has_kpis')::boolean)),
    (payload ->> 'urgency')::inquiry_urgency, (payload ->> 'heard_from')::heard_from,
    btrim(payload ->> 'privacy_notice_version'), now(), payload ->> 'ip_hash', payload ->> 'user_agent_hash'
  ) RETURNING id INTO iid;
  INSERT INTO inquiry_services (inquiry_id, service_area_id) SELECT iid, unnest(services);
  INSERT INTO inquiry_events (inquiry_id, event, to_status) VALUES (iid, 'submitted', 'new');
  -- Every active firm admin hears about it.
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT m.user_id, 'inquiry.new', 'inquiry', iid FROM org_memberships m
    WHERE m.org_id = firm AND m.role = 'firm_admin' AND m.active;
  RETURN ref;
EXCEPTION
  WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid field: self_check' USING ERRCODE = 'SL400';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION submit_inquiry(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION submit_inquiry(jsonb) TO selah_app;
--> statement-breakpoint

-- --------------------------------------------------------- who sees what

-- The firm's admins, and the consultant qualifying the inquiry while they
-- are still an active member of the firm.
CREATE FUNCTION app_can_see_inquiry(iid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM inquiries i
    WHERE i.id = iid AND i.firm_org_id = app_org() AND app_org_kind() = 'firm'
      AND (app_role() = 'firm_admin' OR i.owner_user_id = app_uid())
  )
$$;
--> statement-breakpoint
GRANT SELECT, UPDATE ON inquiries TO selah_app;
--> statement-breakpoint
GRANT SELECT ON inquiry_services TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON inquiry_events TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON discovery_sessions TO selah_app;
--> statement-breakpoint
ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE inquiry_services ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE inquiry_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE discovery_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY firm_read ON inquiries FOR SELECT TO selah_app
  USING (firm_org_id = app_org() AND app_org_kind() = 'firm' AND (app_role() = 'firm_admin' OR owner_user_id = app_uid()));
--> statement-breakpoint
CREATE POLICY firm_update ON inquiries FOR UPDATE TO selah_app
  USING (firm_org_id = app_org() AND app_org_kind() = 'firm' AND (app_role() = 'firm_admin' OR owner_user_id = app_uid()))
  WITH CHECK (firm_org_id = app_org() AND app_org_kind() = 'firm');
--> statement-breakpoint
CREATE POLICY firm_read ON inquiry_services FOR SELECT TO selah_app USING (app_can_see_inquiry(inquiry_id));
--> statement-breakpoint
CREATE POLICY firm_read ON inquiry_events FOR SELECT TO selah_app USING (app_can_see_inquiry(inquiry_id));
--> statement-breakpoint
-- People add notes; every other event is written by the database.
CREATE POLICY add_note ON inquiry_events FOR INSERT TO selah_app
  WITH CHECK (app_can_see_inquiry(inquiry_id) AND actor_id = app_uid() AND event = 'note'
    AND from_status IS NULL AND to_status IS NULL AND note IS NOT NULL);
--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON inquiry_events FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE POLICY firm_read ON discovery_sessions FOR SELECT TO selah_app USING (app_can_see_inquiry(inquiry_id));
--> statement-breakpoint
CREATE POLICY firm_write ON discovery_sessions FOR INSERT TO selah_app
  WITH CHECK (app_can_see_inquiry(inquiry_id) AND created_by = app_uid());
--> statement-breakpoint
CREATE POLICY firm_update ON discovery_sessions FOR UPDATE TO selah_app
  USING (app_can_see_inquiry(inquiry_id)) WITH CHECK (app_can_see_inquiry(inquiry_id));
--> statement-breakpoint

-- --------------------------------------------------------- the workflow

-- The owner moves an inquiry forward through qualification; only an admin
-- assigns the owner, records the conflict check and decides the outcome.
-- won needs a clear (or waived) conflict check. A won inquiry is converted
-- to a client once. Jobs (no user) may only anonymise.
CREATE FUNCTION check_inquiry_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  is_admin boolean := app_role() = 'firm_admin';
  owner_cols text[] := ARRAY['status', 'updated_at'];
  admin_cols text[] := ARRAY['status', 'owner_user_id', 'conflict_status', 'conflict_note', 'client_org_id', 'updated_at'];
  purge_cols text[] := ARRAY['org_name', 'org_name_ar', 'cr_number', 'contact_name', 'contact_role', 'contact_email', 'contact_phone',
                             'message', 'ip_hash', 'user_agent_hash', 'anonymised_at', 'updated_at'];
BEGIN
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
        WHEN 'spam' THEN (now() AT TIME ZONE 'Asia/Riyadh')::date + 30
        ELSE ((now() AT TIME ZONE 'Asia/Riyadh')::date + interval '12 months')::date END;
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
CREATE TRIGGER inquiry_rules BEFORE UPDATE ON inquiries FOR EACH ROW EXECUTE FUNCTION check_inquiry_update();
--> statement-breakpoint
CREATE FUNCTION log_inquiry_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO inquiry_events (inquiry_id, actor_id, event, from_status, to_status)
      VALUES (NEW.id, app_uid(), 'status_changed', OLD.status, NEW.status);
  END IF;
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    INSERT INTO inquiry_events (inquiry_id, actor_id, event, meta)
      VALUES (NEW.id, app_uid(), 'owner_changed', jsonb_build_object('owner_user_id', NEW.owner_user_id));
    IF NEW.owner_user_id IS NOT NULL AND NEW.owner_user_id IS DISTINCT FROM app_uid() THEN
      INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES (NEW.owner_user_id, 'inquiry.assigned', 'inquiry', NEW.id);
    END IF;
  END IF;
  IF NEW.conflict_status IS DISTINCT FROM OLD.conflict_status THEN
    INSERT INTO inquiry_events (inquiry_id, actor_id, event, note, meta)
      VALUES (NEW.id, app_uid(), 'conflict_checked', NEW.conflict_note, jsonb_build_object('conflict_status', NEW.conflict_status));
  END IF;
  IF NEW.client_org_id IS DISTINCT FROM OLD.client_org_id THEN
    INSERT INTO inquiry_events (inquiry_id, actor_id, event, meta)
      VALUES (NEW.id, app_uid(), 'converted', jsonb_build_object('client_org_id', NEW.client_org_id));
  END IF;
  IF NEW.anonymised_at IS NOT NULL AND OLD.anonymised_at IS NULL THEN
    INSERT INTO inquiry_events (inquiry_id, event) VALUES (NEW.id, 'anonymised');
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER inquiry_log AFTER UPDATE ON inquiries FOR EACH ROW EXECUTE FUNCTION log_inquiry_update();
--> statement-breakpoint

-- ------------------------------------------------------------- retention

-- Clear the requester's details from closed inquiries past purge_after.
-- Kept for statistics: sector, services, size, ownership, self-check,
-- status and dates. Run daily as the schema owner.
CREATE FUNCTION app_purge_inquiries(today date) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE discovery_sessions d SET attendees = NULL, notes = NULL
    FROM inquiries i WHERE i.id = d.inquiry_id AND i.purge_after <= today AND i.anonymised_at IS NULL;
  UPDATE inquiries SET
    org_name = NULL, org_name_ar = NULL, cr_number = NULL, contact_name = NULL, contact_role = NULL,
    contact_email = NULL, contact_phone = NULL, message = NULL, ip_hash = NULL, user_agent_hash = NULL,
    anonymised_at = now()
  WHERE purge_after <= today AND anonymised_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_purge_inquiries(date) FROM PUBLIC;
