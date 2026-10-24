ALTER TABLE "documents" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "withdrawn_by" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "withdrawn_reason" text;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_withdrawn_by_user_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "document_withdrawn" CHECK (("documents"."withdrawn_at" IS NULL AND "documents"."withdrawn_by" IS NULL AND "documents"."withdrawn_reason" IS NULL)
        OR ("documents"."withdrawn_at" IS NOT NULL AND "documents"."withdrawn_by" IS NOT NULL AND char_length(btrim("documents"."withdrawn_reason")) BETWEEN 3 AND 500 AND "documents"."state" = 'archived'));--> statement-breakpoint
-- A wrong upload (journey map N8). The person who uploaded a file may take it
-- back while nobody has relied on it yet: it is archived with a reason, kept
-- for the record, leaves the assistant and every list, and stops answering
-- any information request (the item asks again). Evidence is not withdrawn:
-- the reviewer returns it, and the next submission is the next round. Only a
-- first version is withdrawn; a wrong later version is replaced by the next.
--
-- "Relied on" (settled): it answers a reviewed information request, is cited
-- by a final assessment, or backs a KPI reading.
CREATE FUNCTION app_document_settled(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
      SELECT 1 FROM info_request_files f JOIN info_requests r ON r.id = f.request_id
      WHERE f.document_id = doc AND r.status = 'reviewed')
    OR EXISTS (
      SELECT 1 FROM assessment_evidence e JOIN assessment_answers a ON a.id = e.answer_id JOIN assessments s ON s.id = a.assessment_id
      WHERE e.document_id = doc AND s.status <> 'draft')
    OR EXISTS (SELECT 1 FROM kpi_readings k WHERE k.evidence_document_id = doc)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_document_settled(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_document_settled(uuid) TO selah_app;
--> statement-breakpoint
CREATE FUNCTION app_withdraw_document(doc uuid, reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d documents%ROWTYPE;
BEGIN
  SELECT * INTO d FROM documents WHERE id = doc;
  IF d.id IS NULL OR NOT app_can_see_project(d.project_id) OR d.uploaded_by IS DISTINCT FROM app_uid() THEN
    RAISE EXCEPTION 'only the person who uploaded a file withdraws it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF d.purpose = 'evidence' THEN
    RAISE EXCEPTION 'evidence is returned by the reviewer, not withdrawn' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT p.state FROM projects p WHERE p.id = d.project_id) = 'closed' THEN
    RAISE EXCEPTION 'a closed project''s files stay as they are' USING ERRCODE = 'check_violation';
  END IF;
  IF d.state = 'archived' THEN
    RAISE EXCEPTION 'this file is already archived' USING ERRCODE = 'check_violation';
  END IF;
  IF d.supersedes_id IS NOT NULL OR EXISTS (SELECT 1 FROM documents n WHERE n.supersedes_id = doc) THEN
    RAISE EXCEPTION 'a file with versions is replaced by a new version, not withdrawn' USING ERRCODE = 'check_violation';
  END IF;
  IF app_document_settled(doc) THEN
    RAISE EXCEPTION 'this file was already relied on and stays on record' USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(btrim(coalesce(reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'say why the file is withdrawn' USING ERRCODE = 'check_violation';
  END IF;
  -- Items it answered ask again once their last file goes.
  DELETE FROM info_request_files WHERE document_id = doc;
  -- A draft assessment stops citing it.
  DELETE FROM assessment_evidence WHERE document_id = doc;
  PERFORM set_config('selah.withdraw', doc::text, true);
  UPDATE documents SET state = 'archived', ai_indexable = false,
    withdrawn_at = now(), withdrawn_by = app_uid(), withdrawn_reason = btrim(reason)
  WHERE id = doc;
  PERFORM set_config('selah.withdraw', '', true);
  INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, meta)
    VALUES (d.project_id, d.org_id, app_uid(), 'document', doc, 'document_withdrawn',
            jsonb_build_object('title', d.title, 'reason', btrim(reason)));
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_withdraw_document(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_withdraw_document(uuid, text) TO selah_app;
--> statement-breakpoint
-- The withdrawal columns are written only by app_withdraw_document(), and a
-- withdrawn file stays withdrawn (the check keeps it archived).
CREATE FUNCTION check_document_withdrawal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.withdrawn_at IS NOT NULL OR NEW.withdrawn_by IS NOT NULL OR NEW.withdrawn_reason IS NOT NULL THEN
      RAISE EXCEPTION 'a new file is not withdrawn' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.withdrawn_at, NEW.withdrawn_by, NEW.withdrawn_reason) IS DISTINCT FROM (OLD.withdrawn_at, OLD.withdrawn_by, OLD.withdrawn_reason)
     AND (OLD.withdrawn_at IS NOT NULL OR current_setting('selah.withdraw', true) IS DISTINCT FROM NEW.id::text) THEN
    RAISE EXCEPTION 'a file is withdrawn only by the person who uploaded it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_withdrawal BEFORE INSERT OR UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION check_document_withdrawal();
