-- Evidence integrity (design review H2, H4) and scan state (H1).
--
--   * A stored file never changes: a new version is a new document row.
--   * Evidence cannot be deleted, so a review always points at what was seen.
--   * A scan result is written once (pending -> clean | infected | error).
--   * Evidence reaches the AI index only after the firm accepted it, and only
--     firm staff can switch that on. Unreviewed client text never becomes an
--     assistant source.

CREATE FUNCTION app_evidence_accepted(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM evidence_submissions es
    JOIN actions a ON a.id = es.action_id
    WHERE es.document_id = doc AND a.status = 'verified_complete'
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_evidence_accepted(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_evidence_accepted(uuid) TO selah_app;
--> statement-breakpoint

CREATE FUNCTION check_document_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.purpose = 'evidence' THEN
      RAISE EXCEPTION 'evidence cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.storage_key <> OLD.storage_key OR NEW.sha256 <> OLD.sha256 OR NEW.size_bytes <> OLD.size_bytes
       OR NEW.content_type <> OLD.content_type OR NEW.version <> OLD.version OR NEW.purpose <> OLD.purpose
       OR NEW.project_id <> OLD.project_id OR NEW.org_id <> OLD.org_id OR NEW.uploaded_by <> OLD.uploaded_by
       OR NEW.owner_org_id <> OLD.owner_org_id OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'a stored file cannot change; upload a new version' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.purpose = 'evidence' AND NEW.title <> OLD.title THEN
      RAISE EXCEPTION 'evidence cannot be renamed' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.scan_status <> OLD.scan_status AND OLD.scan_status <> 'pending' THEN
      RAISE EXCEPTION 'a scan result is final' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.purpose = 'evidence' AND NEW.ai_indexable
     AND (TG_OP = 'INSERT' OR NOT OLD.ai_indexable) THEN
    IF app_org_kind() IS DISTINCT FROM 'firm' OR NOT app_evidence_accepted(NEW.id) THEN
      RAISE EXCEPTION 'evidence is indexed for the assistant only after the firm verified it'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_integrity BEFORE INSERT OR UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION check_document_integrity();
