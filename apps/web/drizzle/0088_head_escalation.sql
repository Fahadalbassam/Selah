-- The department head's escalation never reaches nobody (the lead's ruling
-- on the review of 1b, 17 Nov 2026). At level 2 the reminder ladder tells
-- the head of the action's department. A head who is an action owner, and
-- not the action's owner, cannot open it (decision 1b), so her notice was
-- dropped (0081) while the ladder still said "department head". Now, when
-- the department has a head but none who can open the action, that step goes
-- to the client's admins instead, and the ladder says so. A head who can
-- open it (a manager, or the action's own owner) is told as before; a
-- department with no head is unchanged.
--
-- Who among the heads can open the action.
CREATE FUNCTION app_head_opens(head uuid, head_role role, aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT head_role IS DISTINCT FROM 'action_owner' OR EXISTS (SELECT 1 FROM actions a WHERE a.id = aid AND a.owner_user_id = head)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_head_opens(uuid, role, uuid) FROM PUBLIC;
--> statement-breakpoint
-- 1. What the reminder job sends (latest: 0020_project_closure).
CREATE OR REPLACE FUNCTION app_follow_ups_due(today date)
RETURNS TABLE (action_id uuid, project_id uuid, kind follow_up_kind, level integer, due_date date, recipients uuid[])
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH open_actions AS (
    SELECT a.id, a.project_id, a.org_id, a.owner_user_id, a.due_date, a.department_id, p.kind AS project_kind, p.firm_org_id,
           EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = a.owner_user_id AND m.org_id = a.org_id AND m.active) AS owner_active,
           (p.kind = 'client' AND o.engagement_mode = 'consultant_managed') AS firm_managed,
           o.departments_enabled,
           p.remind_days_before, p.escalate_level2_days, p.escalate_level3_days,
           today - a.due_date AS days_over
    FROM actions a JOIN projects p ON p.id = a.project_id JOIN organizations o ON o.id = a.org_id
    WHERE a.due_date IS NOT NULL AND app_owner_holds(a.status) AND p.state::text IN ('active', 'closing')
      -- While a project closes, an action with a disposition is no longer chased.
      AND NOT EXISTS (SELECT 1 FROM project_closure_items i JOIN project_closures c ON c.id = i.closure_id
                      WHERE i.action_id = a.id AND c.cancelled_at IS NULL AND c.reopened_at IS NULL)
      AND (a.owner_user_id IS NOT NULL OR (p.kind = 'client' AND o.engagement_mode = 'consultant_managed'))
  ),
  ladder AS (
    SELECT o.*, 'due_soon'::follow_up_kind AS kind, 0 AS step FROM open_actions o
      WHERE o.days_over BETWEEN -o.remind_days_before AND 0
    UNION ALL
    SELECT o.*, 'overdue'::follow_up_kind,
      CASE WHEN o.days_over >= o.escalate_level3_days THEN 3 WHEN o.days_over >= o.escalate_level2_days THEN 2 ELSE 1 END
    FROM open_actions o WHERE o.days_over > 0
  ),
  -- An owner who has left cannot be reminded: go straight to level 2. A
  -- firm-managed client has no owners in Selah; its lead is reminded instead.
  steps AS (
    SELECT l.*, CASE WHEN l.owner_active OR l.firm_managed THEN l.step ELSE greatest(l.step, 2) END AS level FROM ladder l
  ),
  -- The heads of each action's department, and whether they can open it.
  heads AS (
    SELECT s.id, s.kind, s.level, dm.user_id AS u, app_head_opens(dm.user_id, m.role, s.id) AS opens FROM steps s
      JOIN department_members dm ON dm.department_id = s.department_id AND dm.is_head
      JOIN org_memberships m ON m.user_id = dm.user_id AND m.org_id = s.org_id AND m.active
      WHERE s.level >= 2 AND s.project_kind = 'client' AND s.departments_enabled
  ),
  people AS (
    SELECT s.id, s.kind, s.level, s.owner_user_id AS u FROM steps s WHERE s.owner_active
    UNION
    -- firm-managed: the client's lead consultant chases the client
    SELECT s.id, s.kind, s.level, ca.user_id FROM steps s
      JOIN client_assignments ca ON ca.client_org_id = s.org_id AND ca.is_lead
      JOIN org_memberships m ON m.user_id = ca.user_id AND m.org_id = s.firm_org_id AND m.active
      WHERE s.firm_managed
    UNION
    -- level 2+: client managers staffed on the project, and the firm's lead
    SELECT s.id, s.kind, s.level, pm.user_id FROM steps s
      JOIN project_members pm ON pm.project_id = s.project_id
      JOIN org_memberships m ON m.user_id = pm.user_id AND m.org_id = s.org_id AND m.active AND m.role = 'client_manager'
      WHERE s.level >= 2 AND s.project_kind = 'client'
    UNION
    -- level 2+: the head of the action's department, when she can open it
    SELECT h.id, h.kind, h.level, h.u FROM heads h WHERE h.opens
    UNION
    -- ... and the client's admins in her place when no head can (1b)
    SELECT s.id, s.kind, s.level, m.user_id FROM steps s
      JOIN org_memberships m ON m.org_id = s.org_id AND m.active AND m.role = 'client_admin'
      WHERE EXISTS (SELECT 1 FROM heads h WHERE h.id = s.id AND h.kind = s.kind AND h.level = s.level)
        AND NOT EXISTS (SELECT 1 FROM heads h WHERE h.id = s.id AND h.kind = s.kind AND h.level = s.level AND h.opens)
    UNION
    SELECT s.id, s.kind, s.level, ca.user_id FROM steps s
      JOIN client_assignments ca ON ca.client_org_id = s.org_id AND ca.is_lead
      JOIN org_memberships m ON m.user_id = ca.user_id AND m.org_id = s.firm_org_id AND m.active
      WHERE s.level >= 2 AND s.project_kind = 'client'
    UNION
    SELECT s.id, s.kind, s.level, pm.user_id FROM steps s
      JOIN project_members pm ON pm.project_id = s.project_id AND pm.is_lead
      JOIN org_memberships m ON m.user_id = pm.user_id AND m.org_id = s.firm_org_id AND m.active
      WHERE s.level >= 2 AND s.project_kind = 'internal'
    UNION
    -- level 3: the client's sponsor, when the sponsor has an account that is
    -- still active (a sponsor named as a contact is not mailed)
    SELECT s.id, s.kind, s.level, r.user_id FROM steps s
      JOIN project_client_roles r ON r.project_id = s.project_id AND r.role = 'sponsor'
      JOIN org_memberships m ON m.user_id = r.user_id AND m.org_id = s.org_id AND m.active
        AND m.role IN ('client_admin', 'client_manager')
      WHERE s.level >= 3 AND s.project_kind = 'client'
    UNION
    -- level 3: the client's admins and the watching firm admins
    SELECT s.id, s.kind, s.level, m.user_id FROM steps s
      JOIN org_memberships m ON m.org_id = s.org_id AND m.active AND m.role = 'client_admin'
      WHERE s.level >= 3 AND s.project_kind = 'client'
    UNION
    SELECT s.id, s.kind, s.level, w.user_id FROM steps s
      JOIN watches w ON w.project_id = s.project_id OR (s.project_kind = 'client' AND w.client_org_id = s.org_id)
      JOIN org_memberships m ON m.user_id = w.user_id AND m.org_id = s.firm_org_id AND m.active AND m.role = 'firm_admin'
      WHERE s.level >= 3
  )
  SELECT s.id, s.project_id, s.kind, s.level, s.due_date,
         coalesce((SELECT array_agg(DISTINCT p.u ORDER BY p.u) FROM people p WHERE p.id = s.id AND p.kind = s.kind AND p.level = s.level), '{}')
  FROM steps s
  WHERE NOT EXISTS (
    SELECT 1 FROM follow_up_log l
    WHERE l.action_id = s.id AND l.kind = s.kind AND l.level = s.level AND l.due_date = s.due_date
  )
$$;
--> statement-breakpoint
-- 2. The ladder an action shows (latest: 0080_ladder_firm_run). At level 2,
--    "department head" when a head can open the action, otherwise "the
--    client's admins, in place of the head" when the department has a head;
--    at level 3 the admins are already told.
CREATE OR REPLACE FUNCTION app_action_ladder(aid uuid)
RETURNS TABLE (kind follow_up_kind, level integer, on_date date, audience text[], sent_at timestamptz, running boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH a AS (
    SELECT x.id, x.due_date, x.department_id, p.kind AS project_kind,
           p.remind_days_before, p.escalate_level2_days, p.escalate_level3_days,
           (p.kind = 'client' AND o.engagement_mode = 'consultant_managed') AS firm_managed,
           o.departments_enabled AND x.department_id IS NOT NULL AS has_dept,
           x.owner_user_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = x.owner_user_id AND m.org_id = x.org_id AND m.active) AS owner_active,
           app_owner_holds(x.status) AND p.state = 'active' AS running,
           -- the department has a head, and none of its heads can open the action
           o.departments_enabled AND x.department_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM department_members dm JOIN org_memberships m ON m.user_id = dm.user_id AND m.org_id = x.org_id AND m.active
                         WHERE dm.department_id = x.department_id AND dm.is_head)
             AND NOT EXISTS (SELECT 1 FROM department_members dm JOIN org_memberships m ON m.user_id = dm.user_id AND m.org_id = x.org_id AND m.active
                             WHERE dm.department_id = x.department_id AND dm.is_head AND app_head_opens(dm.user_id, m.role, x.id)) AS head_blocked
    FROM actions x JOIN projects p ON p.id = x.project_id JOIN organizations o ON o.id = x.org_id
    WHERE x.id = aid AND x.due_date IS NOT NULL AND app_can_see_action(aid)
      AND (x.owner_user_id IS NOT NULL OR (p.kind = 'client' AND o.engagement_mode = 'consultant_managed'))
  ),
  steps AS (
    SELECT a.*, s.kind, s.level, s.on_date FROM a, LATERAL (VALUES
      ('due_soon'::follow_up_kind, 0, a.due_date - a.remind_days_before),
      ('overdue'::follow_up_kind, 1, a.due_date + 1),
      ('overdue'::follow_up_kind, 2, a.due_date + a.escalate_level2_days),
      ('overdue'::follow_up_kind, 3, a.due_date + a.escalate_level3_days)
    ) s(kind, level, on_date)
  )
  SELECT s.kind, s.level, s.on_date,
    array_remove(ARRAY[
      CASE WHEN s.owner_active THEN 'owner' END,
      -- a firm-run client has no accounts: no managers, head, sponsor or admins to tell
      CASE WHEN s.level >= 2 AND s.project_kind = 'client' AND NOT s.firm_managed THEN 'client_managers' END,
      CASE WHEN s.level >= 2 AND s.project_kind = 'client' AND NOT s.firm_managed AND s.has_dept AND NOT s.head_blocked THEN 'department_head' END,
      CASE WHEN s.level = 2 AND s.project_kind = 'client' AND NOT s.firm_managed AND s.head_blocked THEN 'client_admins_for_head' END,
      -- a firm-managed client's lead chases the client from the first step
      CASE WHEN s.firm_managed OR (s.level >= 2 AND s.project_kind = 'client') THEN 'client_lead' END,
      CASE WHEN s.level >= 2 AND s.project_kind = 'internal' THEN 'project_lead' END,
      CASE WHEN s.level >= 3 AND s.project_kind = 'client' AND NOT s.firm_managed THEN 'sponsor' END,
      CASE WHEN s.level >= 3 AND s.project_kind = 'client' AND NOT s.firm_managed THEN 'client_admins' END,
      CASE WHEN s.level >= 3 THEN 'watching_firm_admins' END
    ], NULL),
    (SELECT l.created_at FROM follow_up_log l WHERE l.action_id = s.id AND l.kind = s.kind AND l.level = s.level AND l.due_date = s.due_date),
    s.running
  FROM steps s
  -- An owner who has left is not reminded: the ladder starts at level 2.
  WHERE s.level >= 2 OR s.owner_active OR s.firm_managed
  ORDER BY s.level
$$;
