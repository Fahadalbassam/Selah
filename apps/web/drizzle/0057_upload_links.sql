CREATE TABLE "info_request_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"last_used_at" timestamp with time zone,
	"uploads" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "info_request_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "info_request_files" ADD COLUMN "via_link_id" uuid;--> statement-breakpoint
ALTER TABLE "info_request_links" ADD CONSTRAINT "info_request_links_request_id_info_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."info_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_request_links" ADD CONSTRAINT "info_request_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_request_links" ADD CONSTRAINT "info_request_links_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_request_links" ADD CONSTRAINT "info_request_links_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "info_request_links_request_idx" ON "info_request_links" USING btree ("request_id");--> statement-breakpoint
ALTER TABLE "info_request_files" ADD CONSTRAINT "info_request_files_via_link_id_info_request_links_id_fk" FOREIGN KEY ("via_link_id") REFERENCES "public"."info_request_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-written (wave 2, F14 part 2): a no-login upload link for one
-- information request item (decision D6). A consultant on the project sends
-- it to an address; the page it opens shows only that item and the firm's
-- name and takes files for it, scanned like any upload. Only the token's
-- hash is kept. A link stops working when it expires or is revoked, when its
-- item is reviewed or marked not applicable, or when the project closes or
-- the client is archived. Every open and every upload is in the audit log.
ALTER TABLE info_request_links ADD CONSTRAINT info_request_link_token_is_hash CHECK (token_hash ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
ALTER TABLE info_request_links ADD CONSTRAINT info_request_link_uploads CHECK (uploads BETWEEN 0 AND 10);
--> statement-breakpoint
ALTER TABLE info_request_links ADD CONSTRAINT info_request_link_revoked CHECK ((revoked_at IS NULL) = (revoked_by IS NULL));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON info_request_links TO selah_app;
--> statement-breakpoint
ALTER TABLE info_request_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Firm-side only: the client never sees the links or the addresses typed.
CREATE POLICY firm_read ON info_request_links FOR SELECT TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id));
--> statement-breakpoint
CREATE POLICY firm_create ON info_request_links FOR INSERT TO selah_app
  WITH CHECK (app_org_kind() = 'firm' AND app_can_see_project(project_id) AND created_by = app_uid());
--> statement-breakpoint
CREATE POLICY firm_revoke ON info_request_links FOR UPDATE TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id))
  WITH CHECK (app_org_kind() = 'firm' AND app_can_see_project(project_id));
--> statement-breakpoint
-- A new link: for a waiting or received item of an open client project
-- whose client keeps files, to a real address, for one hour to 30 days.
-- People only revoke a link; its use is counted by app_upload_by_link().
CREATE FUNCTION check_info_request_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r info_requests%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF app_uid() IS NOT NULL AND ((to_jsonb(NEW) - 'revoked_at' - 'revoked_by') <> (to_jsonb(OLD) - 'revoked_at' - 'revoked_by')
       OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL) THEN
      RAISE EXCEPTION 'an upload link can only be revoked' USING ERRCODE = 'check_violation';
    END IF;
    IF app_uid() IS NOT NULL THEN
      NEW.revoked_at := now();
      NEW.revoked_by := app_uid();
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO r FROM info_requests WHERE id = NEW.request_id;
  IF r.id IS NULL OR r.project_id <> NEW.project_id OR r.org_id <> NEW.org_id THEN
    RAISE EXCEPTION 'the link is for an item of this project' USING ERRCODE = 'check_violation';
  END IF;
  IF r.status NOT IN ('requested', 'received') THEN
    RAISE EXCEPTION 'this request is not open for files' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM projects p JOIN organizations o ON o.id = p.org_id
                 WHERE p.id = NEW.project_id AND p.kind = 'client' AND p.state <> 'closed' AND o.status = 'active' AND NOT o.minimal_records) THEN
    RAISE EXCEPTION 'upload links are for open client projects whose client keeps files' USING ERRCODE = 'check_violation';
  END IF;
  NEW.email := lower(btrim(NEW.email));
  IF NEW.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(NEW.email) > 254 THEN
    RAISE EXCEPTION 'not an email address' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.expires_at < now() + interval '1 hour' OR NEW.expires_at > now() + interval '30 days' THEN
    RAISE EXCEPTION 'an upload link works for one hour to 30 days' USING ERRCODE = 'check_violation';
  END IF;
  NEW.created_at := now();
  NEW.revoked_at := NULL;
  NEW.revoked_by := NULL;
  NEW.last_used_at := NULL;
  NEW.uploads := 0;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER info_request_link_rules BEFORE INSERT OR UPDATE ON info_request_links FOR EACH ROW EXECUTE FUNCTION check_info_request_link();
