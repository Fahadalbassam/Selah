CREATE TYPE "public"."inquiry_source" AS ENUM('website', 'referral', 'existing_client', 'tender', 'firm_outreach');--> statement-breakpoint
ALTER TABLE "inquiries" DROP CONSTRAINT "inquiry_contact_kept";--> statement-breakpoint
ALTER TABLE "inquiries" ALTER COLUMN "employee_band" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiries" ALTER COLUMN "ownership_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiries" ALTER COLUMN "privacy_notice_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiries" ALTER COLUMN "consented_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "source" "inquiry_source" DEFAULT 'website' NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "entered_by" uuid;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "source_client_org_id" uuid;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "tender_number" text;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "tender_closes_on" date;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_entered_by_user_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_source_client_org_id_organizations_id_fk" FOREIGN KEY ("source_client_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiry_website_fields" CHECK ("inquiries"."source" <> 'website' OR ("inquiries"."privacy_notice_version" IS NOT NULL AND "inquiries"."consented_at" IS NOT NULL AND "inquiries"."employee_band" IS NOT NULL AND "inquiries"."ownership_type" IS NOT NULL AND "inquiries"."entered_by" IS NULL));--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiry_entered_by" CHECK ("inquiries"."source" = 'website' OR "inquiries"."entered_by" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiry_tender_fields" CHECK (CASE WHEN "inquiries"."source" = 'tender' THEN "inquiries"."tender_number" IS NOT NULL AND "inquiries"."tender_number" ~ '^[0-9A-Za-z-]{1,40}$' ELSE "inquiries"."tender_number" IS NULL AND "inquiries"."tender_closes_on" IS NULL END);--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiry_source_client" CHECK (CASE "inquiries"."source" WHEN 'existing_client' THEN "inquiries"."source_client_org_id" IS NOT NULL WHEN 'referral' THEN true ELSE "inquiries"."source_client_org_id" IS NULL END);--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiry_contact_kept" CHECK ("inquiries"."anonymised_at" IS NOT NULL OR ("inquiries"."org_name" IS NOT NULL AND ("inquiries"."source" <> 'website' OR ("inquiries"."contact_email" IS NOT NULL AND "inquiries"."contact_name" IS NOT NULL))));--> statement-breakpoint
-- Hand-written: firm staff enter an inquiry that never touched the public
-- form (wave 1, item 8): a referral, a returning client, an Etimad tender,
-- or a company the firm approached. The firm admin or any consultant; a
-- consultant becomes its owner (so they can see it) and the admins hear of it.
CREATE FUNCTION app_enter_inquiry(payload jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  src inquiry_source;
  sector uuid;
  services uuid[];
  codes text[];
  ref text;
  iid uuid;
  client uuid := nullif(payload ->> 'source_client_org_id', '')::uuid;
  owner uuid;
BEGIN
  IF app_org_kind() IS DISTINCT FROM 'firm' OR app_role() NOT IN ('firm_admin', 'consultant') THEN
    RAISE EXCEPTION 'only firm staff enter inquiries' USING ERRCODE = 'insufficient_privilege';
  END IF;
  src := (payload ->> 'source')::inquiry_source;
  IF src IS NULL OR src = 'website' THEN
    RAISE EXCEPTION 'invalid field: source' USING ERRCODE = 'SL400';
  END IF;
  IF length(btrim(coalesce(payload ->> 'org_name', ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid field: org_name' USING ERRCODE = 'SL400';
  END IF;
  SELECT s.id INTO sector FROM sectors s WHERE s.code = payload ->> 'sector' AND s.active;
  IF sector IS NULL THEN
    RAISE EXCEPTION 'invalid field: sector' USING ERRCODE = 'SL400';
  END IF;
  SELECT array_agg(DISTINCT x) INTO codes FROM jsonb_array_elements_text(coalesce(payload -> 'services', '[]'::jsonb)) x;
  SELECT array_agg(sa.id) INTO services FROM service_areas sa WHERE sa.code = ANY (codes) AND sa.active;
  IF coalesce(cardinality(services), 0) <> coalesce(cardinality(codes), 0) OR coalesce(cardinality(codes), 0) > 10 THEN
    RAISE EXCEPTION 'invalid field: services' USING ERRCODE = 'SL400';
  END IF;
  -- The client named must be one this person can see.
  IF client IS NOT NULL AND NOT (app_can_see_org(client) AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = client AND o.kind = 'client')) THEN
    RAISE EXCEPTION 'invalid field: source_client_org_id' USING ERRCODE = 'SL400';
  END IF;
  owner := CASE WHEN app_role() = 'consultant' THEN app_uid() END;

  LOOP
    ref := 'INQ-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM inquiries WHERE public_ref = ref);
  END LOOP;
  INSERT INTO inquiries (
    firm_org_id, public_ref, source, entered_by, source_client_org_id, tender_number, tender_closes_on,
    org_name, org_name_ar, sector_id, employee_band, ownership_type, contact_name, contact_role, contact_email, contact_phone,
    preferred_language, message, self_check, urgency, owner_user_id
  ) VALUES (
    app_org(), ref, src, app_uid(), client, nullif(btrim(payload ->> 'tender_number'), ''), (payload ->> 'tender_closes_on')::date,
    btrim(payload ->> 'org_name'), nullif(btrim(payload ->> 'org_name_ar'), ''), sector,
    (payload ->> 'employee_band')::employee_band, (payload ->> 'ownership_type')::ownership_type,
    nullif(btrim(payload ->> 'contact_name'), ''), nullif(btrim(payload ->> 'contact_role'), ''),
    lower(nullif(btrim(payload ->> 'email'), '')), nullif(btrim(payload ->> 'phone'), ''),
    coalesce(payload ->> 'preferred_language', 'ar'), nullif(btrim(payload ->> 'message'), ''), '{}'::jsonb,
    (payload ->> 'urgency')::inquiry_urgency, owner
  ) RETURNING id INTO iid;
  INSERT INTO inquiry_services (inquiry_id, service_area_id) SELECT iid, unnest(services);
  INSERT INTO inquiry_events (inquiry_id, actor_id, event, to_status, meta) VALUES (iid, app_uid(), 'entered', 'new', jsonb_build_object('source', src));
  IF owner IS NOT NULL THEN
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT m.user_id, 'inquiry.new', 'inquiry', iid FROM org_memberships m
      WHERE m.org_id = app_org() AND m.role = 'firm_admin' AND m.active;
  END IF;
  RETURN iid;
EXCEPTION
  WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'invalid field: %', 'value' USING ERRCODE = 'SL400';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_enter_inquiry(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_enter_inquiry(jsonb) TO selah_app;
--> statement-breakpoint
-- The intake address and the acknowledgement are for the public form only:
-- staff who type an inquiry in already know about it, and nobody asked the
-- person named in it for a mail.
CREATE OR REPLACE FUNCTION mail_new_inquiry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.source <> 'website' THEN
    RETURN NULL;
  END IF;
  INSERT INTO outbound_emails (to_email, kind, link)
    SELECT s.intake_email, 'inquiry.new', '/inquiries/' || NEW.id
    FROM firm_settings s WHERE s.org_id = NEW.firm_org_id AND s.intake_email IS NOT NULL;
  IF NEW.contact_email IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM outbound_emails o
    WHERE o.kind = 'inquiry.received' AND lower(o.to_email) = lower(NEW.contact_email) AND o.created_at > now() - interval '24 hours'
  ) THEN
    INSERT INTO outbound_emails (to_email, kind, reference, locale)
      VALUES (NEW.contact_email, 'inquiry.received', NEW.public_ref, NEW.preferred_language);
    INSERT INTO inquiry_events (inquiry_id, event) VALUES (NEW.id, 'acknowledged');
  END IF;
  RETURN NULL;
END $$;
