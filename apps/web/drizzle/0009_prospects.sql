CREATE TABLE "storage_deletions" (
	"storage_key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "prospect" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- ------------------------------------------------ prospects and pitches
-- A prospect is a company the firm approached and is pitching (journey gap
-- N4). It is a client organisation that was never signed: firm-only, no
-- accounts, hidden from consultants who are not on it. Its first signed
-- engagement makes it a client; a lost pitch is deleted (N7).

-- A prospect is a client; it stops being one only when an engagement is
-- signed, and a client never goes back to being a prospect.
CREATE FUNCTION check_prospect() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.prospect AND NEW.kind <> 'client' THEN
    RAISE EXCEPTION 'only a client can be a prospect' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.prospect AND NOT OLD.prospect THEN
      RAISE EXCEPTION 'a client never becomes a prospect again' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.prospect AND NOT NEW.prospect
       AND NOT EXISTS (SELECT 1 FROM engagements g WHERE g.client_org_id = NEW.id) THEN
      RAISE EXCEPTION 'a prospect becomes a client when its first signed engagement is recorded' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER prospect_rules BEFORE INSERT OR UPDATE OF prospect, kind ON organizations FOR EACH ROW EXECUTE FUNCTION check_prospect();
--> statement-breakpoint
-- Recording the first signed engagement wins the pitch.
CREATE FUNCTION win_prospect() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE organizations SET prospect = false WHERE id = NEW.client_org_id AND prospect;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER prospect_won AFTER INSERT ON engagements FOR EACH ROW EXECUTE FUNCTION win_prospect();
--> statement-breakpoint
-- No accounts, invitations or join requests for a prospect: its people join
-- once it signs, and colleagues join a pitch when its lead adds them.
CREATE FUNCTION check_prospect_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  target uuid;
BEGIN
  IF TG_TABLE_NAME = 'join_requests' THEN
    target := NEW.client_org_id;
  ELSE
    target := NEW.org_id;
  END IF;
  IF EXISTS (SELECT 1 FROM organizations o WHERE o.id = target AND o.prospect) THEN
    IF TG_TABLE_NAME = 'join_requests' THEN
      RAISE EXCEPTION 'a pitch is joined when its lead adds you' USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'a prospect has no accounts until it signs' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER prospect_access BEFORE INSERT ON invitations FOR EACH ROW EXECUTE FUNCTION check_prospect_access();
--> statement-breakpoint
CREATE TRIGGER prospect_access BEFORE INSERT OR UPDATE OF org_id ON org_memberships FOR EACH ROW EXECUTE FUNCTION check_prospect_access();
--> statement-breakpoint
CREATE TRIGGER prospect_access BEFORE INSERT ON join_requests FOR EACH ROW EXECUTE FUNCTION check_prospect_access();
--> statement-breakpoint
-- The client directory leaves out pitches the consultant is not on.
CREATE OR REPLACE FUNCTION app_client_directory()
RETURNS TABLE (id uuid, name text, name_ar text, assigned boolean, is_lead boolean, pending boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.id, o.name, o.name_ar,
    EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = o.id AND ca.user_id = app_uid()),
    EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = o.id AND ca.user_id = app_uid() AND ca.is_lead),
    EXISTS (SELECT 1 FROM join_requests jr WHERE jr.client_org_id = o.id AND jr.user_id = app_uid() AND jr.status = 'pending')
  FROM organizations o
  WHERE o.kind = 'client' AND o.status = 'active' AND app_org_kind() = 'firm' AND app_role() IN ('firm_admin', 'consultant')
    AND (NOT o.prospect OR app_role() = 'firm_admin' OR app_is_assigned_to_client(o.id))
  ORDER BY o.name
$$;
--> statement-breakpoint
-- Any consultant (or the firm admin) starts a pitch: the prospect and its
-- first draft project. A consultant leads it and adds colleagues; only the
-- firm admin records what is signed.
CREATE FUNCTION app_start_pitch(p_name text, p_name_ar text, p_title text)
RETURNS TABLE (org_id uuid, project_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  o uuid := gen_random_uuid();
  p uuid := gen_random_uuid();
BEGIN
  IF app_uid() IS NULL OR app_org_kind() IS DISTINCT FROM 'firm' OR app_role() NOT IN ('firm_admin', 'consultant') THEN
    RAISE EXCEPTION 'firm staff start a pitch' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO organizations (id, kind, name, name_ar, prospect) VALUES (o, 'client', p_name, nullif(p_name_ar, ''), true);
  IF app_role() = 'consultant' THEN
    INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES (o, app_uid(), true);
  END IF;
  INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by)
  VALUES (p, 'client', o, app_org(), p_title, 'draft', app_uid());
  RETURN QUERY SELECT o, p;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_start_pitch(text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_start_pitch(text, text, text) TO selah_app;
--> statement-breakpoint
-- ------------------------------------------------ deleting the unsigned
-- Archive what was signed or released; delete only what never was. Deleting
-- an unsigned client lifts the append-only rules for its own rows, inside
-- this function only.
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('selah.purge', true) = 'on' AND current_user NOT IN ('selah_app', 'selah_auth') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND current_setting('selah.discard', true) = 'on' AND current_user NOT IN ('selah_app', 'selah_auth') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION freeze_report() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.metrics IS NULL
     OR (TG_OP = 'DELETE' AND current_setting('selah.discard', true) = 'on' AND current_user NOT IN ('selah_app', 'selah_auth')) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - '{visibility,shared_at}'::text[]) <> (to_jsonb(OLD) - '{visibility,shared_at}'::text[]) THEN
    RAISE EXCEPTION 'an issued report cannot change; write a new one' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- A deleted file's bytes leave the bucket too (the delete-objects job).
