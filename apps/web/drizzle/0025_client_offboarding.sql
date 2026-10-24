CREATE TABLE "client_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"archived_at" timestamp with time zone,
	"retain_until" date,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"counts" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_offboardings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"archived_by" uuid,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"grace_until" timestamp with time zone NOT NULL,
	"retain_until" date NOT NULL,
	"note" text,
	"drafts_deleted" integer DEFAULT 0 NOT NULL,
	"restored_by" uuid,
	"restored_at" timestamp with time zone,
	"restore_reason" text
);
--> statement-breakpoint
CREATE TABLE "legal_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"placed_by" uuid,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"release_reason" text
);
--> statement-breakpoint
ALTER TABLE "client_offboardings" ADD CONSTRAINT "client_offboardings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_offboardings" ADD CONSTRAINT "client_offboardings_archived_by_user_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_offboardings" ADD CONSTRAINT "client_offboardings_restored_by_user_id_fk" FOREIGN KEY ("restored_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_placed_by_user_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_released_by_user_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_offboardings_one_open" ON "client_offboardings" USING btree ("org_id") WHERE restored_at IS NULL;--> statement-breakpoint
CREATE INDEX "legal_holds_org_idx" ON "legal_holds" USING btree ("org_id");--> statement-breakpoint
-- ------------------------------------------------------------ offboarding
-- A client leaves cleanly (full picture item 27, journey J14.1-J14.5). Once
-- every project is closed the firm admin archives the client: draft
-- projects (never signed work) are deleted, open invitations revoked, and
-- its people keep read-only access for a grace period (0 to 90 days). The
-- records are then kept for ten years (Saudi commercial books law; CMA
-- governance regulations Article 93) and a daily job deletes them after,
-- leaving a deletion record, unless a legal hold stands. The firm admin can
-- restore an archived client at any time before that. Status changes go
-- only through the functions below.

-- The mail telling a client's admins it was archived.
ALTER TABLE outbound_emails DROP CONSTRAINT outbound_kind;
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_kind CHECK (kind IN (
  'invitation', 'email_change.confirm', 'email_change.notice', 'access_review.due',
  'meeting.invite', 'meeting.cancel', 'password_reset', 'password_reset.notice', 'two_factor.reset',
  'inquiry.new', 'inquiry.received', 'inquiry.declined', 'action.assigned', 'action.revision_requested',
  'action.verified_complete', 'evidence.requested', 'follow_up.digest', 'client.archived'));
--> statement-breakpoint
-- An archived client whose grace period is still running.
CREATE FUNCTION app_in_grace(oid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM client_offboardings f WHERE f.org_id = oid AND f.restored_at IS NULL AND f.grace_until > now())
$$;
--> statement-breakpoint
-- Who the caller is: an active org, or an archived client in its grace period.
CREATE OR REPLACE FUNCTION app_org() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.org_id FROM org_memberships m
  JOIN organizations o ON o.id = m.org_id
  WHERE m.user_id = app_uid() AND m.active AND (o.status = 'active' OR app_in_grace(o.id))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_role() RETURNS role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.role FROM org_memberships m
  JOIN organizations o ON o.id = m.org_id
  WHERE m.user_id = app_uid() AND m.active AND (o.status = 'active' OR app_in_grace(o.id))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_org_kind() RETURNS org_kind
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.kind FROM org_memberships m
  JOIN organizations o ON o.id = m.org_id
  WHERE m.user_id = app_uid() AND m.active AND (o.status = 'active' OR app_in_grace(o.id))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_can_reset_password(uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_memberships m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = uid AND m.active AND (o.status = 'active' OR app_in_grace(o.id))
  )
$$;
--> statement-breakpoint
-- An organization's status changes only through archiving and restoring, and
-- an archived client's record does not change at all.
CREATE FUNCTION check_org_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_uid() IS NULL OR current_setting('selah.org_status', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'a new organization starts active' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'archive or restore a client from its page' USING ERRCODE = 'check_violation';
  ELSIF OLD.status = 'archived' THEN
    RAISE EXCEPTION 'this client is archived; the firm admin can restore it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER organization_status BEFORE INSERT OR UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION check_org_status();
--> statement-breakpoint
-- An archived client is read-only at the client level too (its projects are
-- already closed). Jobs, and the deletes that discard a client, pass.
CREATE FUNCTION check_client_open() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r jsonb;
  oids uuid[];
BEGIN
  IF app_uid() IS NULL OR (TG_OP = 'DELETE' AND current_setting('selah.discard', true) = 'on') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  FOREACH r IN ARRAY CASE TG_OP WHEN 'INSERT' THEN ARRAY[to_jsonb(NEW)] WHEN 'DELETE' THEN ARRAY[to_jsonb(OLD)]
                     ELSE ARRAY[to_jsonb(NEW), to_jsonb(OLD)] END LOOP
    oids := oids || coalesce(r ->> 'client_org_id', r ->> 'org_id')::uuid;
  END LOOP;
  IF EXISTS (SELECT 1 FROM organizations o WHERE o.id = ANY (oids) AND o.status = 'archived') THEN
    RAISE EXCEPTION 'this client is archived; the firm admin can restore it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  -- The client-level tables an archived client freezes (lib/offboarding.ts CLIENT_FROZEN_TABLES).
  FOREACH t IN ARRAY ARRAY['client_contacts', 'client_profiles', 'departments', 'engagements', 'invitations', 'join_requests', 'projects'] LOOP
    EXECUTE format('CREATE TRIGGER client_open BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION check_client_open()', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- What stands between a client and archiving: each project still open
-- (not closed, not a draft). Firm admin only; nobody else gets rows.
CREATE FUNCTION app_archive_blockers(oid uuid)
RETURNS TABLE (project_id uuid, title text, state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.title, p.state::text FROM projects p
  WHERE p.org_id = oid AND p.state::text NOT IN ('closed', 'draft')
    AND app_role() = 'firm_admin' AND app_org_kind() = 'firm' AND app_can_see_org(oid)
  ORDER BY p.title
$$;
--> statement-breakpoint
CREATE FUNCTION app_archive_client(oid uuid, p_grace_days integer, p_note text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  o organizations;
  open_n integer;
  drafts integer;
  fid uuid;
BEGIN
  SELECT * INTO o FROM organizations WHERE id = oid AND kind = 'client';
  IF o.id IS NULL OR NOT app_can_see_org(oid) THEN
    RAISE EXCEPTION 'no such client' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app_role() IS DISTINCT FROM 'firm_admin' OR app_org_kind() IS DISTINCT FROM 'firm' THEN
    RAISE EXCEPTION 'only the firm admin archives a client' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF o.status = 'archived' THEN
    RAISE EXCEPTION 'this client is already archived' USING ERRCODE = 'check_violation';
  END IF;
  IF p_grace_days IS NULL OR p_grace_days NOT BETWEEN 0 AND 90 THEN
    RAISE EXCEPTION 'the grace period is 0 to 90 days' USING ERRCODE = 'check_violation';
  END IF;
  IF length(p_note) > 2000 THEN
    RAISE EXCEPTION 'the note is at most 2000 characters' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM engagements g WHERE g.client_org_id = oid)
     AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.org_id = oid AND p.state::text <> 'draft') THEN
    RAISE EXCEPTION 'this client never signed: delete it instead' USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO open_n FROM projects p WHERE p.org_id = oid AND p.state::text NOT IN ('closed', 'draft');
  IF open_n > 0 THEN
    RAISE EXCEPTION 'close every project first (% open)', open_n USING ERRCODE = 'check_violation';
  END IF;
  -- Unsigned work is deleted; signed work stays, closed.
  UPDATE invitations SET revoked_at = now() WHERE org_id = oid AND accepted_at IS NULL AND revoked_at IS NULL;
  PERFORM set_config('selah.discard', 'on', true);
  DELETE FROM documents WHERE project_id IN (SELECT p.id FROM projects p WHERE p.org_id = oid AND p.state::text = 'draft');
  DELETE FROM projects WHERE org_id = oid AND state::text = 'draft';
  GET DIAGNOSTICS drafts = ROW_COUNT;
  PERFORM set_config('selah.discard', '', true);
  INSERT INTO client_offboardings (org_id, archived_by, grace_until, retain_until, note, drafts_deleted)
    VALUES (oid, app_uid(), now() + make_interval(days => p_grace_days),
            (app_firm_today() + make_interval(years => 10))::date, nullif(trim(p_note), ''), drafts)
    RETURNING id INTO fid;
  PERFORM set_config('selah.org_status', 'on', true);
  UPDATE organizations SET status = 'archived' WHERE id = oid;
  PERFORM set_config('selah.org_status', '', true);
  -- The client's admins hear it in Selah and by mail.
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT m.user_id, 'client.archived', 'organization', oid FROM org_memberships m
    WHERE m.org_id = oid AND m.active AND m.role = 'client_admin';
  IF p_grace_days > 0 THEN
    INSERT INTO outbound_emails (to_email, kind, link)
      SELECT u.email, 'client.archived', '/' FROM org_memberships m JOIN "user" u ON u.id = m.user_id
      WHERE m.org_id = oid AND m.active AND m.role = 'client_admin';
  END IF;
  RETURN fid;
END $$;
--> statement-breakpoint
CREATE FUNCTION app_restore_client(oid uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = oid AND o.kind = 'client') OR NOT app_can_see_org(oid) THEN
    RAISE EXCEPTION 'no such client' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app_role() IS DISTINCT FROM 'firm_admin' OR app_org_kind() IS DISTINCT FROM 'firm' THEN
    RAISE EXCEPTION 'only the firm admin restores a client' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) NOT BETWEEN 5 AND 2000 THEN
    RAISE EXCEPTION 'say why the client is restored (5 to 2000 characters)' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE client_offboardings SET restored_by = app_uid(), restored_at = now(), restore_reason = trim(p_reason)
    WHERE org_id = oid AND restored_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this client is not archived' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('selah.org_status', 'on', true);
  UPDATE organizations SET status = 'active' WHERE id = oid;
  PERFORM set_config('selah.org_status', '', true);
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT m.user_id, 'client.restored', 'organization', oid FROM org_memberships m
    WHERE m.org_id = oid AND m.active AND m.role = 'client_admin';
END $$;
--> statement-breakpoint
CREATE FUNCTION app_place_legal_hold(oid uuid, p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE hid uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = oid AND o.kind = 'client') OR NOT app_can_see_org(oid) THEN
    RAISE EXCEPTION 'no such client' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app_role() IS DISTINCT FROM 'firm_admin' OR app_org_kind() IS DISTINCT FROM 'firm' THEN
    RAISE EXCEPTION 'only the firm admin places a legal hold' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) NOT BETWEEN 5 AND 2000 THEN
    RAISE EXCEPTION 'say why the records are held (5 to 2000 characters)' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO legal_holds (org_id, reason, placed_by) VALUES (oid, trim(p_reason), app_uid()) RETURNING id INTO hid;
  RETURN hid;
END $$;
--> statement-breakpoint
CREATE FUNCTION app_release_legal_hold(hid uuid, p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE oid uuid;
BEGIN
  SELECT h.org_id INTO oid FROM legal_holds h WHERE h.id = hid;
  IF oid IS NULL OR NOT app_can_see_org(oid) OR app_org_kind() IS DISTINCT FROM 'firm' THEN
    RAISE EXCEPTION 'no such hold' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app_role() IS DISTINCT FROM 'firm_admin' THEN
    RAISE EXCEPTION 'only the firm admin releases a legal hold' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) NOT BETWEEN 5 AND 2000 THEN
    RAISE EXCEPTION 'say why the hold ends (5 to 2000 characters)' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE legal_holds SET released_by = app_uid(), released_at = now(), release_reason = trim(p_reason)
    WHERE id = hid AND released_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this hold was already released' USING ERRCODE = 'check_violation';
  END IF;
  RETURN oid;
END $$;
--> statement-breakpoint
-- Holds change only through the functions above; nothing deletes one while
-- its client exists.
CREATE FUNCTION check_legal_hold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF app_uid() IS NOT NULL THEN
      RAISE EXCEPTION 'a legal hold is released, never deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.org_id, NEW.reason, NEW.placed_by, NEW.placed_at) IS DISTINCT FROM (OLD.org_id, OLD.reason, OLD.placed_by, OLD.placed_at)
     OR OLD.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'a legal hold does not change once placed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER legal_hold_rules BEFORE UPDATE OR DELETE ON legal_holds FOR EACH ROW EXECUTE FUNCTION check_legal_hold();
--> statement-breakpoint
-- The daily purge (scripts/purge-clients.ts, as the schema owner): every
-- archived client past its retention date with no hold standing is deleted
-- with a record of what went. Accounts that belonged only to that client
-- are erased like app_erase_user does; files go through storage_deletions.
CREATE FUNCTION app_purge_clients(today date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  f record;
  n integer := 0;
  u uuid;
  k bigint;
  addrs text[];
BEGIN
  FOR f IN
    SELECT b.org_id, b.archived_at, b.retain_until, o.name, o.name_ar
    FROM client_offboardings b JOIN organizations o ON o.id = b.org_id
    WHERE b.restored_at IS NULL AND o.status = 'archived' AND b.retain_until <= today
      AND NOT EXISTS (SELECT 1 FROM legal_holds h WHERE h.org_id = b.org_id AND h.released_at IS NULL)
  LOOP
    INSERT INTO client_deletions (org_id, name, name_ar, archived_at, retain_until, counts)
      VALUES (f.org_id, f.name, f.name_ar, f.archived_at, f.retain_until, jsonb_build_object(
        'projects', (SELECT count(*) FROM projects p WHERE p.org_id = f.org_id),
        'actions', (SELECT count(*) FROM actions a WHERE a.org_id = f.org_id),
        'documents', (SELECT count(*) FROM documents d WHERE d.org_id = f.org_id OR d.owner_org_id = f.org_id),
        'people', (SELECT count(*) FROM org_memberships m WHERE m.org_id = f.org_id),
        'contacts', (SELECT count(*) FROM client_contacts c WHERE c.org_id = f.org_id)));
    -- Erase the people who only ever belonged to this client.
    FOR u IN SELECT m.user_id FROM org_memberships m WHERE m.org_id = f.org_id
               AND NOT EXISTS (SELECT 1 FROM org_memberships x WHERE x.user_id = m.user_id AND x.org_id <> f.org_id) LOOP
      SELECT array_agg(DISTINCT lower(a)) INTO addrs FROM (
        SELECT email FROM "user" WHERE id = u
        UNION ALL SELECT old_email FROM email_changes WHERE user_id = u
        UNION ALL SELECT new_email FROM email_changes WHERE user_id = u AND confirmed_at IS NOT NULL
      ) x(a);
      k := nextval('erased_user_seq');
      UPDATE "user" SET name = 'Former user #' || k, email = 'erased-' || k || '@erased.invalid', image = NULL,
                        email_verified = false, two_factor_enabled = false, updated_at = now() WHERE id = u;
      DELETE FROM session WHERE user_id = u;
      DELETE FROM account WHERE user_id = u;
      DELETE FROM two_factor WHERE user_id = u;
      DELETE FROM email_changes WHERE user_id = u;
      DELETE FROM outbound_emails WHERE lower(to_email) = ANY (addrs);
    END LOOP;
    PERFORM set_config('selah.discard', 'on', true);
    DELETE FROM projects WHERE org_id = f.org_id;
    DELETE FROM documents WHERE org_id = f.org_id OR owner_org_id = f.org_id;
    DELETE FROM engagements WHERE client_org_id = f.org_id;
    UPDATE inquiries SET source_client_org_id = NULL WHERE source_client_org_id = f.org_id;
    DELETE FROM inquiries WHERE client_org_id = f.org_id;
    DELETE FROM client_contacts WHERE org_id = f.org_id;
    DELETE FROM invitations WHERE org_id = f.org_id;
    DELETE FROM access_reviews WHERE org_id = f.org_id;
    DELETE FROM org_memberships WHERE org_id = f.org_id;
    DELETE FROM organizations WHERE id = f.org_id;
    PERFORM set_config('selah.discard', '', true);
    INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
      VALUES (NULL, f.org_id, 'client.purge', 'organization', f.org_id, 'allow', jsonb_build_object('retain_until', f.retain_until));
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
--> statement-breakpoint
ALTER TABLE client_offboardings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE legal_holds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_deletions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON client_offboardings, legal_holds, client_deletions TO selah_app;
--> statement-breakpoint
-- The firm sees a client's offboarding where it sees the client; the client
-- sees its own (when it was archived, until when it can read).
CREATE POLICY offboarding_read ON client_offboardings FOR SELECT TO selah_app USING (app_can_see_org(org_id));
--> statement-breakpoint
-- Holds and deletion records are the firm admin's.
CREATE POLICY legal_hold_read ON legal_holds FOR SELECT TO selah_app
  USING (app_role() = 'firm_admin' AND app_org_kind() = 'firm' AND app_can_see_org(org_id));
--> statement-breakpoint
CREATE POLICY client_deletion_read ON client_deletions FOR SELECT TO selah_app
  USING (app_role() = 'firm_admin' AND app_org_kind() = 'firm');
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_in_grace(uuid), app_archive_blockers(uuid), app_archive_client(uuid, integer, text),
  app_restore_client(uuid, text), app_place_legal_hold(uuid, text), app_release_legal_hold(uuid, text), app_purge_clients(date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_in_grace(uuid), app_archive_blockers(uuid), app_archive_client(uuid, integer, text),
  app_restore_client(uuid, text), app_place_legal_hold(uuid, text), app_release_legal_hold(uuid, text) TO selah_app;
