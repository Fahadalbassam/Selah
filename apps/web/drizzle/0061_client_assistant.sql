CREATE TABLE "ai_usage" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"queries" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "client_ai_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_org_id" uuid NOT NULL,
	"version" text NOT NULL,
	"locale" text NOT NULL,
	"given_by" uuid NOT NULL,
	"given_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_by" uuid,
	"ended_at" timestamp with time zone,
	CONSTRAINT "client_ai_consent_ended" CHECK (("client_ai_consents"."ended_at" IS NULL) = ("client_ai_consents"."ended_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "client_ai_settings" (
	"client_org_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"roles" "role"[] DEFAULT '{client_manager}'::role[] NOT NULL,
	"daily_limit" integer DEFAULT 20 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_ai_roles" CHECK ("client_ai_settings"."roles" <@ ARRAY['client_admin', 'client_manager']::role[]),
	CONSTRAINT "client_ai_daily_limit" CHECK ("client_ai_settings"."daily_limit" BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_ai_consents" ADD CONSTRAINT "client_ai_consents_client_org_id_organizations_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_ai_consents" ADD CONSTRAINT "client_ai_consents_given_by_user_id_fk" FOREIGN KEY ("given_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_ai_consents" ADD CONSTRAINT "client_ai_consents_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_ai_settings" ADD CONSTRAINT "client_ai_settings_client_org_id_organizations_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_ai_settings" ADD CONSTRAINT "client_ai_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_ai_consents_org_idx" ON "client_ai_consents" USING btree ("client_org_id","given_at");--> statement-breakpoint
-- ------------------------------------------------ the client assistant (wave 3, F39)
-- Off by default. The firm admin switches it on for one client and names
-- the client roles that get it; the client's admin then consents to the
-- notice, and only from then on can those people ask. It reads exactly what
-- the person can already open (the same row-level security as every screen;
-- the policies below add a second lock on the index and the chats). Turning
-- it off, or giving it to a role the client did not agree to, ends the
-- consent. Consultant-managed and minimal-records clients have no accounts
-- or no AI, so it can't be switched on for them.

-- The version of the client AI notice. src/lib/client-ai.ts holds the same date.
CREATE FUNCTION app_client_ai_version() RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT '2026-10-24' $$;
--> statement-breakpoint
-- The consent in force for a client: the latest one not ended, for the current notice.
CREATE FUNCTION app_client_ai_consent(org uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id FROM client_ai_consents c
  WHERE c.client_org_id = org AND c.ended_at IS NULL AND c.version = app_client_ai_version()
  ORDER BY c.given_at DESC LIMIT 1
$$;
--> statement-breakpoint
-- Whether the signed-in person may use the assistant. Firm staff always may
-- (their rights are checked per project); a client person only when the
-- firm switched it on for their role and their admin consented.
CREATE FUNCTION app_client_ai_on() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_org_kind() = 'client' AND EXISTS (
    SELECT 1 FROM client_ai_settings s JOIN organizations o ON o.id = s.client_org_id
    WHERE s.client_org_id = app_org() AND s.enabled AND app_role() = ANY (s.roles)
      AND o.status = 'active' AND NOT o.minimal_records AND o.engagement_mode IS DISTINCT FROM 'consultant_managed'
  ) AND app_client_ai_consent(app_org()) IS NOT NULL
$$;
--> statement-breakpoint
CREATE FUNCTION app_ai_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_org_kind() = 'firm' OR app_client_ai_on()
$$;
--> statement-breakpoint
-- The firm admin switches it on or off for a client, with its roles and daily limit.
CREATE FUNCTION app_set_client_ai(org uuid, p_enabled boolean, p_roles role[], p_limit integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  o organizations;
  was client_ai_settings;
  want role[] := coalesce((SELECT array_agg(DISTINCT r ORDER BY r) FROM unnest(p_roles) r), '{}');
BEGIN
  SELECT * INTO o FROM organizations WHERE id = org;
  IF o.id IS NULL OR o.kind <> 'client' OR app_org_kind() IS DISTINCT FROM 'firm' OR app_role() IS DISTINCT FROM 'firm_admin'
     OR NOT app_can_see_org(org) THEN
    RAISE EXCEPTION 'only the firm admin switches the client assistant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_enabled AND (o.status <> 'active' OR o.prospect OR o.minimal_records OR o.engagement_mode IS NOT DISTINCT FROM 'consultant_managed') THEN
    RAISE EXCEPTION 'this client can''t have the assistant: it has no accounts, keeps minimal records or is not an active client' USING ERRCODE = 'check_violation';
  END IF;
  IF 'action_owner' = ANY (want) THEN
    RAISE EXCEPTION 'action owners can''t have the assistant' USING ERRCODE = 'check_violation';
  END IF;
  IF p_enabled AND cardinality(want) = 0 THEN
    RAISE EXCEPTION 'choose at least one client role' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO was FROM client_ai_settings WHERE client_org_id = org;
  INSERT INTO client_ai_settings (client_org_id, enabled, roles, daily_limit, updated_by, updated_at)
  VALUES (org, p_enabled, CASE WHEN cardinality(want) = 0 THEN '{client_manager}'::role[] ELSE want END, coalesce(p_limit, 20), app_uid(), now())
  ON CONFLICT (client_org_id) DO UPDATE SET enabled = EXCLUDED.enabled,
    roles = CASE WHEN cardinality(want) = 0 THEN client_ai_settings.roles ELSE EXCLUDED.roles END,
    daily_limit = EXCLUDED.daily_limit, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
  -- Off, or on for a role the client did not agree to: the consent ends.
  IF NOT p_enabled OR (was.client_org_id IS NOT NULL AND NOT (want <@ was.roles)) THEN
    UPDATE client_ai_consents SET ended_at = now(), ended_by = app_uid() WHERE client_org_id = org AND ended_at IS NULL;
  END IF;
  -- The client's admins are asked to consent when it is switched on without a consent in force.
  IF p_enabled AND app_client_ai_consent(org) IS NULL THEN
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT m.user_id, 'client_ai.offered', 'organization', org FROM org_memberships m
      WHERE m.active AND m.org_id = org AND m.role = 'client_admin';
  END IF;
END $$;
--> statement-breakpoint
-- The client's admin consents, to the current notice, once the firm has switched it on.
CREATE FUNCTION app_consent_client_ai(p_version text, p_locale text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  org uuid := app_org();
  row_id uuid;
BEGIN
  IF app_org_kind() IS DISTINCT FROM 'client' OR app_role() IS DISTINCT FROM 'client_admin' THEN
    RAISE EXCEPTION 'only the client''s admin consents to the assistant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM client_ai_settings s WHERE s.client_org_id = org AND s.enabled) THEN
    RAISE EXCEPTION 'the firm has not offered the assistant' USING ERRCODE = 'check_violation';
  END IF;
  IF p_version IS DISTINCT FROM app_client_ai_version() THEN
    RAISE EXCEPTION 'read the current notice first' USING ERRCODE = 'check_violation';
  END IF;
  IF p_locale NOT IN ('ar', 'en') THEN
    RAISE EXCEPTION 'unknown language' USING ERRCODE = 'check_violation';
  END IF;
  IF app_client_ai_consent(org) IS NOT NULL THEN
    RAISE EXCEPTION 'your organisation already consented' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO client_ai_consents (client_org_id, version, locale, given_by, given_at)
  VALUES (org, p_version, p_locale, app_uid(), clock_timestamp()) RETURNING id INTO row_id;
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT DISTINCT m.user_id, 'client_ai.consented', 'organization', org FROM org_memberships m
    WHERE m.active AND m.org_id = (SELECT f.id FROM organizations f WHERE f.kind = 'firm' LIMIT 1) AND (
      m.role = 'firm_admin' OR EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = org AND ca.user_id = m.user_id AND ca.is_lead));
  RETURN row_id;
END $$;
--> statement-breakpoint
-- The client's admin withdraws it at any time. The firm admins and the lead hear.
CREATE FUNCTION app_withdraw_client_ai() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE org uuid := app_org();
BEGIN
  IF app_org_kind() IS DISTINCT FROM 'client' OR app_role() IS DISTINCT FROM 'client_admin' THEN
    RAISE EXCEPTION 'only the client''s admin withdraws consent to the assistant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM client_ai_consents c WHERE c.client_org_id = org AND c.ended_at IS NULL) THEN
    RAISE EXCEPTION 'there is no consent to withdraw' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE client_ai_consents SET ended_at = now(), ended_by = app_uid() WHERE client_org_id = org AND ended_at IS NULL;
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT DISTINCT m.user_id, 'client_ai.withdrawn', 'organization', org FROM org_memberships m
    WHERE m.active AND m.org_id = (SELECT f.id FROM organizations f WHERE f.kind = 'firm' LIMIT 1) AND (
      m.role = 'firm_admin' OR EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = org AND ca.user_id = m.user_id AND ca.is_lead));
END $$;
--> statement-breakpoint
-- Count one question before the search runs. A client person has the
-- client's daily limit; firm staff are counted, not limited.
CREATE FUNCTION app_count_ai_question(p_day date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  lim integer;
  n integer;
BEGIN
  IF app_uid() IS NULL OR NOT app_ai_allowed() THEN
    RAISE EXCEPTION 'the assistant is not available to you' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app_org_kind() = 'client' THEN
    SELECT s.daily_limit INTO lim FROM client_ai_settings s WHERE s.client_org_id = app_org();
  END IF;
  INSERT INTO ai_usage (user_id, day, queries) VALUES (app_uid(), p_day, 1)
  ON CONFLICT (user_id, day) DO UPDATE SET queries = ai_usage.queries + 1
  RETURNING queries INTO n;
  IF lim IS NOT NULL AND n > lim THEN
    RAISE EXCEPTION 'daily question limit reached' USING ERRCODE = 'SL429';
  END IF;
  RETURN n;
END $$;
--> statement-breakpoint
-- Whether a text names a client other than the caller's own: the client
-- answer filter (src/lib/client-ai.ts) refuses such an answer. A client
-- person can't read other clients, so the database looks for them. Names,
-- Arabic names, aliases and short names of four letters or more; Latin
-- names as whole words. Firm staff get false: they already see every client's name.
CREATE FUNCTION app_names_other_client(p_text text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_org_kind() = 'client' AND EXISTS (
    SELECT 1 FROM organizations o
    CROSS JOIN LATERAL unnest(array_remove(ARRAY[o.name, o.name_ar, o.display_alias] || o.short_names, NULL)) AS n(term)
    WHERE o.kind = 'client' AND o.id <> app_org() AND length(btrim(n.term)) >= 4
      AND CASE WHEN btrim(n.term) ~ '^[A-Za-z0-9 .&''-]+$'
        THEN lower(p_text) ~ ('\m' || regexp_replace(lower(btrim(n.term)), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M')
        ELSE strpos(p_text, btrim(n.term)) > 0
      END
  )
$$;
--> statement-breakpoint
ALTER TABLE client_ai_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_ai_consents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON client_ai_settings, client_ai_consents, ai_usage TO selah_app;
--> statement-breakpoint
-- The firm admin, the client's consultants and the client's own people read the switch and its consents.
CREATE POLICY client_ai_read ON client_ai_settings FOR SELECT TO selah_app USING (app_can_see_org(client_org_id));
--> statement-breakpoint
CREATE POLICY client_ai_consent_read ON client_ai_consents FOR SELECT TO selah_app USING (app_can_see_org(client_org_id));
--> statement-breakpoint
CREATE POLICY own ON ai_usage FOR SELECT TO selah_app USING (user_id = app_uid());
--> statement-breakpoint
-- A second lock: a client person reads no passage of the index and no chat
-- unless the assistant is on for them now, whatever the app asks, and of the
-- index only passages of files, recommendations and actions (meeting notes
-- and reviews are the firm's to read through their own records).
CREATE POLICY assistant_on ON ai_chunks AS RESTRICTIVE FOR SELECT TO selah_app USING (
  app_org_kind() = 'firm' OR (app_client_ai_on() AND source_type IN ('document', 'recommendation', 'action'))
);
--> statement-breakpoint
CREATE POLICY assistant_on ON ai_conversations AS RESTRICTIVE FOR ALL TO selah_app USING (app_ai_allowed()) WITH CHECK (app_ai_allowed());
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_client_ai_consent(uuid), app_client_ai_on(), app_ai_allowed(), app_set_client_ai(uuid, boolean, role[], integer),
  app_consent_client_ai(text, text), app_withdraw_client_ai(), app_count_ai_question(date), app_names_other_client(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_client_ai_version(), app_client_ai_on(), app_ai_allowed(), app_set_client_ai(uuid, boolean, role[], integer),
  app_consent_client_ai(text, text), app_withdraw_client_ai(), app_count_ai_question(date), app_names_other_client(text) TO selah_app;
