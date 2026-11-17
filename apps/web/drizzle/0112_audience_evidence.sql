-- Who sees an item (feature A): a narrowed file is never copied into evidence
-- (review of the branch, B1). "Use a file already in Selah" copies the file
-- into a new evidence document, and evidence has no audience: the copy reached
-- the people the file was kept from.
--
-- 1. Whether the caller opens a file by the rules before any audience, as the
--    row policies on documents say (project, label, unsubmitted evidence,
--    department or uploader or a one-by-one share). For the functions below
--    that answer only about a file the caller can already see.
CREATE FUNCTION app_caller_sees_document(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT app_can_see_project(d.project_id)
      AND app_label_ok(d.visibility, d.org_id, d.uploaded_by)
      AND (d.state <> 'draft' OR d.purpose <> 'evidence' OR d.uploaded_by = app_uid())
      AND (app_dept_ok(d.department_id, d.org_id) OR d.uploaded_by = app_uid() OR app_document_shared_with_me(d.id))
    FROM documents d WHERE d.id = doc
  ), false)
$$;
--> statement-breakpoint
-- 2. Whether a file the caller can see was narrowed with the picker (the
--    "use as evidence" check). Nothing about a file they cannot see.
CREATE FUNCTION app_document_narrowed(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_caller_sees_document(doc)
    AND EXISTS (SELECT 1 FROM item_audiences a WHERE a.item_type = 'document' AND a.item_id = doc)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_caller_sees_document(uuid), app_document_narrowed(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_document_narrowed(uuid) TO selah_app;
--> statement-breakpoint
-- 3. The database's side: an evidence file whose bytes are those of a narrowed
--    file of the same client is refused, whoever writes it and however (the
--    copy keeps the checksum; a fresh upload of the same file is the same leak).
CREATE FUNCTION check_evidence_not_narrowed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM documents d JOIN item_audiences a ON a.item_type = 'document' AND a.item_id = d.id
    WHERE d.org_id = NEW.org_id AND d.sha256 = NEW.sha256 AND d.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'a file with a limited audience can''t be used as evidence: upload the evidence instead' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_evidence_not_narrowed() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER evidence_not_narrowed BEFORE INSERT ON documents FOR EACH ROW WHEN (NEW.purpose = 'evidence')
  EXECUTE FUNCTION check_evidence_not_narrowed();
