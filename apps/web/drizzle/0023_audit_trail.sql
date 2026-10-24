CREATE TABLE "audit_chain" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"anchor_seq" bigint DEFAULT 0 NOT NULL,
	"anchor_hash" text DEFAULT repeat('0', 64) NOT NULL,
	"head_seq" bigint DEFAULT 0 NOT NULL,
	"head_hash" text DEFAULT repeat('0', 64) NOT NULL,
	"pruned_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_chain_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rows_checked" bigint NOT NULL,
	"ok" boolean NOT NULL,
	"first_bad_seq" bigint,
	"head_seq" bigint NOT NULL,
	"head_hash" text NOT NULL,
	"unsealed" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "chain_seq" bigint;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "chain_hash" text;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "audit_keep_months" integer DEFAULT 12 NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_org_idx" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_chain_seq_uq" UNIQUE("chain_seq");--> statement-breakpoint
-- Hand-written (R2): the audit log becomes readable for admins, tamper-evident
-- and kept for a protected period.
--
-- Tamper evidence is a hash chain. The app only inserts rows (as before);
-- the sealing job, running as the schema owner, gives each new row the next
-- place in the chain and sha256(previous hash | place | the row's fields).
-- Changing, removing or reordering a sealed row breaks every hash after it,
-- which the nightly check finds. Sealing after the insert (rather than in an
-- insert trigger) keeps a single lock off every request.
CREATE FUNCTION app_audit_hash(prev text, seq bigint, a audit_log) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT encode(sha256(convert_to(concat_ws('|',
    prev, seq::text, quote_nullable(a.id::text), quote_nullable(a.actor_id::text), quote_nullable(a.org_id::text),
    quote_nullable(a.action), quote_nullable(a.resource_type), quote_nullable(a.resource_id::text),
    quote_nullable(a.outcome::text), quote_nullable(a.reason), quote_nullable(a.ip), quote_nullable(a.meta::text),
    quote_nullable((extract(epoch FROM a.created_at) * 1000000)::bigint::text)), 'UTF8')), 'hex')
$$;
--> statement-breakpoint
-- Months the log is kept: the firm's setting, never below the range's floor
-- of 12 (firm_settings.audit_keep_months_range). One firm per install.
CREATE FUNCTION app_audit_keep_months() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT greatest(12, coalesce((
    SELECT fs.audit_keep_months FROM firm_settings fs JOIN organizations o ON o.id = fs.org_id AND o.kind = 'firm' LIMIT 1), 12))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_audit_hash(text, bigint, audit_log), app_audit_keep_months() FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE firm_settings ADD CONSTRAINT audit_keep_months_range CHECK (audit_keep_months BETWEEN 12 AND 120);
--> statement-breakpoint
-- The app and Better Auth still only insert. The owner may do two things,
-- each behind its own flag set by the function that does it: seal a row
-- (fill chain_seq and chain_hash once, nothing else changes), and delete
-- sealed rows that are past the keep period and behind the chain's anchor.
-- Nothing else, and never a row younger than the keep period.
CREATE FUNCTION audit_log_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'audit_log can''t be truncated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF current_user NOT IN ('selah_app', 'selah_auth') THEN
    IF TG_OP = 'UPDATE' AND current_setting('selah.audit_seal', true) = 'on'
       AND OLD.chain_seq IS NULL AND NEW.chain_seq IS NOT NULL AND NEW.chain_hash IS NOT NULL
       AND (to_jsonb(OLD) - 'chain_seq' - 'chain_hash') = (to_jsonb(NEW) - 'chain_seq' - 'chain_hash') THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' AND current_setting('selah.audit_prune', true) = 'on'
       AND OLD.chain_seq IS NOT NULL AND OLD.chain_seq <= (SELECT anchor_seq FROM audit_chain)
       AND OLD.created_at < now() - make_interval(months => app_audit_keep_months()) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
DROP TRIGGER append_only ON audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_log_guard BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_guard();
--> statement-breakpoint
-- Owner only: no grants and no policies, so the app reads neither table.
ALTER TABLE audit_chain ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_chain_checks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO audit_chain (id) VALUES (true);
--> statement-breakpoint
-- The chain's ends only move forward, and there is only ever one row.
CREATE FUNCTION audit_chain_forward() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.head_seq < OLD.head_seq OR NEW.anchor_seq < OLD.anchor_seq
     OR NEW.anchor_seq > NEW.head_seq THEN
    RAISE EXCEPTION 'the audit chain only moves forward' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_chain_forward BEFORE UPDATE OR DELETE ON audit_chain FOR EACH ROW EXECUTE FUNCTION audit_chain_forward();
--> statement-breakpoint
CREATE TRIGGER audit_chain_one_row BEFORE INSERT ON audit_chain FOR EACH ROW EXECUTE FUNCTION audit_chain_forward();
--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON audit_chain_checks FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
-- Seal new rows in the order they were written. Run by the jobs service every
-- few minutes; a row committed late is sealed on the next run. Returns how
-- many rows it sealed.
CREATE FUNCTION app_seal_audit_log(max_rows integer DEFAULT 10000) RETURNS integer
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $$
DECLARE
  c audit_chain%ROWTYPE;
  r audit_log%ROWTYPE;
  s bigint;
  h text;
  n integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('selah.audit_seal'));
  SELECT * INTO c FROM audit_chain FOR UPDATE;
  s := c.head_seq;
  h := c.head_hash;
  PERFORM set_config('selah.audit_seal', 'on', true);
  FOR r IN SELECT * FROM audit_log WHERE chain_seq IS NULL ORDER BY created_at, id LIMIT max_rows LOOP
    s := s + 1;
    h := app_audit_hash(h, s, r);
    UPDATE audit_log SET chain_seq = s, chain_hash = h WHERE id = r.id;
    n := n + 1;
  END LOOP;
  PERFORM set_config('selah.audit_seal', '', true);
  IF n > 0 THEN
    UPDATE audit_chain SET head_seq = s, head_hash = h;
  END IF;
  RETURN n;
