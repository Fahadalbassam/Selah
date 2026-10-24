CREATE TYPE "public"."fiscal_calendar" AS ENUM('gregorian', 'hijri');--> statement-breakpoint
CREATE TYPE "public"."listed_market" AS ENUM('main', 'parallel');--> statement-breakpoint
CREATE TYPE "public"."regulator" AS ENUM('mc', 'cma', 'sama', 'ia', 'cst', 'ncnp', 'sfda', 'moh', 'moe', 'other');--> statement-breakpoint
CREATE TYPE "public"."saudi_region" AS ENUM('riyadh', 'makkah', 'madinah', 'eastern', 'qassim', 'asir', 'tabuk', 'hail', 'northern_borders', 'jazan', 'najran', 'al_baha', 'al_jawf');--> statement-breakpoint
CREATE TYPE "public"."size_band" AS ENUM('micro', 'small', 'medium', 'large');--> statement-breakpoint
CREATE TABLE "client_profiles" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"legal_name_ar" text,
	"legal_name_en" text,
	"trade_name" text,
	"unified_number" text,
	"isic_code" text,
	"sector_code" text,
	"size_band" "size_band",
	"revenue_band" "size_band",
	"region" "saudi_region",
	"regulators" "regulator"[] DEFAULT '{}'::regulator[] NOT NULL,
	"listed_market" "listed_market",
	"fiscal_year_end_month" integer,
	"fiscal_calendar" "fiscal_calendar" DEFAULT 'gregorian' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_profile_unified_number" CHECK ("client_profiles"."unified_number" ~ '^7[0-9]{9}$'),
	CONSTRAINT "client_profile_isic" CHECK ("client_profiles"."isic_code" ~ '^[0-9]{4,6}$'),
	CONSTRAINT "client_profile_fiscal_month" CHECK ("client_profiles"."fiscal_year_end_month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_sector_code_sectors_code_fk" FOREIGN KEY ("sector_code") REFERENCES "public"."sectors"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_profiles_unified_number" ON "client_profiles" USING btree ("unified_number");--> statement-breakpoint
-- Hand-written: who reads and edits a client's legal profile, and the rules
-- that tie it to the client record.
GRANT SELECT, INSERT, UPDATE ON client_profiles TO selah_app;
--> statement-breakpoint
ALTER TABLE client_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The firm admin and the client's lead consultant keep the profile.
CREATE FUNCTION app_can_edit_client_profile(oid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_org_kind() = 'firm' AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = oid AND o.kind = 'client')
    AND (app_role() = 'firm_admin' OR app_is_client_lead(oid))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_edit_client_profile(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_edit_client_profile(uuid) TO selah_app;
--> statement-breakpoint
-- Firm staff who see the client read it, and so do the client's own admins
-- and managers (it is their company's record). Action owners don't.
CREATE POLICY client_profile_read ON client_profiles FOR SELECT TO selah_app
  USING (app_can_see_org(org_id) AND app_role() <> 'action_owner');
--> statement-breakpoint
CREATE POLICY client_profile_insert ON client_profiles FOR INSERT TO selah_app
  WITH CHECK (app_can_edit_client_profile(org_id) AND updated_by = app_uid());
--> statement-breakpoint
CREATE POLICY client_profile_update ON client_profiles FOR UPDATE TO selah_app
  USING (app_can_edit_client_profile(org_id)) WITH CHECK (app_can_edit_client_profile(org_id) AND updated_by = app_uid());
--> statement-breakpoint
-- Clients only. A minimal-records client keeps no legal names or unified
-- number. A listed market needs the listed joint stock company legal form.
CREATE FUNCTION check_client_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  org organizations%ROWTYPE;
BEGIN
  SELECT * INTO org FROM organizations WHERE id = NEW.org_id;
  IF org.kind IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'a legal profile is for a client' USING ERRCODE = 'check_violation';
  END IF;
  IF org.minimal_records AND (NEW.legal_name_ar IS NOT NULL OR NEW.legal_name_en IS NOT NULL OR NEW.trade_name IS NOT NULL OR NEW.unified_number IS NOT NULL) THEN
    RAISE EXCEPTION 'a minimal-records client keeps no legal names or unified number' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.listed_market IS NOT NULL AND org.legal_form IS DISTINCT FROM 'listed_jsc' THEN
    RAISE EXCEPTION 'a listed market needs the listed joint stock company legal form' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER client_profile_rules BEFORE INSERT OR UPDATE ON client_profiles FOR EACH ROW EXECUTE FUNCTION check_client_profile();
--> statement-breakpoint
-- The same rules, seen from the client record: switching on minimal records
-- or moving off the listed legal form must not leave the profile wrong.
CREATE FUNCTION check_org_against_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  p client_profiles%ROWTYPE;
BEGIN
  SELECT * INTO p FROM client_profiles WHERE org_id = NEW.id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF NEW.minimal_records AND (p.legal_name_ar IS NOT NULL OR p.legal_name_en IS NOT NULL OR p.trade_name IS NOT NULL OR p.unified_number IS NOT NULL) THEN
    RAISE EXCEPTION 'a minimal-records client keeps no legal names or unified number' USING ERRCODE = 'check_violation';
  END IF;
  IF p.listed_market IS NOT NULL AND NEW.legal_form IS DISTINCT FROM 'listed_jsc' THEN
    RAISE EXCEPTION 'a listed market needs the listed joint stock company legal form' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER org_fits_profile BEFORE UPDATE OF minimal_records, legal_form ON organizations FOR EACH ROW EXECUTE FUNCTION check_org_against_profile();
