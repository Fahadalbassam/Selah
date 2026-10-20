-- Design review of 0008 (W1-W3).
--
-- W1: notifications cannot be forged. The only kind is "awaiting review",
--     and only while the action really is awaiting review.
-- W2: only active members hear about work: the lead must still be an active
--     consultant, a watcher an active firm admin, staff active in the firm.
-- W3: on a client project even the admin staffs only the client's team,
--     themselves (co-consulting) or that client's own users.

CREATE OR REPLACE FUNCTION app_project_audience(pid uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT u FROM (
    SELECT ca.user_id AS u FROM projects p
      JOIN client_assignments ca ON ca.client_org_id = p.org_id AND ca.is_lead
      JOIN org_memberships m ON m.user_id = ca.user_id AND m.org_id = p.firm_org_id AND m.active AND m.role = 'consultant'
      WHERE p.id = pid AND p.kind = 'client'
    UNION
    SELECT pm.user_id FROM projects p JOIN project_members pm ON pm.project_id = p.id
      JOIN org_memberships m ON m.user_id = pm.user_id AND m.org_id = p.firm_org_id AND m.active
      WHERE p.id = pid AND (p.kind = 'client' OR pm.is_lead)
    UNION
    SELECT w.user_id FROM projects p
      JOIN watches w ON w.project_id = p.id OR (p.kind = 'client' AND w.client_org_id = p.org_id)
      JOIN org_memberships m ON m.user_id = w.user_id AND m.org_id = p.firm_org_id AND m.active AND m.role = 'firm_admin'
      WHERE p.id = pid
  ) audience
  WHERE app_can_see_project(pid)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_notify_project_team(act uuid, note_kind text, skip uuid[]) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pid uuid; st action_status; n integer;
BEGIN
  SELECT a.project_id, a.status INTO pid, st FROM actions a WHERE a.id = act;
  IF pid IS NULL OR NOT app_can_see_project(pid) THEN
    RAISE EXCEPTION 'action not visible' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF note_kind <> 'action.awaiting_review' OR st <> 'awaiting_review' THEN
    RAISE EXCEPTION 'notification does not match the action' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT u, note_kind, 'action', act FROM app_project_audience(pid) u
    WHERE u <> app_uid() AND NOT (u = ANY (coalesce(skip, '{}')));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
DROP POLICY member_insert ON project_members;
--> statement-breakpoint
CREATE POLICY member_insert ON project_members FOR INSERT TO selah_app WITH CHECK (
  (app_can_see_project(project_id) AND (
    (app_role() = 'firm_admin' AND (
      app_project_kind(project_id) = 'internal'
      OR user_id = app_uid()
      OR app_user_org(user_id) = app_project_org(project_id)
      OR app_on_client_team(user_id, app_project_org(project_id))))
    OR (app_role() = 'client_admin' AND app_user_org(user_id) = app_org() AND NOT is_lead)
    OR (app_is_project_lead(project_id) AND app_user_org(user_id) = app_org())
    OR (app_project_kind(project_id) = 'client' AND app_is_client_lead(app_project_org(project_id)) AND NOT is_lead
        AND app_on_client_team(user_id, app_project_org(project_id)))
  ))
  OR (user_id = app_uid() AND is_lead AND app_can_claim_project(project_id))
);
