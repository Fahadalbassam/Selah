CREATE UNIQUE INDEX "documents_supersede_once" ON "documents" USING btree ("supersedes_id");--> statement-breakpoint
-- File controls (wave 1, item 3 of the full picture, 2026-10-24): share a
-- firm-only file with the client, switch the assistant flag, upload a new
-- version. The columns existed; nothing in the app could change them, and
-- row-level security let anyone on the project write them.
--
-- 1. Only the side that owns a file changes its label and its assistant
--    flag (a client's admin sharing its private file is the owner too).
--    Sharing is one-way on client projects: a file the client has seen is
--    never made firm-only again, as a file the firm has seen is never made
--    client-private again (check_document_label). A firm file shared with the
--    client is recorded in the project's history, which both sides see.
CREATE FUNCTION check_document_manage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Jobs and migrations (no user) are trusted.
  IF app_uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF (NEW.ai_indexable IS DISTINCT FROM OLD.ai_indexable OR NEW.visibility IS DISTINCT FROM OLD.visibility)
     AND app_org() IS DISTINCT FROM NEW.owner_org_id THEN
    RAISE EXCEPTION 'only the side that owns a file changes its label or assistant flag' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.visibility IS DISTINCT FROM OLD.visibility AND OLD.visibility = 'shared' AND app_project_kind(NEW.project_id) = 'client' THEN
    RAISE EXCEPTION 'a file shared with the client stays shared; upload a new version instead' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.visibility = 'firm_private' AND NEW.visibility = 'shared' THEN
    IF NEW.purpose = 'evidence' THEN
      RAISE EXCEPTION 'evidence is shared by submitting it' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, from_state, to_state)
      VALUES (NEW.project_id, NEW.org_id, app_uid(), 'document', NEW.id, 'document_shared', 'firm_private', 'shared');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_document_manage() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER document_manage BEFORE UPDATE OF ai_indexable, visibility ON documents
  FOR EACH ROW EXECUTE FUNCTION check_document_manage();
--> statement-breakpoint
-- 2. A new version: same project, owner, purpose, label and department as the
--    file it replaces, the next number, by the side that owns it. Evidence is
--    never versioned (a new submission is the next round). The old version
--    stays on record but leaves the assistant (its flag goes off, which drops
--    its passages and summaries).
CREATE FUNCTION check_document_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE old documents%ROWTYPE;
BEGIN
  SELECT * INTO old FROM documents WHERE id = NEW.supersedes_id;
  IF old.id IS NULL OR old.project_id <> NEW.project_id OR old.owner_org_id <> NEW.owner_org_id OR old.purpose <> NEW.purpose
     OR old.visibility <> NEW.visibility OR old.department_id IS DISTINCT FROM NEW.department_id THEN
    RAISE EXCEPTION 'a new version keeps its file''s project, owner, purpose, label and department' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.purpose = 'evidence' THEN
    RAISE EXCEPTION 'evidence is never versioned; submit it again' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.version <> old.version + 1 THEN
    RAISE EXCEPTION 'a new version takes the next number' USING ERRCODE = 'check_violation';
  END IF;
  IF app_uid() IS NOT NULL AND app_org() IS DISTINCT FROM NEW.owner_org_id THEN
    RAISE EXCEPTION 'only the side that owns a file uploads its new version' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_document_version() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER document_version BEFORE INSERT ON documents
  FOR EACH ROW WHEN (NEW.supersedes_id IS NOT NULL) EXECUTE FUNCTION check_document_version();
--> statement-breakpoint
CREATE FUNCTION retire_old_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE documents SET ai_indexable = false WHERE id = NEW.supersedes_id AND ai_indexable;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION retire_old_version() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER document_retire_old AFTER INSERT ON documents
  FOR EACH ROW WHEN (NEW.supersedes_id IS NOT NULL) EXECUTE FUNCTION retire_old_version();
