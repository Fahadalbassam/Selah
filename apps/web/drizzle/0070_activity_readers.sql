-- The project's activity record is for the firm and the client's admin (page
-- audit N3; decision D8). It lists who asked for a new date, who sent
-- evidence and who closed what across the whole project, so a manager
-- limited to her department read the other departments' events, and an
-- action owner could read them straight from the table (the screen showed
-- him none, the row policy did not agree).
--
-- Everyone still writes events (scoped_insert is unchanged); reading them is
-- for firm staff who can see the project and for the client's admin.
DROP POLICY scoped_read ON activity_events;
--> statement-breakpoint
CREATE POLICY scoped_read ON activity_events FOR SELECT TO selah_app
  USING (app_can_see_project(project_id) AND app_label_ok(visibility, org_id, actor_id)
         AND (app_org_kind() = 'firm' OR app_role() = 'client_admin'));
--> statement-breakpoint
-- The one thing the action page took from the feed for every reader: when a
-- restructure refiled this action under another department (F31). Returned
-- for an action the caller may open (an action owner: their own), and
-- nothing else of the event.
CREATE FUNCTION app_action_refilings(act uuid)
RETURNS TABLE (at timestamptz, actor_id uuid, from_department uuid, to_department uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.created_at, e.actor_id, (e.meta ->> 'from')::uuid, (e.meta ->> 'to')::uuid
  FROM actions a JOIN activity_events e ON e.project_id = a.project_id
  WHERE a.id = act AND e.event = 'department_moved' AND e.meta -> 'actions' ? act::text
    AND app_can_see_action(act)
    AND (app_role() IS DISTINCT FROM 'action_owner' OR coalesce(a.owner_user_id = app_uid(), false))
  ORDER BY e.created_at
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_action_refilings(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_action_refilings(uuid) TO selah_app;
