-- "May see everything on the project" is stable (the lead's ruling on the
-- review of 1a, 17 Nov 2026). 0082 asked whether any released action of the
-- project lay outside the reader's departments, so the answer moved whenever
-- the firm released or refiled work: a manager could lose every meeting of
-- the whole project at once, the ones she organised included, and nobody was
-- told. Now it depends only on departments and memberships:
--   - firm staff on the project (the firm admin, the client's lead or
--     deputy, a consultant staffed on it, an observer);
--   - the client's admin;
--   - a client manager on the project when the client has departments
--     switched off, or when she is a member of every active department of
--     the client.
-- Releasing an action never changes it. The same rule opens a meeting of
-- the whole project, books one, and drives the invite warning; the stored
-- agenda follows it in 0085.
--
-- 1. For anyone (not granted: the definer functions below ask it). Whether
--    the person opens the project at all is asked separately (the caller's
--    form adds app_can_see_project; the invite list holds only people who
--    open it).
CREATE FUNCTION app_user_sees_whole_project(target uuid, pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT CASE
      WHEN m.org_id = p.firm_org_id THEN m.role IN ('firm_admin', 'consultant')
      WHEN m.org_id = p.org_id AND p.kind = 'client' THEN
        m.role = 'client_admin'
        OR (m.role = 'client_manager' AND (
              NOT o.departments_enabled
              OR NOT EXISTS (
                SELECT 1 FROM departments d
                WHERE d.org_id = p.org_id AND d.active
                  AND NOT EXISTS (SELECT 1 FROM department_members dm WHERE dm.department_id = d.id AND dm.user_id = target))))
      ELSE false
    END
    FROM projects p
    JOIN organizations o ON o.id = p.org_id
    JOIN org_memberships m ON m.user_id = target AND m.active AND m.org_id IN (p.firm_org_id, p.org_id)
    WHERE p.id = pid
  ), false)
$$;
--> statement-breakpoint
-- The caller's form, for the row policies and the services.
CREATE FUNCTION app_sees_whole_project(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_can_see_project(pid) AND app_user_sees_whole_project(app_uid(), pid)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_user_sees_whole_project(uuid, uuid), app_sees_whole_project(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_sees_whole_project(uuid) TO selah_app;
--> statement-breakpoint
-- 2. Who opens (and so books, through the policy whole_project) a meeting of
--    the whole project (latest: 0082): the stable rule, plus action owners
--    invited to it.
CREATE OR REPLACE FUNCTION app_meeting_whole_ok(mid uuid, pid uuid, dept uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT dept IS NOT NULL
    OR app_sees_whole_project(pid)
    OR (app_role() = 'action_owner' AND app_attends_meeting(mid))
$$;
--> statement-breakpoint
-- 3. The invite list (latest: 0082) says the same of each person.
CREATE OR REPLACE FUNCTION app_meeting_invitees(pid uuid)
RETURNS TABLE (user_id uuid, name text, firm boolean, whole_project boolean, departments uuid[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.name, mo.org_id = p.firm_org_id,
    mo.role = 'action_owner' OR app_user_sees_whole_project(u.id, pid),
    coalesce((SELECT array_agg(d.id ORDER BY d.id) FROM department_members dm JOIN departments d ON d.id = dm.department_id
              WHERE dm.user_id = u.id AND d.org_id = p.org_id AND d.active AND mo.org_id = p.org_id), '{}')
  FROM projects p
  JOIN org_memberships mo ON mo.active AND mo.org_id IN (p.firm_org_id, p.org_id)
  JOIN "user" u ON u.id = mo.user_id
  WHERE p.id = pid AND app_can_see_project(pid) AND app_user_sees_project(u.id, pid)
    AND (app_org_kind() = 'firm' OR mo.org_id = app_org()
         OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = pid AND pm.user_id = u.id))
  ORDER BY mo.org_id = p.firm_org_id DESC, u.name
$$;