END $$;
--> statement-breakpoint
-- Walk the chain from its anchor and recompute every hash; record the result.
-- A gap, a changed field, a moved row or an end that doesn't match the
-- recorded head all fail the check at the first place they show.
CREATE FUNCTION app_check_audit_chain() RETURNS audit_chain_checks
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $$
DECLARE
  c audit_chain%ROWTYPE;
  r audit_log%ROWTYPE;
  s bigint;
  h text;
  n bigint := 0;
  bad bigint;
  out audit_chain_checks%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('selah.audit_seal'));
  SELECT * INTO c FROM audit_chain;
  s := c.anchor_seq;
  h := c.anchor_hash;
  FOR r IN SELECT * FROM audit_log WHERE chain_seq > c.anchor_seq ORDER BY chain_seq LOOP
    n := n + 1;
    IF r.chain_seq <> s + 1 OR r.chain_hash IS DISTINCT FROM app_audit_hash(h, r.chain_seq, r) THEN
      bad := least(r.chain_seq, s + 1);
      EXIT;
    END IF;
    s := r.chain_seq;
    h := r.chain_hash;
  END LOOP;
  IF bad IS NULL AND (s <> c.head_seq OR h <> c.head_hash) THEN
    bad := s + 1;
  END IF;
  INSERT INTO audit_chain_checks (rows_checked, ok, first_bad_seq, head_seq, head_hash, unsealed)
  VALUES (n, bad IS NULL, bad, c.head_seq, c.head_hash, (SELECT count(*) FROM audit_log WHERE chain_seq IS NULL))
  RETURNING * INTO out;
  RETURN out;
END $$;
--> statement-breakpoint
-- Remove sealed rows older than the keep period, from the start of the chain
-- only, after a check that passes. The last removed row's hash becomes the
-- anchor the next check starts from. Returns how many rows went.
CREATE FUNCTION app_prune_audit_log() RETURNS integer
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $$
DECLARE
  c audit_chain%ROWTYPE;
  cutoff timestamptz := now() - make_interval(months => app_audit_keep_months());
  upto bigint;
  n integer;
BEGIN
  IF NOT (app_check_audit_chain()).ok THEN
    RAISE EXCEPTION 'the audit chain check failed; nothing is pruned until it passes' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO c FROM audit_chain FOR UPDATE;
  SELECT coalesce(min(chain_seq) - 1, c.head_seq) INTO upto FROM audit_log WHERE chain_seq > c.anchor_seq AND created_at >= cutoff;
  IF upto <= c.anchor_seq THEN
    RETURN 0;
  END IF;
  UPDATE audit_chain SET anchor_seq = upto, anchor_hash = (SELECT chain_hash FROM audit_log WHERE chain_seq = upto), pruned_at = now();
  PERFORM set_config('selah.audit_prune', 'on', true);
  DELETE FROM audit_log WHERE chain_seq <= upto;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('selah.audit_prune', '', true);
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_seal_audit_log(integer), app_check_audit_chain(), app_prune_audit_log() FROM PUBLIC;
--> statement-breakpoint
-- What an admin may read. The firm admin: everything. A client admin: what
-- their own people did (and sign-in attempts on their accounts), never the
-- firm's work; for a refused attempt they see that it was refused, not what
-- it was refused on, so a record the firm keeps private can't be inferred
-- from the reason. Everyone else: nothing. Newest first, one page at a time.
CREATE FUNCTION app_audit_visible(a audit_log) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN app_org_kind() = 'firm' AND app_role() = 'firm_admin' THEN true
    WHEN app_org_kind() = 'client' AND app_role() = 'client_admin' THEN
      (a.org_id IS NULL OR a.org_id = app_org()) AND (
        EXISTS (SELECT 1 FROM org_memberships m WHERE m.org_id = app_org() AND m.user_id = a.actor_id)
        OR (a.actor_id IS NULL AND a.action LIKE 'auth.%' AND a.resource_type = 'user'
            AND EXISTS (SELECT 1 FROM org_memberships m WHERE m.org_id = app_org() AND m.user_id = a.resource_id)))
    ELSE false
  END
