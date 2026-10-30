CREATE TYPE "public"."indicator_channel" AS ENUM('typed', 'file', 'sheet', 'api');--> statement-breakpoint
CREATE TYPE "public"."indicator_data_mode" AS ENUM('typed', 'files', 'connected');--> statement-breakpoint
CREATE TYPE "public"."indicator_feed_kind" AS ENUM('sheet', 'api');--> statement-breakpoint
CREATE TABLE "client_indicator_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"data_mode" "indicator_data_mode" DEFAULT 'typed' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"proposed_mode" "indicator_data_mode",
	"proposed_by" uuid,
	"proposed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "indicator_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "indicator_feed_kind" NOT NULL,
	"label" text NOT NULL,
	"url" text,
	"token_hash" text,
	"token_hint" text,
	"run_as" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"last_run_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"last_error" text,
	"last_added" integer,
	"failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "indicator_feeds_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "indicator_feed_label" CHECK (char_length(btrim("indicator_feeds"."label")) BETWEEN 1 AND 100),
	CONSTRAINT "indicator_feed_shape" CHECK (("indicator_feeds"."kind" = 'sheet' AND "indicator_feeds"."url" IS NOT NULL AND "indicator_feeds"."token_hash" IS NULL) OR ("indicator_feeds"."kind" = 'api' AND "indicator_feeds"."url" IS NULL AND "indicator_feeds"."token_hash" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "indicator_feed_url" CHECK ("indicator_feeds"."url" IS NULL OR ("indicator_feeds"."url" ~ '^https://' AND char_length("indicator_feeds"."url") <= 2000))
);
--> statement-breakpoint
CREATE TABLE "indicator_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"channel" "indicator_channel" NOT NULL,
	"feed_id" uuid,
	"file_name" text,
	"sha256" text,
	"by_user" uuid NOT NULL,
	"on_behalf" boolean DEFAULT false NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"corrected" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indicator_import_channel" CHECK ("indicator_imports"."channel" <> 'typed' AND (("indicator_imports"."channel" = 'file') = ("indicator_imports"."feed_id" IS NULL))),
	CONSTRAINT "indicator_import_counts" CHECK ("indicator_imports"."added" >= 0 AND "indicator_imports"."corrected" >= 0 AND "indicator_imports"."unchanged" >= 0),
	CONSTRAINT "indicator_import_file" CHECK (char_length(coalesce("indicator_imports"."file_name", '')) <= 200 AND ("indicator_imports"."sha256" IS NULL OR "indicator_imports"."sha256" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "client_kpi_values" ADD COLUMN "channel" "indicator_channel" DEFAULT 'typed' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_kpi_values" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "client_kpis" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "client_kpis" ADD COLUMN "feed_on" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "client_indicator_settings" ADD CONSTRAINT "client_indicator_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_indicator_settings" ADD CONSTRAINT "client_indicator_settings_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_indicator_settings" ADD CONSTRAINT "client_indicator_settings_proposed_by_user_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_feeds" ADD CONSTRAINT "indicator_feeds_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_feeds" ADD CONSTRAINT "indicator_feeds_run_as_user_id_fk" FOREIGN KEY ("run_as") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_feeds" ADD CONSTRAINT "indicator_feeds_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_imports" ADD CONSTRAINT "indicator_imports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_imports" ADD CONSTRAINT "indicator_imports_feed_id_indicator_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."indicator_feeds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_imports" ADD CONSTRAINT "indicator_imports_by_user_user_id_fk" FOREIGN KEY ("by_user") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "indicator_feeds_org_idx" ON "indicator_feeds" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "indicator_imports_org_idx" ON "indicator_imports" USING btree ("org_id","created_at");--> statement-breakpoint
ALTER TABLE "client_kpi_values" ADD CONSTRAINT "client_kpi_values_import_id_indicator_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."indicator_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_kpi_values_import_idx" ON "client_kpi_values" USING btree ("import_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_kpis_code_once" ON "client_kpis" USING btree ("org_id","code");--> statement-breakpoint
ALTER TABLE "client_kpis" ADD CONSTRAINT "client_kpi_code" CHECK ("client_kpis"."code" IS NULL OR "client_kpis"."code" ~ '^[a-z0-9][a-z0-9_.-]{0,39}$');-- ------------------------------------------ how indicator figures reach Selah
-- 2026-10-30. Until now every business indicator value was typed in. Real
-- clients keep these numbers in an accounting or ERP system or a monthly
-- management report, and hand them over as Excel or CSV exports, a shared
-- sheet, or (the larger ones) through their own systems. Each client now
-- chooses how much it shares, in three steps:
--   typed     - nothing leaves its systems; someone types each figure (as before)
--   files     - it (or its consultant, for it) uploads exports; a person reviews
--               what was read before anything counts
--   connected - a published sheet Selah reads once a day, or a key its systems
--               send figures with, for the indicators it ticks
-- The client's admin decides (the firm, for a client with no accounts of its
-- own). Every value says how it arrived and which batch it came in, and is
-- still the client's reported figure, never verified impact.

-- What the client chose; "typed" when it never chose.
CREATE FUNCTION app_kpi_data_mode(org uuid) RETURNS indicator_data_mode
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT s.data_mode FROM client_indicator_settings s WHERE s.org_id = org), 'typed'::indicator_data_mode)
$$;
--> statement-breakpoint
-- Who decides what the client shares and connects its sources: the client's
-- admin; for a client with no accounts (consultant-managed), the firm people
-- who work with it, recording what the client agreed.
CREATE FUNCTION app_kpi_data_admin(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (app_role() = 'client_admin' AND org = app_org())
    OR (app_firm_works_with(org) AND EXISTS (
      SELECT 1 FROM organizations o WHERE o.id = org AND o.kind = 'client' AND o.engagement_mode = 'consultant_managed'))
$$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON client_indicator_settings TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON indicator_feeds TO selah_app;
--> statement-breakpoint
-- People only disconnect a connection; how it ran is written by app_indicator_feed_result().
GRANT UPDATE (revoked_at, revoked_by) ON indicator_feeds TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON indicator_imports TO selah_app;
--> statement-breakpoint
ALTER TABLE client_indicator_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE indicator_feeds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE indicator_imports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY scoped_read ON client_indicator_settings FOR SELECT TO selah_app USING (app_kpi_readable(org_id, NULL));
--> statement-breakpoint
CREATE POLICY data_admin_insert ON client_indicator_settings FOR INSERT TO selah_app WITH CHECK (app_kpi_data_admin(org_id));
--> statement-breakpoint
CREATE POLICY data_admin_update ON client_indicator_settings FOR UPDATE TO selah_app
  USING (app_kpi_data_admin(org_id)) WITH CHECK (app_kpi_data_admin(org_id));
--> statement-breakpoint
-- The firm and the client's admin see the connections and how they ran.
CREATE POLICY writer_read ON indicator_feeds FOR SELECT TO selah_app USING (app_kpi_writer(org_id));
--> statement-breakpoint
CREATE POLICY data_admin_insert ON indicator_feeds FOR INSERT TO selah_app WITH CHECK (app_kpi_data_admin(org_id) AND run_as = app_uid());
--> statement-breakpoint
CREATE POLICY data_admin_revoke ON indicator_feeds FOR UPDATE TO selah_app USING (app_kpi_data_admin(org_id)) WITH CHECK (app_kpi_data_admin(org_id));
--> statement-breakpoint
-- An import is seen by the firm and the client's admin, and by whoever made it.
CREATE POLICY writer_read ON indicator_imports FOR SELECT TO selah_app USING (app_kpi_writer(org_id) OR by_user = app_uid());
--> statement-breakpoint
CREATE POLICY report ON indicator_imports FOR INSERT TO selah_app WITH CHECK (
  by_user = app_uid() AND app_role() IN ('firm_admin', 'consultant', 'client_admin', 'client_manager') AND app_kpi_readable(org_id, NULL)
);
--> statement-breakpoint
-- The choice: for a client, by the person who made it, now. The firm's
-- suggestion (app_propose_kpi_data_mode) changes only the suggestion.
-- Going below "connected" disconnects every connection at once.
CREATE FUNCTION check_client_indicator_settings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (SELECT o.kind FROM organizations o WHERE o.id = NEW.org_id) IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'only a client chooses how its figures reach Selah' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.org_id <> OLD.org_id THEN
    RAISE EXCEPTION 'the choice stays with its client' USING ERRCODE = 'check_violation';
  END IF;
  IF current_setting('selah.kpi_proposal', true) = 'on' THEN
    -- A suggestion: the choice itself stays as it was.
    NEW.data_mode := CASE WHEN TG_OP = 'INSERT' THEN 'typed' ELSE OLD.data_mode END;
    NEW.decided_by := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.decided_by END;
    NEW.decided_at := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.decided_at END;
    NEW.proposed_by := app_uid();
    NEW.proposed_at := now();
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.proposed_mode := OLD.proposed_mode;
    NEW.proposed_by := OLD.proposed_by;
    NEW.proposed_at := OLD.proposed_at;
  ELSE
    NEW.proposed_mode := NULL;
    NEW.proposed_by := NULL;
    NEW.proposed_at := NULL;
  END IF;
  IF app_uid() IS NOT NULL THEN
    NEW.decided_by := app_uid();
  END IF;
  NEW.decided_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER client_indicator_settings_rules BEFORE INSERT OR UPDATE ON client_indicator_settings
  FOR EACH ROW EXECUTE FUNCTION check_client_indicator_settings();
--> statement-breakpoint
CREATE FUNCTION after_client_indicator_settings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.proposed_at IS DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.proposed_at END) THEN
    -- The firm suggested a mode: the client's admins confirm it on their overview.
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT m.user_id, 'indicator.data_proposed', 'organization', NEW.org_id FROM org_memberships m
      WHERE m.active AND m.org_id = NEW.org_id AND m.role = 'client_admin';
    RETURN NULL;
  END IF;
  IF NEW.decided_at IS NULL OR (TG_OP = 'UPDATE' AND NEW.data_mode = OLD.data_mode AND OLD.decided_at IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  IF NEW.data_mode <> 'connected' THEN
    UPDATE indicator_feeds SET revoked_at = now(), revoked_by = app_uid() WHERE org_id = NEW.org_id AND revoked_at IS NULL;
  END IF;
  -- The client's lead and deputy hear what the client chose (not when they chose it themselves).
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT DISTINCT ca.user_id, 'indicator.data_mode', 'organization', NEW.org_id FROM client_assignments ca
    WHERE ca.client_org_id = NEW.org_id AND (ca.is_lead OR ca.is_deputy) AND ca.user_id IS DISTINCT FROM app_uid();
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER client_indicator_settings_after AFTER INSERT OR UPDATE ON client_indicator_settings
  FOR EACH ROW EXECUTE FUNCTION after_client_indicator_settings();
--> statement-breakpoint
-- The firm suggests a mode after discovery (the client's consultants and the
-- firm admin); the client's admin confirms it or chooses another. For a
-- client with no accounts the firm records the choice itself instead.
CREATE FUNCTION app_propose_kpi_data_mode(org uuid, mode indicator_data_mode) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_org_kind() IS DISTINCT FROM 'firm' OR NOT app_firm_works_with(org) THEN
    RAISE EXCEPTION 'no such client' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('selah.kpi_proposal', 'on', true);
  INSERT INTO client_indicator_settings (org_id, proposed_mode) VALUES (org, mode)
    ON CONFLICT (org_id) DO UPDATE SET proposed_mode = EXCLUDED.proposed_mode;
  PERFORM set_config('selah.kpi_proposal', 'off', true);
END $$;
--> statement-breakpoint
-- A connection: for a client that chose "connected", at most five working at
-- once, in the name of whoever connects it. Afterwards people only
-- disconnect it, once.
CREATE FUNCTION check_indicator_feed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
      IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
        RAISE EXCEPTION 'this connection is already disconnected' USING ERRCODE = 'check_violation';
      END IF;
      NEW.revoked_at := now();
      IF app_uid() IS NOT NULL THEN
        NEW.revoked_by := app_uid();
      END IF;
    END IF;
    IF (NEW.id, NEW.org_id, NEW.kind, NEW.url, NEW.token_hash, NEW.run_as, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.org_id, OLD.kind, OLD.url, OLD.token_hash, OLD.run_as, OLD.created_at) THEN
      RAISE EXCEPTION 'a connection does not change; disconnect it and connect again' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (SELECT o.kind FROM organizations o WHERE o.id = NEW.org_id) IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'connections belong to a client' USING ERRCODE = 'check_violation';
  END IF;
  IF app_kpi_data_mode(NEW.org_id) <> 'connected' THEN
    RAISE EXCEPTION 'the client has not chosen to connect its figures' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM indicator_feeds f WHERE f.org_id = NEW.org_id AND f.revoked_at IS NULL) >= 5 THEN
    RAISE EXCEPTION 'a client has at most five connections; disconnect one first' USING ERRCODE = 'check_violation';
  END IF;
  NEW.label := btrim(NEW.label);
  IF app_uid() IS NOT NULL THEN
    NEW.run_as := app_uid();
  END IF;
  NEW.created_at := now();
  NEW.revoked_at := NULL;
  NEW.revoked_by := NULL;
  NEW.last_run_at := NULL;
  NEW.last_ok_at := NULL;
  NEW.last_error := NULL;
  NEW.last_added := NULL;
  NEW.failures := 0;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER indicator_feed_rules BEFORE INSERT OR UPDATE ON indicator_feeds FOR EACH ROW EXECUTE FUNCTION check_indicator_feed();
