CREATE TYPE "public"."info_request_area" AS ENUM('legal', 'governance', 'strategy', 'finance', 'people', 'family', 'operations', 'other');--> statement-breakpoint
CREATE TYPE "public"."info_request_sensitivity" AS ENUM('standard', 'confidential');--> statement-breakpoint
CREATE TYPE "public"."info_request_status" AS ENUM('requested', 'received', 'reviewed', 'not_applicable');--> statement-breakpoint
CREATE TABLE "info_request_files" (
	"request_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"attached_by" uuid NOT NULL,
	"attached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "info_request_files_request_id_document_id_pk" PRIMARY KEY("request_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "info_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"area" "info_request_area" NOT NULL,
	"template_key" text,
	"title" text NOT NULL,
	"description" text,
	"sensitivity" "info_request_sensitivity" DEFAULT 'standard' NOT NULL,
	"owner_user_id" uuid,
	"due_date" date,
	"status" "info_request_status" DEFAULT 'requested' NOT NULL,
	"status_note" text,
	"status_by" uuid,
	"status_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "info_request_title" CHECK (length(btrim("info_requests"."title")) BETWEEN 2 AND 200),
	CONSTRAINT "info_request_description" CHECK (length("info_requests"."description") <= 2000),
	CONSTRAINT "info_request_note" CHECK (length("info_requests"."status_note") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "info_request_files" ADD CONSTRAINT "info_request_files_request_id_info_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."info_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_request_files" ADD CONSTRAINT "info_request_files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_request_files" ADD CONSTRAINT "info_request_files_attached_by_user_id_fk" FOREIGN KEY ("attached_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_requests" ADD CONSTRAINT "info_requests_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_requests" ADD CONSTRAINT "info_requests_status_by_user_id_fk" FOREIGN KEY ("status_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_requests" ADD CONSTRAINT "info_requests_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_requests" ADD CONSTRAINT "info_requests_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "info_request_files_document_idx" ON "info_request_files" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "info_requests_project_idx" ON "info_requests" USING btree ("project_id","status");--> statement-breakpoint
-- Hand-written (wave 1, item 9): the information request list per project.
-- The firm writes the list; the client sees what is asked of it (an action
-- owner only their own items), answers with files, or says an item does not
-- apply. Files answer an item as long as both sides can see them; a file on
-- a confidential item stays out of the assistant.
GRANT SELECT, INSERT, UPDATE, DELETE ON info_requests TO selah_app;
--> statement-breakpoint
ALTER TABLE info_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY scoped_read ON info_requests FOR SELECT TO selah_app
  USING (app_can_see_project(project_id) AND (app_role() IS DISTINCT FROM 'action_owner' OR owner_user_id = app_uid()));
--> statement-breakpoint
CREATE POLICY firm_insert ON info_requests FOR INSERT TO selah_app
  WITH CHECK (app_org_kind() = 'firm' AND app_can_see_project(project_id) AND created_by = app_uid());
--> statement-breakpoint
CREATE POLICY scoped_update ON info_requests FOR UPDATE TO selah_app
  USING (app_can_see_project(project_id) AND (app_role() IS DISTINCT FROM 'action_owner' OR owner_user_id = app_uid()))
  WITH CHECK (app_can_see_project(project_id) AND (app_role() IS DISTINCT FROM 'action_owner' OR owner_user_id = app_uid()));
--> statement-breakpoint
-- An item someone already answered stays; mark it not applicable instead.
CREATE POLICY firm_delete ON info_requests FOR DELETE TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id) AND status = 'requested'
         AND NOT EXISTS (SELECT 1 FROM info_request_files f WHERE f.request_id = id));
--> statement-breakpoint
CREATE FUNCTION check_info_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  firm boolean := app_org_kind() = 'firm';
  -- A file attached or removed moves the status (info_request_files below).
  sys boolean := pg_trigger_depth() > 1;
  fixed text[] := ARRAY['status', 'status_note', 'status_by', 'status_at', 'updated_at'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.kind = 'client' AND p.state <> 'closed') THEN
      RAISE EXCEPTION 'information requests are for open client projects' USING ERRCODE = 'check_violation';
    END IF;
    NEW.status := 'requested';
    NEW.status_note := NULL;
    NEW.status_by := NULL;
    NEW.status_at := NULL;
  ELSE
    IF (NEW.project_id, NEW.org_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.project_id, OLD.org_id, OLD.created_by, OLD.created_at) THEN
      RAISE EXCEPTION 'that change to a request is not allowed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT firm AND NOT sys AND (to_jsonb(NEW) - fixed) <> (to_jsonb(OLD) - fixed) THEN
      RAISE EXCEPTION 'only the firm edits a request' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status <> OLD.status THEN
      IF NOT (
        (sys AND (OLD.status, NEW.status) IN (('requested', 'received'), ('received', 'requested')))
        OR (NOT sys AND firm AND (OLD.status, NEW.status) IN (
              ('received', 'reviewed'), ('received', 'requested'), ('reviewed', 'requested'),
              ('requested', 'not_applicable'), ('received', 'not_applicable'), ('not_applicable', 'requested')))
        OR (NOT sys AND NOT firm AND (OLD.status, NEW.status) = ('requested', 'not_applicable'))
      ) THEN
        RAISE EXCEPTION 'invalid request status change % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
      END IF;
      IF sys OR NEW.status IN ('received', 'reviewed') THEN
        NEW.status_note := NULL;
      ELSIF coalesce(btrim(NEW.status_note), '') = '' THEN
        RAISE EXCEPTION 'say why the request goes back or does not apply' USING ERRCODE = 'check_violation';
      END IF;
      NEW.status_by := app_uid();
      NEW.status_at := now();
    ELSIF NEW.status_note IS DISTINCT FROM OLD.status_note THEN
      RAISE EXCEPTION 'the note goes with a change of status' USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
  END IF;
  -- The owner is someone at the client who can see the project.
  IF NEW.owner_user_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id) AND NOT EXISTS (
    SELECT 1 FROM org_memberships m WHERE m.user_id = NEW.owner_user_id AND m.org_id = NEW.org_id AND m.active
      AND (m.role = 'client_admin' OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = NEW.project_id AND pm.user_id = NEW.owner_user_id))
  ) THEN
    RAISE EXCEPTION 'the owner is someone at the client on this project' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.sensitivity = 'confidential' AND TG_OP = 'UPDATE' AND OLD.sensitivity <> 'confidential' AND EXISTS (
    SELECT 1 FROM info_request_files f JOIN documents d ON d.id = f.document_id WHERE f.request_id = NEW.id AND d.ai_indexable
  ) THEN
    RAISE EXCEPTION 'turn the assistant off for its files first' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER info_request_rules BEFORE INSERT OR UPDATE ON info_requests FOR EACH ROW EXECUTE FUNCTION check_info_request();
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON info_request_files TO selah_app;
--> statement-breakpoint
ALTER TABLE info_request_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Read through the request and the file, under the reader's own rights.
CREATE POLICY scoped_read ON info_request_files FOR SELECT TO selah_app
  USING (EXISTS (SELECT 1 FROM info_requests r WHERE r.id = request_id) AND EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id));
