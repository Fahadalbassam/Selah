-- ==========================================================================
-- The reminder ladder on a firm-run client's action names only people who
-- exist (page audit N24). A consultant-managed client has no accounts, so
-- app_follow_ups_due() reminds its lead consultant at every level and the
-- watching firm admins at the last (docs/engagement.md). The ladder shown
-- on the action listed client managers, a department head, the sponsor and
-- the client's admins as well: roles nobody holds there. They are left out
-- for such a client; everything else is 0019's definition.
-- ==========================================================================

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
           app_owner_holds(x.status) AND p.state = 'active' AS running
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
      CASE WHEN s.level >= 2 AND s.project_kind = 'client' AND NOT s.firm_managed AND s.has_dept THEN 'department_head' END,
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