--> statement-breakpoint
-- A batch: by whoever brings it, now. A file needs a client that shares
-- files; a connection's batch needs that connection working, a client still
-- "connected", and comes in the name of who connected it.
CREATE FUNCTION check_indicator_import() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  f indicator_feeds;
  mode indicator_data_mode;
BEGIN
  IF (SELECT o.kind FROM organizations o WHERE o.id = NEW.org_id) IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'indicators belong to a client' USING ERRCODE = 'check_violation';
  END IF;
  IF app_uid() IS NOT NULL THEN
    NEW.by_user := app_uid();
    NEW.on_behalf := app_org_kind() = 'firm';
  END IF;
  NEW.created_at := now();
  mode := app_kpi_data_mode(NEW.org_id);
  IF NEW.channel = 'file' THEN
    IF mode = 'typed' THEN
      RAISE EXCEPTION 'this client shares no files for its indicators; its admin can change that' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO f FROM indicator_feeds WHERE id = NEW.feed_id;
  IF f.id IS NULL OR f.org_id <> NEW.org_id OR f.revoked_at IS NOT NULL OR f.kind::text <> NEW.channel::text OR mode <> 'connected' THEN
    RAISE EXCEPTION 'that connection is not working' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.by_user <> f.run_as THEN
    RAISE EXCEPTION 'a connection sends figures in the name of who connected it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER indicator_import_rules BEFORE INSERT ON indicator_imports FOR EACH ROW EXECUTE FUNCTION check_indicator_import();
