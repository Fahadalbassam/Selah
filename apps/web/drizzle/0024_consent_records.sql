CREATE TYPE "public"."legal_doc" AS ENUM('terms', 'privacy', 'ai_notice');--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"doc" "legal_doc" NOT NULL,
	"version" text NOT NULL,
	"locale" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text
);
--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_records_user_idx" ON "consent_records" USING btree ("user_id","doc","accepted_at");--> statement-breakpoint
-- Hand-written (R1): terms, privacy notice and AI-use notice accepted at the
-- first sign-in, and again whenever one of them changes.
--
-- The current version of each document. The same dates are LEGAL_VERSIONS in
-- src/lib/legal.ts (tests/db/rule-parity.test.ts compares them). Publishing a
-- new version means changing both, in a new migration, with the new text.
CREATE FUNCTION app_legal_version(d legal_doc) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE d WHEN 'terms' THEN '2026-10-24' WHEN 'privacy' THEN '2026-10-24' WHEN 'ai_notice' THEN '2026-10-24' END
$$;
--> statement-breakpoint
-- The documents the signed-in person has not accepted in their current
-- version; empty when they may go on.
CREATE FUNCTION app_consent_pending() RETURNS legal_doc[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(d ORDER BY d), '{}') FROM unnest(enum_range(NULL::legal_doc)) d
  WHERE app_uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM consent_records c WHERE c.user_id = app_uid() AND c.doc = d AND c.version = app_legal_version(d))
$$;
--> statement-breakpoint
-- Record that the signed-in person accepted a document. Only its current
-- version, only for themselves; accepting again is harmless and not stored twice.
CREATE FUNCTION app_record_consent(d legal_doc, v text, lang text, addr text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_uid() IS NULL OR app_org() IS NULL THEN
    RAISE EXCEPTION 'only a signed-in person with an active account accepts terms' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v IS DISTINCT FROM app_legal_version(d) THEN
    RAISE EXCEPTION 'that is not the current version of the document' USING ERRCODE = 'check_violation';
  END IF;
  IF lang NOT IN ('ar', 'en') THEN
    RAISE EXCEPTION 'the language must be ar or en' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM consent_records WHERE user_id = app_uid() AND doc = d AND version = v) THEN
    INSERT INTO consent_records (user_id, doc, version, locale, ip) VALUES (app_uid(), d, v, lang, left(addr, 64));
  END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_legal_version(legal_doc), app_consent_pending(), app_record_consent(legal_doc, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_legal_version(legal_doc), app_consent_pending(), app_record_consent(legal_doc, text, text, text) TO selah_app;
--> statement-breakpoint
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Read only: your own records; the firm admin everyone's; a client admin
-- their organization's people.
GRANT SELECT ON consent_records TO selah_app;
--> statement-breakpoint
CREATE POLICY consent_read ON consent_records FOR SELECT TO selah_app USING (
  user_id = app_uid()
  OR (app_org_kind() = 'firm' AND app_role() = 'firm_admin')
  OR (app_role() = 'client_admin' AND EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = consent_records.user_id AND m.org_id = app_org())));
--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON consent_records FOR EACH ROW EXECUTE FUNCTION forbid_change();
