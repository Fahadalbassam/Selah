-- Batch 4 review N1: app_tell_owner_changed() (0101) could be called by
-- anyone allowed to reassign, without a change and with any colleague as the
-- "old owner". It now tells only of the change the caller has just made, as
-- the service recorded it in the same transaction (the owner_changed event:
-- this caller, this transaction, from that old owner to the owner now).
-- Everything else as 0101.
CREATE OR REPLACE FUNCTION app_tell_owner_changed(aid uuid, old_owner uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a actions;
  p projects;
BEGIN
  IF NOT app_can_change_owner(aid) THEN
    RAISE EXCEPTION 'not allowed to change who owns this action' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO a FROM actions WHERE id = aid;
  SELECT * INTO p FROM projects WHERE id = a.project_id;
  -- Only of a change the caller has just made, as recorded in this transaction: from the old owner
  -- named here to the action's owner now (review N1). Nothing else can be announced.
  IF NOT EXISTS (
    SELECT 1 FROM activity_events e
    WHERE e.entity_type = 'action' AND e.entity_id = aid AND e.event = 'owner_changed'
      AND e.actor_id = app_uid() AND e.created_at = now()
      AND ((e.meta ->> 'from') IS NOT DISTINCT FROM old_owner::text
           OR (old_owner IS NULL AND e.meta ->> 'from' = 'typed'))
      AND (e.meta ->> 'to') IS NOT DISTINCT FROM coalesce(a.owner_user_id::text, CASE WHEN a.owner_name IS NOT NULL THEN 'typed' END)
  ) THEN
    RAISE EXCEPTION 'no change to tell of' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF a.status = 'draft' THEN
    RETURN;
  END IF;
  -- The new owner: the action is theirs (mailed by their choices, like any assignment).
  IF a.owner_user_id IS NOT NULL AND a.owner_user_id <> app_uid() THEN
    INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES (a.owner_user_id, 'action.assigned', 'action', aid);
  END IF;
  -- The old owner: about the project, never the action they no longer read.
  IF old_owner IS NOT NULL AND old_owner <> app_uid() AND old_owner IS DISTINCT FROM a.owner_user_id
     AND EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = old_owner AND m.org_id = a.org_id AND m.active) THEN
    INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES (old_owner, 'action.owner_moved', 'project', a.project_id);
  END IF;
  -- The client's lead and deputy, and the consultants staffed on the project (not observers): active firm people.
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT DISTINCT x.user_id, 'action.owner_changed', 'action', aid
    FROM (
      SELECT ca.user_id FROM client_assignments ca WHERE ca.client_org_id = a.org_id AND (ca.is_lead OR ca.is_deputy) AND p.kind = 'client'
      UNION
      SELECT pm.user_id FROM project_members pm WHERE pm.project_id = a.project_id AND NOT pm.observer
    ) x
    JOIN org_memberships m ON m.user_id = x.user_id AND m.org_id = p.firm_org_id AND m.active
    WHERE x.user_id <> app_uid() AND x.user_id IS DISTINCT FROM a.owner_user_id;
END $$;
