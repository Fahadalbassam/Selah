-- Who sees an item (feature A) and deliverables handed over (0092): a person
-- left out of a file does not open it, so she is never asked to confirm a
-- round with that file, never reminded of it and never shown it; the next in
-- line is asked. The audience check is the three-argument one, about her.
-- (latest: 0092_deliverable_receipts, its text kept)
CREATE OR REPLACE FUNCTION app_user_opens_document(target uuid, doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM documents d
    JOIN projects p ON p.id = d.project_id
    JOIN organizations o ON o.id = d.org_id
    JOIN org_memberships m ON m.user_id = target AND m.active AND m.org_id = d.org_id
    WHERE d.id = doc AND d.visibility = 'shared' AND d.state <> 'archived' AND d.withdrawn_at IS NULL
      AND p.kind = 'client' AND p.state::text <> 'draft' AND app_user_sees_project(target, d.project_id)
      AND (d.department_id IS NULL OR NOT o.departments_enabled OR m.role = 'client_admin' OR d.uploaded_by = target
           OR EXISTS (SELECT 1 FROM department_members dm WHERE dm.department_id = d.department_id AND dm.user_id = target)
           OR EXISTS (SELECT 1 FROM document_shares s WHERE s.document_id = doc AND s.user_id = target))
      AND app_audience_ok('document', d.id, target)
  )
$$;
