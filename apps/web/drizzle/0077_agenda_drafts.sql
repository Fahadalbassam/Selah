-- A meeting's stored agenda goes to a client manager only when no action of
-- the project (of the department, for a department's meeting) fails her
-- department check (0072). A draft counted too, so a draft the firm filed
-- under another department withheld the agenda from a manager who may open
-- every released action. An agenda never names a draft (app_meeting_agenda
-- lists open, awaiting-review, blocked and changed released work), and no
-- client reads one (D6, 0076), so drafts no longer count. Otherwise as 0072.
CREATE OR REPLACE FUNCTION app_reads_all_actions(pid uuid, dept uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_can_see_project(pid) AND (
    (app_org_kind() = 'firm' AND app_role() IS NOT NULL)
    OR (app_role() IN ('client_admin', 'client_manager') AND NOT EXISTS (
          SELECT 1 FROM actions a JOIN recommendations r ON r.id = a.recommendation_id
          WHERE a.project_id = pid AND r.visibility = 'shared' AND (dept IS NULL OR a.department_id = dept)
            AND a.status <> 'draft'
            AND NOT (app_dept_ok(a.department_id, a.org_id) OR coalesce(a.owner_user_id = app_uid(), false))))
  )
$$;
