-- Closing settles what the gate decided (two-sided review R01). An action
-- withdrawn or waived at closing used to keep its open status after the
-- project closed, so every roll-up still counted it as open next to a
-- closure report that said it was settled. Now closing also closes those
-- actions as not applicable, with the disposition's reason as the note, and
-- the action's history shows the move. Handed-over and deferred actions stay
-- open: the client carries them on after the engagement.
CREATE OR REPLACE FUNCTION app_close_project(pid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF NOT app_can_see_project(pid) OR NOT app_can_close_project(pid) THEN
    RAISE EXCEPTION 'no such project' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT state::text FROM projects WHERE id = pid) <> 'closing' THEN
    RAISE EXCEPTION 'start closing the project first' USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO n FROM app_closure_blockers(pid);
  IF n > 0 THEN
    RAISE EXCEPTION 'settle every open item before closing (% left)', n USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, from_state, to_state)
    SELECT a.project_id, a.org_id, app_uid(), 'action', a.id, 'status_changed', a.status::text, 'closed'
    FROM actions a JOIN project_closure_items i ON i.action_id = a.id
    WHERE i.closure_id = app_open_closure(pid) AND i.disposition IN ('withdrawn', 'waived')
      AND app_action_open(a.status);
  UPDATE actions a SET status = 'closed', closure_outcome = 'not_applicable', closure_note = i.note
    FROM project_closure_items i
    WHERE i.action_id = a.id AND i.closure_id = app_open_closure(pid) AND i.disposition IN ('withdrawn', 'waived')
      AND app_action_open(a.status);
  UPDATE project_closures SET closed_by = app_uid(), closed_at = now() WHERE id = app_open_closure(pid);
  PERFORM set_config('selah.project_state', 'on', true);
  UPDATE projects SET state = 'closed' WHERE id = pid;
  PERFORM set_config('selah.project_state', '', true);
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT DISTINCT u, 'project.closed', 'project', pid FROM (
      SELECT app_project_audience(pid) AS u
      UNION
      SELECT r.user_id FROM project_client_roles r
        JOIN org_memberships m ON m.user_id = r.user_id AND m.org_id = r.org_id AND m.active
        WHERE r.project_id = pid AND r.role = 'sponsor'
    ) x WHERE u IS NOT NULL AND u <> app_uid();
END $$;
