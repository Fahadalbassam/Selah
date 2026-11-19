-- Batch 4 review S1 (the coordinator's decision, 19 Nov 2026): everyone who
-- may open an action reads its owner changes (who gave it to whom, and
-- when) on the action page, so the new owner reads "given to you by … on
-- …". The activity record keeps its own rules (0071: the firm and the
-- client's admin); this reader answers only for this one action, only to
-- someone who may open it (app_can_see_action: an action owner only while
-- she owns it), and only these facts. A typed owner (a client the
-- firm runs) is named by the title the action itself holds.
CREATE FUNCTION app_action_owner_changes(act uuid)
RETURNS TABLE (at timestamptz, actor_name text, to_user uuid, to_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.created_at, u.name,
         CASE WHEN e.meta ->> 'to' ~ '^[0-9a-f-]{36}$' THEN (e.meta ->> 'to')::uuid END,
         coalesce(t.name, e.meta ->> 'toName')
  FROM activity_events e
  LEFT JOIN "user" u ON u.id = e.actor_id
  LEFT JOIN "user" t ON e.meta ->> 'to' ~ '^[0-9a-f-]{36}$' AND t.id = (e.meta ->> 'to')::uuid
  WHERE e.entity_type = 'action' AND e.entity_id = act AND e.event = 'owner_changed'
    AND app_can_see_action(act)
    -- Who the firm named while it was still a draft is the firm's (D6).
    AND (app_org_kind() = 'firm' OR NOT EXISTS (
      SELECT 1 FROM activity_events r WHERE r.entity_type = 'action' AND r.entity_id = act
        AND r.event = 'status_changed' AND r.from_state = 'draft' AND r.created_at > e.created_at))
  ORDER BY e.created_at
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_action_owner_changes(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_action_owner_changes(uuid) TO selah_app;