$$;
--> statement-breakpoint
CREATE FUNCTION app_audit_entries(
  since timestamptz, until timestamptz, who uuid, areas text[], result text, of_org uuid, max_rows integer, skip integer)
RETURNS TABLE (
  id uuid, created_at timestamptz, actor_id uuid, actor_name text, actor_email text, actor_org text, actor_org_ar text,
  org_id uuid, action text, resource_type text, resource_id uuid, outcome text, reason text, ip text, meta jsonb,
  chain_seq bigint, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH me AS (SELECT app_org_kind() = 'firm' AS firm)
  SELECT a.id, a.created_at, u.id, u.name, u.email, o.name, o.name_ar, a.org_id, a.action, a.resource_type,
    CASE WHEN me.firm OR a.outcome <> 'deny' THEN a.resource_id END,
    a.outcome::text,
    CASE WHEN me.firm OR a.outcome <> 'deny' THEN a.reason END,
    a.ip,
    CASE WHEN me.firm OR a.outcome <> 'deny' THEN a.meta ELSE '{}'::jsonb END,
    a.chain_seq, count(*) OVER ()
  FROM audit_log a
  CROSS JOIN me
  -- The person: who acted, or for a sign-in event without one the account it was for.
  LEFT JOIN "user" u ON u.id = coalesce(a.actor_id, CASE WHEN a.action LIKE 'auth.%' AND a.resource_type = 'user' THEN a.resource_id END)
  LEFT JOIN org_memberships m ON m.user_id = u.id
  LEFT JOIN organizations o ON o.id = m.org_id
  WHERE app_audit_visible(a)
    AND (since IS NULL OR a.created_at >= since)
    AND (until IS NULL OR a.created_at < until)
    AND (who IS NULL OR u.id = who)
    AND (areas IS NULL OR EXISTS (SELECT 1 FROM unnest(areas) p WHERE a.action = p OR a.action LIKE p || '.%'))
    AND (result IS NULL OR a.outcome::text = result)
    AND (of_org IS NULL OR m.org_id = of_org)
  ORDER BY a.created_at DESC, a.id DESC
  LIMIT least(greatest(max_rows, 1), 20000) OFFSET greatest(skip, 0)
$$;
--> statement-breakpoint
-- The people who appear in the log the caller may read, for the filter.
CREATE FUNCTION app_audit_people() RETURNS TABLE (id uuid, name text, email text, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.name, u.email, m.org_id FROM "user" u
  JOIN org_memberships m ON m.user_id = u.id
  WHERE EXISTS (SELECT 1 FROM audit_log a WHERE (a.actor_id = u.id OR (a.actor_id IS NULL AND a.action LIKE 'auth.%' AND a.resource_type = 'user' AND a.resource_id = u.id))
    AND app_audit_visible(a))
  ORDER BY u.name
  LIMIT 2000
$$;
--> statement-breakpoint
-- The chain's state for the firm admin: the last check, rows waiting to be
-- sealed, where the chain starts and the keep period. Nothing for anyone else.
CREATE FUNCTION app_audit_chain_status() RETURNS TABLE (
  checked_at timestamptz, ok boolean, rows_checked bigint, first_bad_seq bigint, head_seq bigint, head_hash text,
  unsealed bigint, anchor_seq bigint, pruned_at timestamptz, keep_months integer, oldest timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT k.checked_at, k.ok, k.rows_checked, k.first_bad_seq, c.head_seq, c.head_hash,
    (SELECT count(*) FROM audit_log WHERE chain_seq IS NULL), c.anchor_seq, c.pruned_at, app_audit_keep_months(),
    (SELECT min(created_at) FROM audit_log)
  FROM audit_chain c
  LEFT JOIN LATERAL (SELECT * FROM audit_chain_checks ORDER BY checked_at DESC LIMIT 1) k ON true
  WHERE app_org_kind() = 'firm' AND app_role() = 'firm_admin'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_audit_visible(audit_log), app_audit_entries(timestamptz, timestamptz, uuid, text[], text, uuid, integer, integer),
  app_audit_people(), app_audit_chain_status() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_audit_entries(timestamptz, timestamptz, uuid, text[], text, uuid, integer, integer),
  app_audit_people(), app_audit_chain_status() TO selah_app;
