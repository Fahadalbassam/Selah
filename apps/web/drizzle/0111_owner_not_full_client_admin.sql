-- A full client's admin does not do actions (owner decision, 19 Nov 2026), so
-- nobody gives one to them: the "Give to a colleague" list already leaves them
-- out (PR #202); here the database refuses it too, not only the list. Only on a
-- full client (engagement mode 'full'). A restricted client has admin
-- accounts only and its admin does the work on the actions they own (0107), so
-- there an admin may still be given one; a client the firm runs is unchanged.
--
-- What it covers: a signed-in person giving a released action to a full
-- client's admin (D1, the firm's edit, a plain UPDATE as the app role), and
-- the hand-over of a person's work (app_hand_over(), latest 0109, redefined
-- below), which refuses their actions going to the admin.
-- What it leaves as it was: creating an action and changing a draft's owner
-- (the firm may still name the admin while it writes the plan, as for the
-- documents it asks of them), and releasing a draft. The rule is about giving,
-- not owning: an admin who already owns actions (named on a draft, or whose
-- role or client's mode changed later) keeps them and gives them on with D1.
-- Jobs and migrations (not the app role) are not limited.

-- 1. Is this person an active client admin of this full client?
CREATE FUNCTION app_full_client_admin(target uuid, org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_memberships m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = target AND m.org_id = org AND m.active AND m.role = 'client_admin'
      AND o.kind = 'client' AND o.engagement_mode = 'full'
      -- Only about an organisation the caller may see: it tells nothing about others.
      AND (app_uid() IS NULL OR app_can_see_org(org))
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_full_client_admin(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_full_client_admin(uuid, uuid) TO selah_app;
--> statement-breakpoint
-- 2. The owner change of a released action. Not a definer function on
--    purpose: current_user is the app role for a direct change, and a definer
--    function's owner inside one (app_hand_over() checks for itself, below).
CREATE FUNCTION check_owner_not_full_client_admin() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'selah_app' AND app_uid() IS NOT NULL
     AND OLD.status <> 'draft'
     AND NEW.owner_user_id IS NOT NULL AND NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     AND app_full_client_admin(NEW.owner_user_id, NEW.org_id) THEN
    RAISE EXCEPTION 'a full client''s admin does not own actions: give it to a colleague who does the work' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER owner_not_full_client_admin BEFORE UPDATE OF owner_user_id ON actions
  FOR EACH ROW EXECUTE FUNCTION check_owner_not_full_client_admin();
--> statement-breakpoint
-- 3. Handing over a person's work (latest: 0109_lead_change_end_reminder),
--    with one check added: their actions never go to a full client's admin.
--    Everything else as 0109.
CREATE OR REPLACE FUNCTION app_hand_over(from_uid uuid, to_uid uuid, kinds text[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  org uuid;
  moved integer := 0;
  k integer;
  counts jsonb := '{}'::jsonb;
  r record;
BEGIN
  IF NOT app_can_manage_person(from_uid) THEN
    RAISE EXCEPTION 'not visible' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF from_uid = to_uid THEN
    RAISE EXCEPTION 'hand over to someone else' USING ERRCODE = 'check_violation';
  END IF;
  SELECT m.org_id INTO org FROM org_memberships m WHERE m.user_id = from_uid;
  IF NOT EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = to_uid AND m.org_id = org AND m.active) THEN
    RAISE EXCEPTION 'hand over to an active member of the same organisation' USING ERRCODE = 'check_violation';
  END IF;
  IF kinds <@ ARRAY['action', 'client_lead', 'project_lead', 'review', 'client_role'] IS NOT TRUE THEN
    RAISE EXCEPTION 'unknown kind of work' USING ERRCODE = 'check_violation';
  END IF;
  -- A full client's admin does not do actions (0111): a leaver's open actions go
  -- straight to a colleague who does the work, never to the admin.
  IF 'action' = ANY (kinds) AND app_full_client_admin(to_uid, org)
     AND EXISTS (SELECT 1 FROM app_person_holdings_of(from_uid) h WHERE h.kind = 'action') THEN
    RAISE EXCEPTION 'a full client''s admin does not own actions: hand them to a colleague who does the work' USING ERRCODE = 'check_violation';
  END IF;

  IF 'action' = ANY (kinds) THEN
    INSERT INTO project_members (project_id, user_id, added_by)
      SELECT DISTINCT h.project_id, to_uid, app_uid() FROM app_person_holdings_of(from_uid) h WHERE h.kind = 'action'
      ON CONFLICT DO NOTHING;
    WITH handed AS (
      UPDATE actions a SET owner_user_id = to_uid
        FROM app_person_holdings_of(from_uid) h WHERE h.kind = 'action' AND a.id = h.entity_id
        RETURNING a.id, a.status
    ), told AS (
      -- released work tells its new owner (and mails them, by their choices)
      INSERT INTO notifications (user_id, kind, entity_type, entity_id)
        SELECT to_uid, 'action.assigned', 'action', x.id FROM handed x WHERE app_action_open(x.status)
        RETURNING 1
    )
    SELECT count(*) INTO k FROM handed;
    moved := moved + k;
    counts := counts || jsonb_build_object('action', k);
  END IF;

  -- before the leads move: a new lead would no longer see these as sole reviews
  IF 'review' = ANY (kinds) THEN
    INSERT INTO project_members (project_id, user_id, added_by)
      SELECT DISTINCT h.project_id, to_uid, app_uid() FROM app_person_holdings_of(from_uid) h WHERE h.kind = 'review'
      ON CONFLICT (project_id, user_id) DO UPDATE SET observer = false;
    GET DIAGNOSTICS k = ROW_COUNT;
    moved := moved + k;
    counts := counts || jsonb_build_object('review', k);
  END IF;

  IF 'client_lead' = ANY (kinds) THEN
    k := 0;
    PERFORM set_config('selah.hand_over', 'on', true);
    FOR r IN SELECT h.entity_id FROM app_person_holdings_of(from_uid) h WHERE h.kind = 'client_lead' LOOP
      UPDATE client_assignments SET is_lead = false WHERE client_org_id = r.entity_id AND user_id = from_uid;
      INSERT INTO client_assignments (client_org_id, user_id, is_lead, assigned_by) VALUES (r.entity_id, to_uid, true, app_uid())
        ON CONFLICT (client_org_id, user_id) DO UPDATE SET is_lead = true;
      -- Recorded as a change of lead, which tells the client's admins and the person leaving (0109).
      INSERT INTO client_lead_changes (client_org_id, firm_org_id, from_user_id, to_user_id, changed_by)
        VALUES (r.entity_id, org, from_uid, to_uid, app_uid());
      IF app_is_active_client(r.entity_id) THEN
        INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES (to_uid, 'client.lead', 'organization', r.entity_id);
      END IF;
      k := k + 1;
    END LOOP;
    PERFORM set_config('selah.hand_over', '', true);
    moved := moved + k;
    counts := counts || jsonb_build_object('client_lead', k);
  END IF;

  IF 'project_lead' = ANY (kinds) THEN
    k := 0;
    FOR r IN SELECT h.entity_id FROM app_person_holdings_of(from_uid) h WHERE h.kind = 'project_lead' LOOP
      UPDATE project_members SET is_lead = false WHERE project_id = r.entity_id AND user_id = from_uid;
      INSERT INTO project_members (project_id, user_id, is_lead, added_by) VALUES (r.entity_id, to_uid, true, app_uid())
        ON CONFLICT (project_id, user_id) DO UPDATE SET is_lead = true, observer = false;
      k := k + 1;
    END LOOP;
    moved := moved + k;
    counts := counts || jsonb_build_object('project_lead', k);
  END IF;

  IF 'client_role' = ANY (kinds) THEN
    k := 0;
    FOR r IN SELECT x.* FROM project_client_roles x JOIN app_person_holdings_of(from_uid) h ON h.kind = 'client_role' AND h.entity_id = x.id LOOP
      DELETE FROM project_client_roles WHERE id = r.id;
      IF NOT EXISTS (SELECT 1 FROM project_client_roles x WHERE x.project_id = r.project_id AND x.role = r.role AND x.user_id = to_uid) THEN
        INSERT INTO project_client_roles (project_id, org_id, role, user_id, created_by) VALUES (r.project_id, r.org_id, r.role, to_uid, app_uid());
      END IF;
      k := k + 1;
    END LOOP;
    moved := moved + k;
    counts := counts || jsonb_build_object('client_role', k);
  END IF;

  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
    VALUES (app_uid(), org, 'membership.hand_over', 'user', from_uid, 'allow', counts || jsonb_build_object('to', to_uid));
  RETURN moved;
END $$;