CREATE FUNCTION queue_storage_deletion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO storage_deletions (storage_key) VALUES (OLD.storage_key) ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER storage_deletion AFTER DELETE ON documents FOR EACH ROW EXECUTE FUNCTION queue_storage_deletion();
--> statement-breakpoint
ALTER TABLE storage_deletions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- What may be deleted, and by whom: a client that never signed an
-- engagement, never had an account and did not come from an inquiry. A
-- prospect goes with everything in its pitch, by the firm admin or its lead;
-- any other such client (added by mistake) only by the firm admin, and only
-- while it holds no files.
CREATE FUNCTION app_discard_check(oid uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN o.id IS NULL OR app_org_kind() IS DISTINCT FROM 'firm' OR NOT app_can_see_org(o.id) THEN 'hidden'
    WHEN EXISTS (SELECT 1 FROM engagements g WHERE g.client_org_id = o.id) THEN 'signed'
    WHEN EXISTS (SELECT 1 FROM org_memberships m WHERE m.org_id = o.id) THEN 'accounts'
    WHEN EXISTS (SELECT 1 FROM inquiries i WHERE i.client_org_id = o.id) THEN 'inquiry'
    WHEN o.prospect AND (app_role() = 'firm_admin' OR app_is_client_lead(o.id)) THEN NULL
    WHEN o.prospect THEN 'not_lead'
    WHEN app_role() IS DISTINCT FROM 'firm_admin' THEN 'not_admin'
    WHEN EXISTS (SELECT 1 FROM documents d WHERE d.org_id = o.id OR d.owner_org_id = o.id) THEN 'files'
    ELSE NULL
  END
  FROM (SELECT oid AS x) q LEFT JOIN organizations o ON o.id = q.x AND o.kind = 'client'
$$;
--> statement-breakpoint
CREATE FUNCTION app_discard_client(oid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  why text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = oid AND o.kind = 'client') THEN
    RAISE EXCEPTION 'no such client' USING ERRCODE = 'no_data_found';
  END IF;
  why := app_discard_check(oid);
  IF why = 'hidden' THEN
    RAISE EXCEPTION 'no such client' USING ERRCODE = 'no_data_found';
  ELSIF why IS NOT NULL THEN
    RAISE EXCEPTION 'this client cannot be deleted: %', why USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('selah.discard', 'on', true);
  DELETE FROM projects WHERE org_id = oid;
  DELETE FROM documents WHERE org_id = oid OR owner_org_id = oid;
  DELETE FROM client_contacts WHERE org_id = oid;
  DELETE FROM invitations WHERE org_id = oid;
  DELETE FROM access_reviews WHERE org_id = oid;
  DELETE FROM organizations WHERE id = oid;
  PERFORM set_config('selah.discard', '', true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_discard_check(uuid), app_discard_client(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_discard_check(uuid), app_discard_client(uuid) TO selah_app;

--> statement-breakpoint
-- A new client without minimal records sets nothing; a consultant may start a pitch.
CREATE OR REPLACE FUNCTION public.check_minimal_records()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE switched boolean := CASE WHEN TG_OP = 'INSERT' THEN NEW.minimal_records OR NEW.display_alias IS NOT NULL
  ELSE NEW.minimal_records IS DISTINCT FROM OLD.minimal_records OR NEW.display_alias IS DISTINCT FROM OLD.display_alias END;
BEGIN
  IF switched AND app_uid() IS NOT NULL AND app_role() IS DISTINCT FROM 'firm_admin' THEN
    RAISE EXCEPTION 'only the firm admin sets minimal records' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT NEW.minimal_records THEN
    RETURN NEW;
  END IF;
  IF NEW.engagement_mode IS DISTINCT FROM 'consultant_managed' THEN
    RAISE EXCEPTION 'minimal records are for clients the firm manages' USING ERRCODE = 'check_violation';
  END IF;
  IF nullif(trim(NEW.display_alias), '') IS NULL THEN
    RAISE EXCEPTION 'give the client an alias' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' OR NOT OLD.minimal_records THEN
    IF EXISTS (SELECT 1 FROM client_contacts c WHERE c.org_id = NEW.id) OR EXISTS (SELECT 1 FROM documents d WHERE d.org_id = NEW.id) THEN
      RAISE EXCEPTION 'remove the client''s contacts and files before switching to minimal records' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.display_alias := trim(NEW.display_alias);
  NEW.name := NEW.display_alias;
  NEW.name_ar := NEW.display_alias;
  RETURN NEW;
END $function$;
