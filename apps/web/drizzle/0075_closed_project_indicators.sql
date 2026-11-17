-- A closed project gives no right to change the client's business
-- indicators (privacy review #5; decided by the product owner's lead).
--
-- A closed project is read-only (policy.ts OPEN_WHEN_CLOSED). Under 0073 a
-- consultant staffed only on a closed project of the client still counted as
-- working for it, and so could enter values, check them, and add, edit or
-- link indicators. Now only staffing on a project that is not closed counts;
-- the lead, the deputy and the firm admin are unchanged. The app asks the
-- same in loadPrincipal() (workingClientIds).
CREATE OR REPLACE FUNCTION app_firm_changes_kpis(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_firm_works_with(org) AND (
    app_role() = 'firm_admin'
    OR app_is_client_lead(org)
    OR EXISTS (
      SELECT 1 FROM project_members pm JOIN projects p ON p.id = pm.project_id
      WHERE pm.user_id = app_uid() AND NOT pm.observer AND p.org_id = org AND p.kind = 'client' AND p.state <> 'closed')
  )
$$;
