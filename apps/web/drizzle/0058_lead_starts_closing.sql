-- ------------------------------------------------ the lead starts closing (wave 3)
-- The client's lead consultant (or the deputy, through app_is_client_lead)
-- may start closing a client project, and stop it again: they open the
-- gate and work through what it lists. Only the firm admin closes, as
-- before (app_can_close_project is unchanged), and declining the client's
-- request to close stays with the admin too. When a lead starts, the firm
-- admins are told, since the last step is theirs.
CREATE FUNCTION app_can_start_closing(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_can_close_project(pid) OR EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = pid AND p.kind = 'client' AND app_org_kind() = 'firm' AND p.firm_org_id = app_org()
      AND app_role() = 'consultant' AND app_is_client_lead(p.org_id)
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_start_closing(pid uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  p projects;
  round uuid;
BEGIN
  SELECT * INTO p FROM projects WHERE id = pid;
  IF p.id IS NULL OR NOT app_can_see_project(pid) THEN
    RAISE EXCEPTION 'no such project' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT app_can_start_closing(pid) THEN
    RAISE EXCEPTION 'only the firm admin or the client''s lead consultant starts closing' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p.state::text NOT IN ('planned', 'active') THEN
    RAISE EXCEPTION 'only a planned or active project can start closing' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO project_closures (project_id, org_id, started_by) VALUES (pid, p.org_id, app_uid()) RETURNING id INTO round;
  PERFORM set_config('selah.project_state', 'on', true);
  UPDATE projects SET state = 'closing' WHERE id = pid;
  PERFORM set_config('selah.project_state', '', true);
  WITH answered AS (
    UPDATE project_closure_requests SET status = 'accepted', decided_by = app_uid(), decided_at = now()
    WHERE project_id = pid AND status = 'pending' RETURNING requested_by, id
  )
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT requested_by, 'closure.started', 'project', pid FROM answered WHERE requested_by IS NOT NULL;
  -- A lead started it: the admins close it, so they hear now.
  IF NOT app_can_close_project(pid) THEN
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT m.user_id, 'closure.lead_started', 'project', pid FROM org_memberships m
      WHERE m.active AND m.org_id = p.firm_org_id AND m.role = 'firm_admin';
  END IF;
  RETURN round;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_cancel_closing(pid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app_can_see_project(pid) OR NOT app_can_start_closing(pid) THEN
    RAISE EXCEPTION 'no such project' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT state::text FROM projects WHERE id = pid) <> 'closing' THEN
    RAISE EXCEPTION 'this project is not closing' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE project_closures SET cancelled_by = app_uid(), cancelled_at = now() WHERE id = app_open_closure(pid);
  PERFORM set_config('selah.project_state', 'on', true);
  UPDATE projects SET state = 'active' WHERE id = pid;
  PERFORM set_config('selah.project_state', '', true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_start_closing(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_start_closing(uuid) TO selah_app;