--> statement-breakpoint
-- Whether a link still works, and why not. Shared by the functions below.
CREATE FUNCTION app_upload_link_refusal(l info_request_links) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN l.revoked_at IS NOT NULL THEN 'revoked'
    WHEN l.expires_at <= now() THEN 'expired'
    WHEN r.status NOT IN ('requested', 'received') THEN 'item closed'
    WHEN p.state = 'closed' THEN 'project closed'
    WHEN o.status <> 'active' OR o.minimal_records THEN 'client archived'
  END
  FROM info_requests r JOIN projects p ON p.id = r.project_id JOIN organizations o ON o.id = p.org_id
  WHERE r.id = l.request_id
$$;
--> statement-breakpoint
-- Queue the link's mail. The caller passes the raw token; it must hash to
-- the stored one, so the mail can only carry the link just made.
CREATE FUNCTION app_send_upload_link(link uuid, token text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE l info_request_links%ROWTYPE;
BEGIN
  SELECT * INTO l FROM info_request_links WHERE id = link;
  IF NOT FOUND OR app_org_kind() IS DISTINCT FROM 'firm' OR NOT app_can_see_project(l.project_id) OR l.created_by <> app_uid()
     OR app_upload_link_refusal(l) IS NOT NULL OR l.token_hash <> encode(sha256(convert_to(token, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO outbound_emails (to_email, kind, link) VALUES (l.email, 'info_request.upload_link', '/upload/' || token);
END $$;
--> statement-breakpoint
-- The public page: the item and the firm's name while the link works, and
-- nothing otherwise. Every open is logged, working or not. Public.
CREATE FUNCTION app_open_upload_link(token_hash text)
RETURNS TABLE (link_id uuid, request_id uuid, title text, template_key text, description text, sensitivity info_request_sensitivity,
               firm_name text, firm_name_ar text, expires_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE l info_request_links%ROWTYPE; refusal text;
BEGIN
  SELECT * INTO l FROM info_request_links i WHERE i.token_hash = app_open_upload_link.token_hash;
  IF NOT FOUND THEN RETURN; END IF;
  refusal := app_upload_link_refusal(l);
  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, reason, meta)
    VALUES (NULL, l.org_id, 'info_request.link_opened', 'info_request_link', l.id, CASE WHEN refusal IS NULL THEN 'allow' ELSE 'deny' END::audit_outcome,
            refusal, jsonb_build_object('request_id', l.request_id));
  IF refusal IS NOT NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT l.id, r.id, r.title, r.template_key, r.description, r.sensitivity, f.name, f.name_ar, l.expires_at
    FROM info_requests r JOIN projects p ON p.id = r.project_id JOIN organizations f ON f.id = p.firm_org_id
    WHERE r.id = l.request_id;
END $$;
--> statement-breakpoint
-- Before a file is scanned: which link it is for, if the link still works.
-- A refused attempt on a known link is logged here, since no upload follows. Public.
CREATE FUNCTION app_upload_link_target(token_hash text) RETURNS TABLE (link_id uuid, request_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE l info_request_links%ROWTYPE; refusal text;
BEGIN
  SELECT * INTO l FROM info_request_links i WHERE i.token_hash = app_upload_link_target.token_hash;
  IF NOT FOUND THEN RETURN; END IF;
  refusal := coalesce(app_upload_link_refusal(l), CASE WHEN l.uploads >= 10 THEN 'too many files' END);
  IF refusal IS NOT NULL THEN
    INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, reason, meta)
      VALUES (NULL, l.org_id, 'info_request.link_upload', 'info_request_link', l.id, 'deny', refusal, jsonb_build_object('request_id', l.request_id));
    RETURN;
  END IF;
  link_id := l.id;
  request_id := l.request_id;
  RETURN NEXT;
END $$;
--> statement-breakpoint
-- A file sent through a link, already checked and scanned by the app:
-- stored as a document of the client, shared with both sides, answering
-- the link's item, marked as come by link. At most ten per link. The
-- firm-side team is told, and the upload logged. A refusal is returned (and
-- logged), not raised, so the log entry stays. Public; the token is the
-- proof. The app stores the bytes under storage_key in the same request.
CREATE FUNCTION app_upload_by_link(token_hash text, file_name text, content_type text, size_bytes integer, sha256 text,
                                   scanned boolean, storage_key text) RETURNS TABLE (document_id uuid, refusal text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE l info_request_links%ROWTYPE; doc uuid;
BEGIN
  SELECT * INTO l FROM info_request_links i WHERE i.token_hash = app_upload_by_link.token_hash FOR UPDATE;
  IF NOT FOUND THEN
    refusal := 'unknown link';
    RETURN NEXT;
    RETURN;
  END IF;
  refusal := coalesce(app_upload_link_refusal(l), CASE WHEN l.uploads >= 10 THEN 'too many files' END);
  IF refusal IS NOT NULL THEN
    INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, reason, meta)
      VALUES (NULL, l.org_id, 'info_request.link_upload', 'info_request_link', l.id, 'deny', refusal, jsonb_build_object('request_id', l.request_id));
    RETURN NEXT;
    RETURN;
  END IF;
  INSERT INTO documents (project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, storage_key,
                         content_type, size_bytes, sha256, scan_status, scanned_at)
    VALUES (l.project_id, l.org_id, l.org_id, l.created_by, 'client_document', 'submitted', file_name, 'shared', storage_key,
            content_type, size_bytes, sha256, CASE WHEN scanned THEN 'clean' ELSE 'skipped' END::scan_status, CASE WHEN scanned THEN now() END)
    RETURNING id INTO doc;
  INSERT INTO info_request_files (request_id, document_id, attached_by, via_link_id) VALUES (l.request_id, doc, l.created_by, l.id);
  UPDATE info_request_links SET last_used_at = now(), uploads = uploads + 1 WHERE id = l.id;
  INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, meta)
    VALUES (l.project_id, l.org_id, l.created_by, 'info_request', l.request_id, 'info_request_link_upload', jsonb_build_object('documentId', doc));
  -- The firm-side team, as app_project_audience() names it (that function
  -- also checks the caller sees the project, and the public sees none).
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT DISTINCT u, 'info_request.received', 'project', l.project_id FROM (
      SELECT ca.user_id AS u FROM projects p
        JOIN client_assignments ca ON ca.client_org_id = p.org_id AND ca.is_lead
        JOIN org_memberships m ON m.user_id = ca.user_id AND m.org_id = p.firm_org_id AND m.active AND m.role = 'consultant'
        WHERE p.id = l.project_id
      UNION
      SELECT pm.user_id FROM projects p JOIN project_members pm ON pm.project_id = p.id AND NOT pm.observer
        JOIN org_memberships m ON m.user_id = pm.user_id AND m.org_id = p.firm_org_id AND m.active
        WHERE p.id = l.project_id
      UNION
      SELECT w.user_id FROM projects p
        JOIN watches w ON w.project_id = p.id OR w.client_org_id = p.org_id
        JOIN org_memberships m ON m.user_id = w.user_id AND m.org_id = p.firm_org_id AND m.active AND m.role = 'firm_admin'
        WHERE p.id = l.project_id
    ) team;
  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
    VALUES (NULL, l.org_id, 'info_request.link_upload', 'document', doc, 'allow',
            jsonb_build_object('link_id', l.id, 'request_id', l.request_id, 'size_bytes', size_bytes, 'scanned', scanned));
  document_id := doc;
  RETURN NEXT;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_upload_link_refusal(info_request_links), app_send_upload_link(uuid, text), app_open_upload_link(text),
  app_upload_link_target(text), app_upload_by_link(text, text, text, integer, text, boolean, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_upload_link_refusal(info_request_links), app_send_upload_link(uuid, text), app_open_upload_link(text),
  app_upload_link_target(text), app_upload_by_link(text, text, text, integer, text, boolean, text) TO selah_app;
--> statement-breakpoint
-- Only app_upload_by_link() files an answer as come by link, and only for
-- its own link's item; people attach files as themselves.
CREATE FUNCTION check_info_request_file_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_uid() IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM info_request_links l WHERE l.id = NEW.via_link_id AND l.request_id = NEW.request_id AND l.created_by = NEW.attached_by
  ) THEN
    RAISE EXCEPTION 'only an upload link files an answer this way' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER info_request_file_link BEFORE INSERT ON info_request_files
  FOR EACH ROW WHEN (NEW.via_link_id IS NOT NULL) EXECUTE FUNCTION check_info_request_file_link();
--> statement-breakpoint
ALTER TABLE outbound_emails DROP CONSTRAINT outbound_kind;
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_kind CHECK (kind IN (
  'invitation', 'email_change.confirm', 'email_change.notice', 'access_review.due',
  'meeting.invite', 'meeting.cancel', 'password_reset', 'password_reset.notice', 'two_factor.reset',
  'inquiry.new', 'inquiry.received', 'inquiry.declined', 'action.assigned', 'action.revision_requested',
  'action.verified_complete', 'evidence.requested', 'action.commented', 'action.mentioned', 'follow_up.digest', 'client.archived',
  'pulse.requested', 'sign_in_link', 'info_request.upload_link'));
