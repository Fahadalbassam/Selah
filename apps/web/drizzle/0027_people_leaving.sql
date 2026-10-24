-- Hand-written (wave 1, item 26): when people leave or change.
--
-- Deactivation used to end sessions but keep the person's work: their open
-- actions, the clients they led, the projects they led and the reviews only
-- they could do sat orphaned until a rule flagged them. Now an admin sees
-- what the person still holds, hands it over in one step, and only then can
-- switch the account off. There is always at least one active firm admin,
-- and a client with consultants always has a lead.
--
-- 1. Who may look at and hand over someone's work: the firm admin for anyone
--    in an organisation they can see, a client admin for their own people.
CREATE FUNCTION app_can_manage_person(uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_memberships m
    WHERE m.user_id = uid
      AND ((app_role() = 'firm_admin' AND app_can_see_org(m.org_id)) OR (app_role() = 'client_admin' AND m.org_id = app_org()))
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_manage_person(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_manage_person(uuid) TO selah_app;
--> statement-breakpoint
-- 2. What a person still holds. Blocking items stop the account being
--    switched off until they are handed over; the rest (client roles such as
--    sponsor, department head) are listed so the admin names an interim.
--    Closed projects are left alone: their open items already carry a
--    disposition.
CREATE FUNCTION app_person_holdings_of(uid uuid)
RETURNS TABLE (kind text, entity_id uuid, project_id uuid, org_id uuid, title text, detail text, blocking boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- open actions they own
  SELECT 'action', a.id, a.project_id, a.org_id, a.title, a.status::text, true
  FROM actions a JOIN projects p ON p.id = a.project_id
  WHERE a.owner_user_id = uid AND a.status NOT IN ('verified_complete', 'closed') AND p.state <> 'closed'
  UNION ALL
  -- clients they lead (prospects included: whoever pitched leads them)
  SELECT 'client_lead', o.id, NULL, o.id, o.name, o.name_ar, true
  FROM client_assignments ca JOIN organizations o ON o.id = ca.client_org_id
  WHERE ca.user_id = uid AND ca.is_lead AND o.status = 'active'
  UNION ALL
  -- projects they lead
  SELECT 'project_lead', p.id, p.id, p.org_id, p.title, p.state::text, true
  FROM project_members pm JOIN projects p ON p.id = pm.project_id
  WHERE pm.user_id = uid AND pm.is_lead AND p.state <> 'closed'
  UNION ALL
  -- work waiting for review that only they can do: they are staffed on the
  -- project or lead its client, and no other active firm person is (being
  -- on the client's team alone does not open its projects)
  SELECT 'review', a.id, a.project_id, a.org_id, a.title, NULL, true
  FROM actions a JOIN projects p ON p.id = a.project_id
  WHERE a.status = 'awaiting_review' AND p.state <> 'closed'
    AND EXISTS (
      SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = uid
      UNION ALL
      SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = p.org_id AND ca.user_id = uid AND ca.is_lead AND p.kind = 'client'
    )
    AND NOT EXISTS (
      SELECT 1 FROM (
        SELECT pm.user_id FROM project_members pm WHERE pm.project_id = p.id
        UNION
        SELECT ca.user_id FROM client_assignments ca WHERE ca.client_org_id = p.org_id AND ca.is_lead AND p.kind = 'client'
      ) other
      JOIN org_memberships m ON m.user_id = other.user_id AND m.org_id = p.firm_org_id AND m.active
      WHERE other.user_id <> uid
    )
  UNION ALL
  -- named client roles (sponsor, coordinator, ...)
  SELECT 'client_role', r.id, r.project_id, r.org_id, p.title, r.role::text, false
  FROM project_client_roles r JOIN projects p ON p.id = r.project_id
  WHERE r.user_id = uid AND p.state <> 'closed'
  UNION ALL
  -- departments they head
  SELECT 'department_head', d.id, NULL, d.org_id, coalesce(d.name_en, d.name_ar), d.name_ar, false
  FROM department_members dm JOIN departments d ON d.id = dm.department_id
  WHERE dm.user_id = uid AND dm.is_head
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_person_holdings_of(uuid) FROM PUBLIC;
--> statement-breakpoint
-- The departing-person report, for whoever may manage the person.
CREATE FUNCTION app_person_holdings(uid uuid)
RETURNS TABLE (kind text, entity_id uuid, project_id uuid, org_id uuid, title text, detail text, blocking boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT h.* FROM app_person_holdings_of(uid) h WHERE app_can_manage_person(uid)
  ORDER BY h.blocking DESC, h.kind, h.title
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_person_holdings(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_person_holdings(uuid) TO selah_app;
--> statement-breakpoint
-- 3. Switching an account off is refused while the person still holds
--    blocking work, and the last active firm admin is never switched off.
--    Jobs and migrations (no uid) are not stopped.
CREATE FUNCTION check_departure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF OLD.active AND NOT NEW.active AND app_uid() IS NOT NULL THEN
    IF NEW.role = 'firm_admin' AND NOT EXISTS (
      SELECT 1 FROM org_memberships m WHERE m.org_id = NEW.org_id AND m.role = 'firm_admin' AND m.active AND m.user_id <> NEW.user_id
    ) THEN
      RAISE EXCEPTION 'the firm needs at least one active admin' USING ERRCODE = 'check_violation';
    END IF;
    SELECT count(*) INTO n FROM app_person_holdings_of(NEW.user_id) h WHERE h.blocking;
    IF n > 0 THEN
      RAISE EXCEPTION 'hand over what this person still holds before switching the account off (% items)', n USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER membership_departure BEFORE UPDATE OF active ON org_memberships
  FOR EACH ROW EXECUTE FUNCTION check_departure();
--> statement-breakpoint
-- 4. A client that has consultants always has a lead. Checked at commit, so
--    moving the lead (unset the old, set the new) works in one transaction.
CREATE FUNCTION check_client_has_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c uuid := coalesce(NEW.client_org_id, OLD.client_org_id);
BEGIN
  IF EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = c)
     AND NOT EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = c AND ca.is_lead)
     AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = c AND o.status = 'active') THEN
    RAISE EXCEPTION 'every client with consultants needs a lead consultant' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER client_keeps_lead AFTER UPDATE OF is_lead OR DELETE ON client_assignments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_client_has_lead();
--> statement-breakpoint
-- 5. Hand over in one step: open actions (the new owner joins the project
--    team), clients and projects led, reviews only they could do (the new
--    person joins those projects), and named client roles. The receiver is
--    an active member of the same organisation; the database's own rules on
--    each record (roles, client roles, closed projects) still apply.
--    Returns how many records moved; the audit log keeps the counts.
CREATE FUNCTION app_hand_over(from_uid uuid, to_uid uuid, kinds text[]) RETURNS integer
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
      ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS k = ROW_COUNT;
    moved := moved + k;
    counts := counts || jsonb_build_object('review', k);
  END IF;

  IF 'client_lead' = ANY (kinds) THEN
    k := 0;
    FOR r IN SELECT h.entity_id FROM app_person_holdings_of(from_uid) h WHERE h.kind = 'client_lead' LOOP
      UPDATE client_assignments SET is_lead = false WHERE client_org_id = r.entity_id AND user_id = from_uid;
      INSERT INTO client_assignments (client_org_id, user_id, is_lead, assigned_by) VALUES (r.entity_id, to_uid, true, app_uid())
        ON CONFLICT (client_org_id, user_id) DO UPDATE SET is_lead = true;
      k := k + 1;
    END LOOP;
    moved := moved + k;
    counts := counts || jsonb_build_object('client_lead', k);
  END IF;

  IF 'project_lead' = ANY (kinds) THEN
    k := 0;
    FOR r IN SELECT h.entity_id FROM app_person_holdings_of(from_uid) h WHERE h.kind = 'project_lead' LOOP
      UPDATE project_members SET is_lead = false WHERE project_id = r.entity_id AND user_id = from_uid;
      INSERT INTO project_members (project_id, user_id, is_lead, added_by) VALUES (r.entity_id, to_uid, true, app_uid())
        ON CONFLICT (project_id, user_id) DO UPDATE SET is_lead = true;
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
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_hand_over(uuid, uuid, text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_hand_over(uuid, uuid, text[]) TO selah_app;
