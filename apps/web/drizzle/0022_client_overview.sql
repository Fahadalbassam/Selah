-- A client's progress across its projects (F30 of the full picture). The
-- numbers pool the actions of every project the reader can see, and a
-- percentage is worked out from the pooled counts, never averaged across
-- projects: two projects at 50% with 2 and 40 actions are not "50%" together
-- unless the counts say so. Next to the total come the same numbers per
-- project and per department (department_id NULL is the company-wide work),
-- so every total has its breakdown beside it.
--
-- SECURITY INVOKER: it reads under the caller's row-level security, so a
-- consultant counts only the projects they are staffed on, and a department's
-- manager only their department's work. The counts match app_project_progress.
CREATE FUNCTION app_client_progress(client uuid, today date)
RETURNS TABLE (
  scope text, project_id uuid, department_id uuid,
  total integer, verified integer, partially integer, risk_accepted integer, not_applicable integer,
  superseded integer, open integer, overdue integer, awaiting_review integer, blocked integer, implemented_pct numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH a AS (
    SELECT a.* FROM actions a JOIN projects p ON p.id = a.project_id AND p.kind = 'client'
    WHERE a.org_id = client AND a.status <> 'draft'
  )
  SELECT
    CASE WHEN GROUPING(a.project_id) = 0 THEN 'project' WHEN GROUPING(a.department_id) = 0 THEN 'department' ELSE 'client' END,
    CASE WHEN GROUPING(a.project_id) = 0 THEN a.project_id END,
    CASE WHEN GROUPING(a.department_id) = 0 THEN a.department_id END,
    count(*)::int,
    count(*) FILTER (WHERE status = 'verified_complete')::int,
    count(*) FILTER (WHERE closure_outcome = 'partially_implemented')::int,
    count(*) FILTER (WHERE closure_outcome = 'risk_accepted')::int,
    count(*) FILTER (WHERE closure_outcome = 'not_applicable')::int,
    count(*) FILTER (WHERE closure_outcome = 'superseded')::int,
    count(*) FILTER (WHERE closure_outcome IS NULL AND status <> 'verified_complete')::int,
    count(*) FILTER (WHERE closure_outcome IS NULL AND status <> 'verified_complete' AND due_date < today)::int,
    count(*) FILTER (WHERE status = 'awaiting_review')::int,
    count(*) FILTER (WHERE status = 'blocked')::int,
    round(100.0 * count(*) FILTER (WHERE status = 'verified_complete') / nullif(count(*) FILTER (WHERE closure_outcome IS NULL OR closure_outcome NOT IN ('not_applicable', 'superseded')), 0), 1)
  FROM a
  GROUP BY GROUPING SETS ((), (a.project_id), (a.department_id))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_client_progress(uuid, date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_client_progress(uuid, date) TO selah_app;