--> statement-breakpoint
-- A file the firm brought in for the client tells the client's admins once,
-- not once per value.
CREATE FUNCTION notify_indicator_import() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.on_behalf AND NEW.channel = 'file' THEN
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT m.user_id, 'indicator.imported_for_you', 'organization', NEW.org_id FROM org_memberships m
      WHERE m.active AND m.org_id = NEW.org_id AND m.role = 'client_admin';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER indicator_import_notify AFTER INSERT ON indicator_imports FOR EACH ROW EXECUTE FUNCTION notify_indicator_import();
--> statement-breakpoint
-- A value that came in a batch says so with its batch's channel, joins only a
-- batch made in the same transaction by the same person, and, from a
-- connection, only for an indicator the client lets connections fill. A
-- typed value belongs to no batch.
CREATE FUNCTION check_client_kpi_value_channel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE i indicator_imports;
BEGIN
  IF NEW.import_id IS NULL THEN
    IF NEW.channel <> 'typed' THEN
      RAISE EXCEPTION 'a value from a file, a sheet or a system comes in a batch' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO i FROM indicator_imports WHERE id = NEW.import_id;
  IF i.id IS NULL OR i.org_id <> NEW.org_id THEN
    RAISE EXCEPTION 'that batch is for another client' USING ERRCODE = 'check_violation';
  END IF;
  IF app_uid() IS NOT NULL AND (i.by_user <> app_uid() OR i.created_at <> now()) THEN
    RAISE EXCEPTION 'values join a batch only as it is brought in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.channel := i.channel;
  IF i.channel IN ('sheet', 'api') AND NOT (SELECT k.feed_on FROM client_kpis k WHERE k.id = NEW.kpi_id) THEN
    RAISE EXCEPTION 'the client has not let connections fill this indicator' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Named to run after client_kpi_value_rules, which settles org_id.
