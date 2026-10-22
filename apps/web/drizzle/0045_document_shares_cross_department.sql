-- A file shared with someone one by one reaches them even when it is filed
-- under another department. Until now the restrictive department policy hid
-- it, so the share did nothing (found while building the file explorer).
-- The check is a SECURITY DEFINER function: document_shares' own policy
-- reads documents, so reading it from a documents policy would recurse.
CREATE FUNCTION app_document_shared_with_me(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM document_shares s WHERE s.document_id = doc AND s.user_id = app_uid())
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_document_shared_with_me(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_document_shared_with_me(uuid) TO selah_app;
--> statement-breakpoint
DROP POLICY department ON documents;
--> statement-breakpoint
-- Reads also pass for a person the file was shared with; writes keep the
-- department rule as it was.
CREATE POLICY department ON documents AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_dept_ok(department_id, org_id) OR uploaded_by = app_uid() OR app_document_shared_with_me(id))
  WITH CHECK (app_dept_ok(department_id, org_id) OR uploaded_by = app_uid());
