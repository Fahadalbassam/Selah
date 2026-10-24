CREATE TABLE "client_export_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"made_by" uuid,
	"made_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locale" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"file_count" integer NOT NULL,
	"receipt_by" uuid,
	"receipt_at" timestamp with time zone,
	"received_by_name" text,
	"receipt_note" text,
	CONSTRAINT "export_pack_sha256" CHECK (sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "export_pack_locale" CHECK (locale IN ('ar', 'en'))
);
--> statement-breakpoint
ALTER TABLE "client_export_packs" ADD CONSTRAINT "client_export_packs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_export_packs" ADD CONSTRAINT "client_export_packs_made_by_user_id_fk" FOREIGN KEY ("made_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_export_packs" ADD CONSTRAINT "client_export_packs_receipt_by_user_id_fk" FOREIGN KEY ("receipt_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_export_packs_org_idx" ON "client_export_packs" USING btree ("org_id");
--> statement-breakpoint
-- ------------------------------------------------------------ export pack
-- What a leaving client takes with it (full picture item 27, journey J14.2
-- and J14.4): a ZIP of what the client may see, made by the firm admin or
-- by the client's own admin while the client is archived. Selah keeps it
-- with its SHA-256. The client's admin confirms receiving it; for a client
-- the firm manages (no accounts) the firm admin records the handover and
-- who received it. A receipt is given once and never changes.

-- Who may make and fetch a client's export pack: the firm admin, or the
-- client's own admin during its grace period. Only an archived client.
CREATE FUNCTION app_can_export_pack(oid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM organizations o WHERE o.id = oid AND o.kind = 'client' AND o.status = 'archived')
    AND ((app_role() = 'firm_admin' AND app_org_kind() = 'firm' AND app_can_see_org(oid))
         OR (app_role() = 'client_admin' AND app_org() = oid))
$$;
--> statement-breakpoint
CREATE FUNCTION app_record_export_pack(oid uuid, p_key text, p_sha256 text, p_size integer, p_files integer, p_locale text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pid uuid;
BEGIN
  IF NOT app_can_export_pack(oid) THEN
    RAISE EXCEPTION 'only the firm admin or the client''s admin makes an export pack, once the client is archived' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_key !~ '^exports/[0-9a-f-]{36}\.zip$' OR p_size < 0 OR p_files < 0 THEN
    RAISE EXCEPTION 'not an export pack' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO client_export_packs (org_id, made_by, locale, storage_key, sha256, size_bytes, file_count)
    VALUES (oid, app_uid(), p_locale, p_key, p_sha256, p_size, p_files) RETURNING id INTO pid;
  RETURN pid;
END $$;
--> statement-breakpoint
-- The client's admin confirms receiving a pack; the firm admins hear it.
CREATE FUNCTION app_confirm_export_receipt(pid uuid, p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k client_export_packs;
BEGIN
  SELECT * INTO k FROM client_export_packs WHERE id = pid;
  IF k.id IS NULL OR app_role() IS DISTINCT FROM 'client_admin' OR app_org() IS DISTINCT FROM k.org_id THEN
    RAISE EXCEPTION 'only the client''s admin confirms receiving its export pack' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF k.receipt_at IS NOT NULL THEN
    RAISE EXCEPTION 'this pack''s receipt was already given' USING ERRCODE = 'check_violation';
  END IF;
  IF length(p_note) > 2000 THEN
    RAISE EXCEPTION 'the note is at most 2000 characters' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE client_export_packs SET receipt_by = app_uid(), receipt_at = now(), receipt_note = nullif(trim(p_note), '') WHERE id = pid;
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT m.user_id, 'client.pack_received', 'organization', k.org_id FROM org_memberships m JOIN organizations f ON f.id = m.org_id
    WHERE f.kind = 'firm' AND m.active AND m.role = 'firm_admin';
END $$;
--> statement-breakpoint
-- The firm admin records a handover made outside Selah, naming who received it.
CREATE FUNCTION app_record_export_handover(pid uuid, p_name text, p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k client_export_packs;
BEGIN
  SELECT * INTO k FROM client_export_packs WHERE id = pid;
  IF k.id IS NULL OR app_role() IS DISTINCT FROM 'firm_admin' OR app_org_kind() IS DISTINCT FROM 'firm' OR NOT app_can_see_org(k.org_id) THEN
    RAISE EXCEPTION 'only the firm admin records a handover' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF k.receipt_at IS NOT NULL THEN
    RAISE EXCEPTION 'this pack''s receipt was already given' USING ERRCODE = 'check_violation';
  END IF;
  IF length(trim(coalesce(p_name, ''))) NOT BETWEEN 2 AND 200 OR length(p_note) > 2000 THEN
    RAISE EXCEPTION 'name who received the pack (2 to 200 characters)' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE client_export_packs SET receipt_by = app_uid(), receipt_at = now(), received_by_name = trim(p_name), receipt_note = nullif(trim(p_note), '')
    WHERE id = pid;
END $$;
--> statement-breakpoint
-- A pack changes only by its receipt, once; it is deleted only with its client.
CREATE FUNCTION check_export_pack() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF app_uid() IS NOT NULL THEN
      RAISE EXCEPTION 'an export pack is kept until its client is deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.org_id, NEW.made_by, NEW.made_at, NEW.locale, NEW.storage_key, NEW.sha256, NEW.size_bytes, NEW.file_count)
       IS DISTINCT FROM (OLD.org_id, OLD.made_by, OLD.made_at, OLD.locale, OLD.storage_key, OLD.sha256, OLD.size_bytes, OLD.file_count)
     OR OLD.receipt_at IS NOT NULL THEN
    RAISE EXCEPTION 'an export pack does not change once made' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER export_pack_rules BEFORE UPDATE OR DELETE ON client_export_packs FOR EACH ROW EXECUTE FUNCTION check_export_pack();
--> statement-breakpoint
CREATE TRIGGER storage_deletion AFTER DELETE ON client_export_packs FOR EACH ROW EXECUTE FUNCTION queue_storage_deletion();
--> statement-breakpoint
ALTER TABLE client_export_packs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON client_export_packs TO selah_app;
--> statement-breakpoint
CREATE POLICY export_pack_read ON client_export_packs FOR SELECT TO selah_app USING (
  (app_role() = 'firm_admin' AND app_org_kind() = 'firm' AND app_can_see_org(org_id))
  OR (app_role() = 'client_admin' AND org_id = app_org())
);
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_export_pack(uuid), app_record_export_pack(uuid, text, text, integer, integer, text),
  app_confirm_export_receipt(uuid, text), app_record_export_handover(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_export_pack(uuid), app_record_export_pack(uuid, text, text, integer, integer, text),
  app_confirm_export_receipt(uuid, text), app_record_export_handover(uuid, text, text) TO selah_app;