CREATE TRIGGER client_kpi_value_source BEFORE INSERT ON client_kpi_values FOR EACH ROW EXECUTE FUNCTION check_client_kpi_value_channel();
--> statement-breakpoint
-- Which indicators connections may fill is the client's call, like the mode.
CREATE FUNCTION check_client_kpi_feed_on() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_uid() IS NOT NULL AND NEW.feed_on IS DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN false ELSE OLD.feed_on END)
     AND NOT app_kpi_data_admin(NEW.org_id) THEN
    RAISE EXCEPTION 'the client''s admin chooses which indicators connections fill' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.code := nullif(lower(btrim(NEW.code)), '');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER client_kpi_feed_rules BEFORE INSERT OR UPDATE ON client_kpis FOR EACH ROW EXECUTE FUNCTION check_client_kpi_feed_on();
--> statement-breakpoint
-- A value the firm entered by hand tells the client's admins, as before; a
-- batch tells them once (notify_indicator_import).
CREATE OR REPLACE FUNCTION notify_client_kpi_value() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.on_behalf AND NEW.import_id IS NULL THEN
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT m.user_id, 'indicator.entered_for_you', 'kpi', NEW.kpi_id FROM org_memberships m
      WHERE m.active AND m.org_id = NEW.org_id AND m.role = 'client_admin';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- The connection behind a key (only its hash is looked up), while it works:
