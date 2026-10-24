CREATE TYPE "public"."contact_channel" AS ENUM('email', 'phone', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."family_generation" AS ENUM('first', 'second', 'third_plus');--> statement-breakpoint
CREATE TYPE "public"."family_governance" AS ENUM('charter', 'council', 'both', 'none', 'unsure');--> statement-breakpoint
CREATE TYPE "public"."family_working" AS ENUM('none', '1-3', '4-10', '11+');--> statement-breakpoint
CREATE TYPE "public"."requester_role" AS ENUM('owner_chair', 'board_member', 'ceo', 'executive', 'family_member', 'manager', 'other');--> statement-breakpoint
ALTER TABLE "inquiries" DROP CONSTRAINT "inquiry_website_fields";--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "requester_role" "requester_role";--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "contact_channel" "contact_channel" DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "why_now" text;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "family_generation" "family_generation";--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "family_working" "family_working";--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "family_governance" "family_governance";--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "marketing_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiry_marketing_consent" CHECK ("inquiries"."marketing_consent_at" IS NULL OR "inquiries"."source" = 'website');--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiry_why_now" CHECK (length("inquiries"."why_now") BETWEEN 1 AND 500);--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiry_contact_channel" CHECK ("inquiries"."contact_channel" = 'email' OR "inquiries"."contact_phone" IS NOT NULL OR "inquiries"."anonymised_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiry_family_fields" CHECK (coalesce("inquiries"."ownership_type" IN ('family_single_owner', 'family_multi_partner'), false) OR ("inquiries"."family_generation" IS NULL AND "inquiries"."family_working" IS NULL AND "inquiries"."family_governance" IS NULL));--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiry_website_fields" CHECK ("inquiries"."source" <> 'website' OR ("inquiries"."privacy_notice_version" IS NOT NULL AND "inquiries"."consented_at" IS NOT NULL AND "inquiries"."entered_by" IS NULL));--> statement-breakpoint
-- Hand-written (wave 1, item 8, part 4): the public form asks for the
-- requester's role from a list, how to reach them (WhatsApp included), why
-- now (required), size and ownership later and optionally, light questions
-- for family businesses, and a separate, unticked marketing consent. It no
-- longer asks for the CR number (the legal profile keeps the unified number).
CREATE OR REPLACE FUNCTION submit_inquiry(payload jsonb) RETURNS text
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
  family boolean;
BEGIN
  IF (SELECT count(*) FROM organizations WHERE kind = 'firm') <> 1 THEN
    RAISE EXCEPTION 'intake needs exactly one firm' USING ERRCODE = 'SL500';
  END IF;
  SELECT id INTO firm FROM organizations WHERE kind = 'firm';

  -- Required and optional text, with lengths.
  FOREACH fld IN ARRAY ARRAY['org_name:1:200', 'contact_name:1:120', 'email:3:254', 'preferred_language:2:2', 'privacy_notice_version:1:40',
                             'why_now:1:500', 'org_name_ar:0:200', 'contact_role:0:120', 'phone:0:30', 'message:0:2000'] LOOP
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
  IF bad IS NULL AND (payload ->> 'preferred_language') NOT IN ('ar', 'en') THEN bad := 'preferred_language'; END IF;
  IF bad IS NULL AND (payload -> 'consent') IS DISTINCT FROM 'true'::jsonb THEN bad := 'consent'; END IF;
  IF bad IS NULL AND jsonb_typeof(coalesce(payload -> 'marketing_consent', 'false')) <> 'boolean' THEN bad := 'marketing_consent'; END IF;
  -- Enums: the role is required, the rest optional.
  IF bad IS NULL AND NOT coalesce((payload ->> 'requester_role') = ANY (enum_range(NULL::requester_role)::text[]), false) THEN
    bad := 'requester_role';
  END IF;
  IF bad IS NULL AND NOT coalesce(payload ->> 'contact_channel', 'email') = ANY (enum_range(NULL::contact_channel)::text[]) THEN
    bad := 'contact_channel';
  END IF;
  IF bad IS NULL AND coalesce(payload ->> 'contact_channel', 'email') <> 'email' AND coalesce(btrim(payload ->> 'phone'), '') = '' THEN
    bad := 'phone';
  END IF;
  FOREACH fld IN ARRAY ARRAY['employee_band', 'ownership_type', 'urgency:inquiry_urgency', 'heard_from', 'family_generation', 'family_working',
                             'family_governance'] LOOP
    v := payload ->> split_part(fld, ':', 1);
    IF bad IS NULL AND v IS NOT NULL AND NOT v = ANY (
      CASE coalesce(nullif(split_part(fld, ':', 2), ''), split_part(fld, ':', 1))
        WHEN 'employee_band' THEN enum_range(NULL::employee_band)::text[]
        WHEN 'ownership_type' THEN enum_range(NULL::ownership_type)::text[]
        WHEN 'inquiry_urgency' THEN enum_range(NULL::inquiry_urgency)::text[]
        WHEN 'heard_from' THEN enum_range(NULL::heard_from)::text[]
        WHEN 'family_generation' THEN enum_range(NULL::family_generation)::text[]
        WHEN 'family_working' THEN enum_range(NULL::family_working)::text[]
        WHEN 'family_governance' THEN enum_range(NULL::family_governance)::text[] END) THEN
      bad := split_part(fld, ':', 1);
    END IF;
  END LOOP;
  -- The family questions are asked of family businesses only.
  family := coalesce(payload ->> 'ownership_type' IN ('family_single_owner', 'family_multi_partner'), false);
  IF bad IS NULL AND NOT family AND (payload ->> 'family_generation' IS NOT NULL OR payload ->> 'family_working' IS NOT NULL
     OR payload ->> 'family_governance' IS NOT NULL) THEN
    bad := 'family_generation';
  END IF;
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
    firm_org_id, public_ref, org_name, org_name_ar, sector_id, employee_band, ownership_type,
    contact_name, contact_role, requester_role, contact_email, contact_phone, contact_channel, preferred_language, message, why_now,
    family_generation, family_working, family_governance, self_check,
    urgency, heard_from, privacy_notice_version, consented_at, marketing_consent_at, ip_hash, user_agent_hash
  ) VALUES (
    firm, ref, btrim(payload ->> 'org_name'), nullif(btrim(payload ->> 'org_name_ar'), ''),
    sector, (payload ->> 'employee_band')::employee_band, (payload ->> 'ownership_type')::ownership_type,
    btrim(payload ->> 'contact_name'), nullif(btrim(payload ->> 'contact_role'), ''), (payload ->> 'requester_role')::requester_role,
    lower(btrim(payload ->> 'email')), nullif(btrim(payload ->> 'phone'), ''), coalesce(payload ->> 'contact_channel', 'email')::contact_channel,
    payload ->> 'preferred_language', nullif(btrim(payload ->> 'message'), ''), btrim(payload ->> 'why_now'),
    (payload ->> 'family_generation')::family_generation, (payload ->> 'family_working')::family_working,
    (payload ->> 'family_governance')::family_governance,
    -- Only the questions answered: a skipped question is not a "no".
    jsonb_strip_nulls(jsonb_build_object(
      'has_strategy', (payload -> 'self_check' ->> 'has_strategy')::boolean,
      'has_org_chart', (payload -> 'self_check' ->> 'has_org_chart')::boolean,
      'has_delegation_matrix', (payload -> 'self_check' ->> 'has_delegation_matrix')::boolean,
      'has_policies', (payload -> 'self_check' ->> 'has_policies')::boolean,
      'has_sops', (payload -> 'self_check' ->> 'has_sops')::boolean,
      'has_kpis', (payload -> 'self_check' ->> 'has_kpis')::boolean)),
    (payload ->> 'urgency')::inquiry_urgency, (payload ->> 'heard_from')::heard_from,
    btrim(payload ->> 'privacy_notice_version'), now(),
    CASE WHEN (payload -> 'marketing_consent') = 'true'::jsonb THEN now() END,
    payload ->> 'ip_hash', payload ->> 'user_agent_hash'
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
-- When an inquiry's details are cleared (retention, minimal records), the
-- new personal fields go too: why now, the marketing consent, and the way
-- to reach them. Role and family answers stay, as statistics. Named to run
-- after inquiry_rules has checked the update.
CREATE FUNCTION forget_inquiry_extras() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.anonymised_at IS NULL AND NEW.anonymised_at IS NOT NULL THEN
    NEW.why_now := NULL;
    NEW.marketing_consent_at := NULL;
    NEW.contact_channel := 'email';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inquiry_rules_forget BEFORE UPDATE ON inquiries FOR EACH ROW EXECUTE FUNCTION forget_inquiry_extras();
--> statement-breakpoint
-- The firm admin may record that the requester withdrew the marketing
-- consent (and nothing else about it); otherwise as in migration 0002.
CREATE OR REPLACE FUNCTION check_inquiry_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  is_admin boolean := app_role() = 'firm_admin';
  owner_cols text[] := ARRAY['status', 'updated_at'];
  admin_cols text[] := ARRAY['status', 'owner_user_id', 'conflict_status', 'conflict_note', 'client_org_id', 'marketing_consent_at',
                             'updated_at'];
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

  -- The firm admin records a withdrawn marketing consent; only the requester gives it.
  IF NEW.marketing_consent_at IS DISTINCT FROM OLD.marketing_consent_at THEN
    IF NEW.marketing_consent_at IS NOT NULL THEN
      RAISE EXCEPTION 'only the requester agrees to hear from the firm' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO inquiry_events (inquiry_id, actor_id, event) VALUES (NEW.id, app_uid(), 'marketing_withdrawn');
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