--> statement-breakpoint
CREATE POLICY answer ON info_request_files FOR INSERT TO selah_app
  WITH CHECK (attached_by = app_uid()
    AND EXISTS (SELECT 1 FROM info_requests r WHERE r.id = request_id)
    AND EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id));
--> statement-breakpoint
-- Whoever attached a file takes it off, or the firm; never from a reviewed item.
CREATE POLICY take_off ON info_request_files FOR DELETE TO selah_app
  USING ((attached_by = app_uid() OR app_org_kind() = 'firm')
    AND EXISTS (SELECT 1 FROM info_requests r WHERE r.id = request_id AND r.status <> 'reviewed'));
--> statement-breakpoint
CREATE FUNCTION check_info_request_file() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r info_requests%ROWTYPE;
  d documents%ROWTYPE;
BEGIN
  SELECT * INTO r FROM info_requests WHERE id = NEW.request_id;
  SELECT * INTO d FROM documents WHERE id = NEW.document_id;
  IF r.status NOT IN ('requested', 'received') THEN
    RAISE EXCEPTION 'this request is not open for files' USING ERRCODE = 'check_violation';
  END IF;
  IF d.project_id <> r.project_id OR d.org_id <> r.org_id OR d.state = 'archived' OR d.visibility <> 'shared' THEN
    RAISE EXCEPTION 'answer with a file of this project that both sides can see' USING ERRCODE = 'check_violation';
  END IF;
  IF r.sensitivity = 'confidential' AND d.ai_indexable THEN
    RAISE EXCEPTION 'turn the assistant off for this file first: the request is confidential' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER info_request_file_rules BEFORE INSERT ON info_request_files FOR EACH ROW EXECUTE FUNCTION check_info_request_file();
--> statement-breakpoint
-- A first file marks the item received; taking off the last one asks again.
CREATE FUNCTION info_request_files_moved() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE info_requests SET status = 'received' WHERE id = NEW.request_id AND status = 'requested';
  ELSE
    UPDATE info_requests SET status = 'requested' WHERE id = OLD.request_id AND status = 'received'
      AND NOT EXISTS (SELECT 1 FROM info_request_files f WHERE f.request_id = OLD.request_id);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER info_request_files_moved AFTER INSERT OR DELETE ON info_request_files FOR EACH ROW EXECUTE FUNCTION info_request_files_moved();
--> statement-breakpoint
-- A file answering a confidential item stays out of the assistant.
CREATE FUNCTION check_confidential_file() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.ai_indexable AND NOT OLD.ai_indexable AND EXISTS (
    SELECT 1 FROM info_request_files f JOIN info_requests r ON r.id = f.request_id
    WHERE f.document_id = NEW.id AND r.sensitivity = 'confidential'
  ) THEN
    RAISE EXCEPTION 'a file answering a confidential request stays out of the assistant' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER confidential_file BEFORE UPDATE OF ai_indexable ON documents FOR EACH ROW EXECUTE FUNCTION check_confidential_file();
--> statement-breakpoint
-- A client answering an item tells the firm-side team, whose memberships the
-- client cannot read. Like app_notify_project_team, the function checks that
-- the caller really caused the note: a file they attached, or an item they
-- marked not applicable.
CREATE FUNCTION app_notify_info_request(req uuid, note_kind text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pid uuid; n integer;
BEGIN
  SELECT r.project_id INTO pid FROM info_requests r WHERE r.id = req;
  IF pid IS NULL OR NOT app_can_see_project(pid) THEN
    RAISE EXCEPTION 'request not visible' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (
    (note_kind = 'info_request.received' AND EXISTS (
      SELECT 1 FROM info_request_files f WHERE f.request_id = req AND f.attached_by = app_uid()))
    OR (note_kind = 'info_request.not_applicable' AND EXISTS (
      SELECT 1 FROM info_requests r WHERE r.id = req AND r.status = 'not_applicable' AND r.status_by = app_uid()))
  ) THEN
    RAISE EXCEPTION 'notification does not match the request' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT u, note_kind, 'project', pid FROM app_project_audience(pid) u WHERE u <> app_uid();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_notify_info_request(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_notify_info_request(uuid, text) TO selah_app;