-- not disconnected, the client active and still "connected". For the
-- endpoint client systems call, which has no signed-in person.
CREATE FUNCTION app_indicator_feed_by_token(h text) RETURNS TABLE (id uuid, org_id uuid, run_as uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.id, f.org_id, f.run_as FROM indicator_feeds f JOIN organizations o ON o.id = f.org_id
  WHERE f.token_hash = h AND f.kind = 'api' AND f.revoked_at IS NULL AND o.status = 'active'
    AND app_kpi_data_mode(f.org_id) = 'connected'
$$;
--> statement-breakpoint
-- How a run went, by the connection's own person (or the job). Three
-- failures in a row tell that person once.
CREATE FUNCTION app_indicator_feed_result(fid uuid, ok boolean, err text, added integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE f indicator_feeds;
BEGIN
  SELECT * INTO f FROM indicator_feeds WHERE id = fid;
  IF f.id IS NULL OR (app_uid() IS NOT NULL AND app_uid() <> f.run_as AND NOT app_kpi_data_admin(f.org_id)) THEN
    RAISE EXCEPTION 'no such connection' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF ok THEN
    UPDATE indicator_feeds SET last_run_at = now(), last_ok_at = now(), last_error = NULL, last_added = added, failures = 0 WHERE id = fid;
  ELSE
    UPDATE indicator_feeds SET last_run_at = now(), last_error = left(coalesce(err, 'failed'), 300), failures = failures + 1 WHERE id = fid;
    IF f.failures + 1 = 3 THEN
      INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES (f.run_as, 'indicator.feed_failing', 'organization', f.org_id);
    END IF;
  END IF;
END $$;
--> statement-breakpoint
-- The series now also says how each value arrived.
DROP FUNCTION app_kpi_series(uuid, date);
--> statement-breakpoint
CREATE FUNCTION app_kpi_series(kid uuid, as_of date)
RETURNS TABLE (period date, period_end date, value_id uuid, value numeric, note text, entered_by uuid, entered_at timestamptz,
  on_behalf boolean, checked boolean, corrected boolean, status text, channel text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH k AS (SELECT * FROM client_kpis WHERE id = kid),
  periods AS (
    SELECT g::date AS period, (g + make_interval(months => app_kpi_months(k.frequency)))::date - 1 AS period_end
    FROM k, generate_series((k.baseline_period + make_interval(months => app_kpi_months(k.frequency)))::timestamp,
                            as_of::timestamp, make_interval(months => app_kpi_months(k.frequency))) g
  ),
  known AS (
    SELECT DISTINCT ON (v.period) v.* FROM client_kpi_values v
    WHERE v.kpi_id = kid AND (v.entered_at AT TIME ZONE app_firm_tz())::date <= as_of
    ORDER BY v.period, v.entered_at DESC, v.id DESC
  )
  SELECT p.period, p.period_end, v.id, v.value, v.note, v.entered_by, v.entered_at, v.on_behalf, v.checked_by IS NOT NULL,
    v.supersedes_id IS NOT NULL,
    CASE WHEN v.id IS NOT NULL THEN 'reported' WHEN p.period_end + app_kpi_grace_days() < as_of THEN 'missing' ELSE 'due' END,
    v.channel::text
  FROM periods p LEFT JOIN known v ON v.period = p.period
  ORDER BY p.period
$$;
--> statement-breakpoint
-- The monthly reminder asks only for figures someone has to bring: an
-- indicator a working connection fills is left out.
CREATE OR REPLACE FUNCTION app_remind_kpis(today date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF app_uid() IS NOT NULL THEN
    RAISE EXCEPTION 'reminders are sent by the monthly job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  WITH due AS (
    SELECT DISTINCT k.org_id FROM client_kpis k JOIN organizations o ON o.id = k.org_id
    WHERE k.active AND o.status = 'active'
      AND NOT (k.feed_on AND app_kpi_data_mode(k.org_id) = 'connected'
               AND EXISTS (SELECT 1 FROM indicator_feeds f WHERE f.org_id = k.org_id AND f.revoked_at IS NULL AND f.failures < 3))
      -- The period that ended yesterday: it starts a whole number of periods after the baseline.
      AND ((extract(year FROM today - 1)::int * 12 + extract(month FROM today - 1)::int)
          - (extract(year FROM k.baseline_period)::int * 12 + extract(month FROM k.baseline_period)::int) + 1)
          % app_kpi_months(k.frequency) = 0
      AND date_trunc('month', today - 1)::date - make_interval(months => app_kpi_months(k.frequency) - 1) > k.baseline_period
      AND NOT EXISTS (
        SELECT 1 FROM client_kpi_values v
        WHERE v.kpi_id = k.id AND v.period = (date_trunc('month', today - 1) - make_interval(months => app_kpi_months(k.frequency) - 1))::date)
      AND NOT EXISTS (
        SELECT 1 FROM notifications x WHERE x.kind = 'indicator.due' AND x.entity_id = k.org_id AND x.created_at::date >= today - 20)
  ), sent AS (
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT m.user_id, 'indicator.due', 'organization', d.org_id FROM due d
      JOIN org_memberships m ON m.org_id = d.org_id AND m.active AND m.role = 'client_admin'
    RETURNING entity_id
  )
  SELECT count(DISTINCT entity_id) INTO n FROM sent;
  RETURN n;
END $$;
--> statement-breakpoint
-- An archived client's choice, connections and batches freeze with its indicators.
CREATE TRIGGER client_open BEFORE INSERT OR UPDATE OR DELETE ON client_indicator_settings FOR EACH ROW EXECUTE FUNCTION check_client_open();
--> statement-breakpoint
CREATE TRIGGER client_open BEFORE INSERT OR UPDATE OR DELETE ON indicator_feeds FOR EACH ROW EXECUTE FUNCTION check_client_open();
--> statement-breakpoint
CREATE TRIGGER client_open BEFORE INSERT OR UPDATE OR DELETE ON indicator_imports FOR EACH ROW EXECUTE FUNCTION check_client_open();
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_kpi_data_mode(uuid), app_kpi_data_admin(uuid), app_indicator_feed_by_token(text), app_propose_kpi_data_mode(uuid, indicator_data_mode),
  app_indicator_feed_result(uuid, boolean, text, integer), app_kpi_series(uuid, date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_kpi_data_mode(uuid), app_kpi_data_admin(uuid), app_indicator_feed_by_token(text), app_propose_kpi_data_mode(uuid, indicator_data_mode),
  app_indicator_feed_result(uuid, boolean, text, integer), app_kpi_series(uuid, date) TO selah_app;
