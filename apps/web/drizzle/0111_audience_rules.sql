-- Who sees an item (decision of 17 Nov 2026, feature A, part 2): the rules.
--
-- An item (a document of any kind but evidence, or a meeting) can be narrowed
-- to "everyone with access, except…" or "only these people…" (tables in
-- 0110). It only ever takes people away. The effective rule is
--   (today's rules OR a one-by-one share) AND NOT left out AND (no "only"
--   list, OR on it)
-- so every policy here is RESTRICTIVE: it is AND-ed onto the policies that
-- already decide, and never lets anyone in. Some people always see an item,
-- worked out live from the item and the client (never stored at save time):
-- the person who set the audience, whoever uploaded any version of the file,
-- the client's admin (on anything the client can see), the firm admin (on the
-- firm's items), the client's lead and deputy, and a meeting's organiser and
-- required attendees. On a client's own item the client chooses among its
-- own people only: the firm's people are never left out of it.
--
-- 1. Small helpers. A file's versions share one audience: every row of the
--    chain carries the same item_audiences rows.
CREATE FUNCTION app_document_versions(doc uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH RECURSIVE up AS (
    SELECT d.id, d.supersedes_id FROM documents d WHERE d.id = doc
    UNION
    SELECT d.id, d.supersedes_id FROM documents d JOIN up ON d.id = up.supersedes_id
  ), down AS (
    SELECT up.id FROM up WHERE up.supersedes_id IS NULL
    UNION
    SELECT d.id FROM documents d JOIN down ON d.supersedes_id = down.id
  )
  SELECT id FROM down
  UNION
  SELECT doc WHERE EXISTS (SELECT 1 FROM documents d WHERE d.id = doc)
$$;
--> statement-breakpoint
CREATE FUNCTION app_audience_project(kind text, item uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE kind
    WHEN 'document' THEN (SELECT d.project_id FROM documents d WHERE d.id = item)
    WHEN 'meeting' THEN (SELECT m.project_id FROM meetings m WHERE m.id = item)
  END
$$;
--> statement-breakpoint
-- Whose item it is: a firm upload or a firm-booked meeting is the firm's; a
-- client upload or a meeting a client person booked is the client's.
CREATE FUNCTION app_audience_side(kind text, item uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE kind
    WHEN 'document' THEN (
      SELECT CASE WHEN p.kind = 'client' AND d.owner_org_id = p.org_id THEN 'client' ELSE 'firm' END
      FROM documents d JOIN projects p ON p.id = d.project_id WHERE d.id = item)
    WHEN 'meeting' THEN (
      SELECT CASE WHEN p.kind = 'client' AND EXISTS (
               SELECT 1 FROM org_memberships om WHERE om.user_id = m.organizer_id AND om.org_id = p.org_id) THEN 'client' ELSE 'firm' END
      FROM meetings m JOIN projects p ON p.id = m.project_id WHERE m.id = item)
  END
$$;
--> statement-breakpoint
-- A text that may hold an id (activity_events.meta), as one, or nothing.
CREATE FUNCTION app_try_uuid(t text) RETURNS uuid
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN t::uuid END
$$;
--> statement-breakpoint
-- 2. Why a person always sees an item, or NULL. Worked out from what the item
--    and the client are now, so a new lead or deputy is never shut out of an
--    "only" list saved before they joined. The reasons are the picker's
--    (lib/audience.ts, AUDIENCE_LOCK_REASONS), in its order.
CREATE FUNCTION app_audience_lock_of(target uuid, item_kind text, pid uuid, vis visibility, side text, setter uuid,
  uploaders uuid[], organizer uuid, required uuid[]) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN target IS NULL THEN NULL
    WHEN target = setter THEN 'self'
    WHEN item_kind = 'document' AND target = ANY (coalesce(uploaders, '{}')) THEN 'uploader'
    WHEN p.kind = 'client' AND vis IN ('shared', 'client_private') AND EXISTS (
      SELECT 1 FROM org_memberships m WHERE m.user_id = target AND m.org_id = p.org_id AND m.active AND m.role = 'client_admin') THEN 'clientAdmin'
    WHEN side = 'firm' AND EXISTS (
      SELECT 1 FROM org_memberships m WHERE m.user_id = target AND m.org_id = p.firm_org_id AND m.active AND m.role = 'firm_admin') THEN 'firmAdmin'
    WHEN p.kind = 'client' AND EXISTS (
      SELECT 1 FROM client_assignments ca JOIN org_memberships m ON m.user_id = ca.user_id AND m.org_id = p.firm_org_id AND m.active
      WHERE ca.client_org_id = p.org_id AND ca.user_id = target AND ca.is_lead) THEN 'lead'
    WHEN p.kind = 'client' AND EXISTS (
      SELECT 1 FROM client_assignments ca JOIN org_memberships m ON m.user_id = ca.user_id AND m.org_id = p.firm_org_id AND m.active
      WHERE ca.client_org_id = p.org_id AND ca.user_id = target AND ca.is_deputy) THEN 'deputy'
    WHEN item_kind = 'meeting' AND target = organizer THEN 'organiser'
    WHEN item_kind = 'meeting' AND target = ANY (coalesce(required, '{}')) THEN 'requiredAttendee'
  END
  FROM projects p WHERE p.id = pid
$$;
--> statement-breakpoint
-- The same for an item that exists. vis_as asks "if the file were shared"
-- (the firm sharing a deliverable with the client picks the audience first).
CREATE FUNCTION app_audience_lock(kind text, item uuid, target uuid, setter uuid, vis_as visibility DEFAULT NULL) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE kind
    WHEN 'document' THEN (
      SELECT app_audience_lock_of(target, 'document', d.project_id, coalesce(vis_as, d.visibility), app_audience_side('document', d.id), setter,
               ARRAY(SELECT x.uploaded_by FROM documents x WHERE x.id IN (SELECT app_document_versions(d.id))), NULL, NULL)
      FROM documents d WHERE d.id = item)
    WHEN 'meeting' THEN (
      SELECT app_audience_lock_of(target, 'meeting', m.project_id, m.visibility, app_audience_side('meeting', m.id), setter, NULL, m.organizer_id,
               ARRAY(SELECT a.user_id FROM meeting_attendees a WHERE a.meeting_id = m.id AND a.role = 'required' AND a.user_id IS NOT NULL))
      FROM meetings m WHERE m.id = item)
  END
$$;
--> statement-breakpoint
-- Locked, or one of the firm's people on a client's own item (a client
-- cannot hide its items from the firm this way; client_private does that).
CREATE FUNCTION app_audience_locked(item_kind text, item uuid, uid uuid, setter uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_audience_lock(item_kind, item, uid, setter) IS NOT NULL
    OR (app_audience_side(item_kind, item) = 'client' AND EXISTS (
          SELECT 1 FROM projects p JOIN org_memberships om ON om.org_id = p.firm_org_id AND om.user_id = uid AND om.active
          WHERE p.id = app_audience_project(item_kind, item)))
$$;
--> statement-breakpoint
-- 3. THE check, for the row policies below and every definer function that
--    reads these items past row-level security. No audience: true. Left out
--    ("except" and on the list, or "only" and not on it): false, unless the
--    person always sees the item.
CREATE FUNCTION app_audience_ok(kind text, item uuid, uid uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a item_audiences%ROWTYPE; listed boolean;
BEGIN
  IF item IS NULL THEN RETURN true; END IF;
  SELECT * INTO a FROM item_audiences x WHERE x.item_type = kind AND x.item_id = item;
  IF NOT FOUND THEN RETURN true; END IF;
  IF uid IS NULL THEN RETURN false; END IF;
  listed := EXISTS (SELECT 1 FROM item_audience_people x WHERE x.item_type = kind AND x.item_id = item AND x.user_id = uid);
  IF (a.mode = 'except') <> listed THEN RETURN true; END IF;
  RETURN app_audience_locked(kind, item, uid, a.set_by);
END $$;
--> statement-breakpoint
-- The records that belong to an item (activity, notices, translations,
-- passages), by the entity they name.
CREATE FUNCTION app_audience_entity_ok(etype text, eid uuid, uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE etype
    WHEN 'document' THEN app_audience_ok('document', eid, uid)
    WHEN 'meeting' THEN app_audience_ok('meeting', eid, uid)
    WHEN 'meeting_summary' THEN app_audience_ok('meeting', eid, uid)
    WHEN 'meeting_decision' THEN app_audience_ok('meeting', (SELECT d.meeting_id FROM meeting_decisions d WHERE d.id = eid), uid)
    WHEN 'meeting_note' THEN app_audience_ok('meeting', (SELECT n.meeting_id FROM meeting_notes n WHERE n.id = eid), uid)
    WHEN 'follow_up' THEN app_audience_ok('meeting', (SELECT f.meeting_id FROM follow_ups f WHERE f.id = eid), uid)
    ELSE true
  END
$$;
--> statement-breakpoint
-- 4. Whether a person could open an item by the rules before any audience
--    (project, label, department, shares; an action owner's files: her own,
--    her department's and those shared with her, as authorize() says). The
--    picker offers only these people, and the server refuses anyone else.
--    A person opens the project as app_can_see_project() says for the caller:
--    app_user_sees_project() (baseline), and the client's deputy too (0051).
CREATE FUNCTION app_user_opens_project(target uuid, pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_user_sees_project(target, pid) OR EXISTS (
    SELECT 1 FROM projects p
    JOIN client_assignments ca ON ca.client_org_id = p.org_id AND ca.user_id = target AND (ca.is_lead OR ca.is_deputy)
    JOIN org_memberships m ON m.user_id = target AND m.org_id = p.firm_org_id AND m.active AND m.role = 'consultant'
    WHERE p.id = pid AND p.kind = 'client')
$$;
--> statement-breakpoint
CREATE FUNCTION app_user_sees_file(target uuid, pid uuid, row_org uuid, vis visibility, dept uuid, uploader uuid,
  doc_purpose document_purpose, doc_state document_state, shared boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT app_user_opens_project(target, pid)
      AND (m.org_id = p.firm_org_id OR p.state::text <> 'draft')
      AND CASE vis
            WHEN 'shared' THEN true
            WHEN 'firm_private' THEN m.org_id = p.firm_org_id
            WHEN 'client_private' THEN p.kind = 'client' AND m.org_id = row_org
            WHEN 'user_private' THEN uploader = target
            ELSE false
          END
      AND (doc_state <> 'draft' OR doc_purpose <> 'evidence' OR uploader = target)
      AND (dept IS NULL OR NOT o.departments_enabled OR m.org_id = p.firm_org_id
           OR (m.role = 'client_admin' AND m.org_id = row_org) OR uploader = target OR shared
           OR EXISTS (SELECT 1 FROM department_members dm WHERE dm.department_id = dept AND dm.user_id = target))
      AND (m.role <> 'action_owner' OR uploader = target OR shared
           OR (dept IS NOT NULL AND EXISTS (SELECT 1 FROM department_members dm WHERE dm.department_id = dept AND dm.user_id = target)))
    FROM projects p
    JOIN organizations o ON o.id = row_org
    JOIN org_memberships m ON m.user_id = target AND m.active AND m.org_id IN (p.firm_org_id, p.org_id)
    WHERE p.id = pid
    ORDER BY m.org_id = p.firm_org_id DESC
    LIMIT 1
  ), false)
$$;
--> statement-breakpoint
CREATE FUNCTION app_user_sees_document(target uuid, doc uuid, vis_as visibility DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT app_user_sees_file(target, d.project_id, d.org_id, coalesce(vis_as, d.visibility), d.department_id, d.uploaded_by, d.purpose, d.state,
             EXISTS (SELECT 1 FROM document_shares s WHERE s.document_id = d.id AND s.user_id = target))
    FROM documents d WHERE d.id = doc
  ), false)
$$;
--> statement-breakpoint
-- A meeting: project, label, the department rule (0070) and the
-- whole-project rule (0082, 0084), for anyone.
CREATE FUNCTION app_user_sees_meeting_as(target uuid, pid uuid, vis visibility, dept uuid, organizer uuid, attends boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT app_user_opens_project(target, pid)
      AND (m.org_id = p.firm_org_id OR p.state::text <> 'draft')
      AND (vis = 'shared' OR (vis = 'firm_private' AND m.org_id = p.firm_org_id))
      AND (dept IS NULL OR NOT o.departments_enabled OR m.org_id = p.firm_org_id
           OR (m.role = 'client_admin' AND m.org_id = p.org_id) OR organizer = target OR attends
           OR EXISTS (SELECT 1 FROM department_members dm WHERE dm.department_id = dept AND dm.user_id = target))
      AND (dept IS NOT NULL OR app_user_sees_whole_project(target, pid) OR (m.role = 'action_owner' AND attends))
    FROM projects p
    JOIN organizations o ON o.id = p.org_id
    JOIN org_memberships m ON m.user_id = target AND m.active AND m.org_id IN (p.firm_org_id, p.org_id)
    WHERE p.id = pid
    ORDER BY m.org_id = p.firm_org_id DESC
    LIMIT 1
  ), false)
$$;
--> statement-breakpoint
CREATE FUNCTION app_user_sees_meeting(target uuid, mid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT app_user_sees_meeting_as(target, m.project_id, m.visibility, m.department_id, m.organizer_id,
             EXISTS (SELECT 1 FROM meeting_attendees a WHERE a.meeting_id = m.id AND a.user_id = target))
    FROM meetings m WHERE m.id = mid
  ), false)
$$;
--> statement-breakpoint
CREATE FUNCTION app_user_sees_item(kind text, item uuid, target uuid, vis_as visibility DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE kind
    WHEN 'document' THEN app_user_sees_document(target, item, vis_as)
    WHEN 'meeting' THEN app_user_sees_meeting(target, item)
    ELSE false
  END
$$;
--> statement-breakpoint
-- 5. Who reads and changes an item's audience: on the firm's items, firm
--    staff who manage it (the file's owning side; for a meeting, who runs it);
--    on a client's own item, its admin. Never a client manager or an action
--    owner, never an observer, never someone left out of it. Evidence has none.
CREATE FUNCTION app_can_manage_audience(kind text, item uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE kind
    WHEN 'document' THEN coalesce((
      SELECT d.purpose <> 'evidence'
        AND app_can_see_project(d.project_id)
        AND app_label_ok(d.visibility, d.org_id, d.uploaded_by)
        AND (app_dept_ok(d.department_id, d.org_id) OR d.uploaded_by = app_uid() OR app_document_shared_with_me(d.id))
        AND app_audience_ok('document', d.id, app_uid())
        AND d.owner_org_id = app_org()
        AND ((app_org_kind() = 'firm' AND app_role() IN ('firm_admin', 'consultant')) OR app_role() = 'client_admin')
        AND NOT app_observes_project(d.project_id)
      FROM documents d WHERE d.id = item), false)
    WHEN 'meeting' THEN coalesce((
      SELECT app_can_see_meeting(m.id)
        AND app_audience_side('meeting', m.id) = CASE WHEN app_org_kind() = 'firm' THEN 'firm' ELSE 'client' END
        AND ((app_org_kind() = 'firm' AND app_role() IN ('firm_admin', 'consultant')) OR (app_role() = 'client_admin' AND m.org_id = app_org()))
        AND NOT app_observes_project(m.project_id)
      FROM meetings m WHERE m.id = item), false)
    ELSE false
  END
$$;
--> statement-breakpoint
-- 6. The people the picker offers: those who can already see the item,
--    firm first, with why each one always sees it (the caller is "self": a
--    save makes them its setter). On a client's own item, its people only.
CREATE FUNCTION app_audience_people(item_kind text, item uuid, vis_as visibility DEFAULT NULL)
RETURNS TABLE (user_id uuid, name text, firm boolean, locked text, listed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pid uuid := app_audience_project(item_kind, item); side text := app_audience_side(item_kind, item);
BEGIN
  IF NOT app_can_manage_audience(item_kind, item) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT u.id, u.name, mo.org_id = p.firm_org_id,
      app_audience_lock(item_kind, item, u.id, app_uid(), vis_as),
      EXISTS (SELECT 1 FROM item_audience_people x WHERE x.item_type = item_kind AND x.item_id = item AND x.user_id = u.id)
    FROM projects p
    JOIN org_memberships mo ON mo.active AND mo.org_id IN (p.firm_org_id, p.org_id)
    JOIN "user" u ON u.id = mo.user_id
    WHERE p.id = pid
      AND (side = 'firm' OR (p.kind = 'client' AND mo.org_id = p.org_id))
      AND app_user_sees_item(item_kind, item, u.id, vis_as)
    ORDER BY mo.org_id = p.firm_org_id DESC, u.name;
END $$;
--> statement-breakpoint
-- The same for an item not saved yet (a file being uploaded, a meeting being
-- booked by the caller), from what the form says. Saving checks again on the
-- item itself (app_set_audience).
CREATE FUNCTION app_audience_people_new(kind text, pid uuid, vis visibility, dept uuid, attendees uuid[], required uuid[])
RETURNS TABLE (user_id uuid, name text, firm boolean, locked text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p projects%ROWTYPE; side text;
BEGIN
  SELECT * INTO p FROM projects x WHERE x.id = pid;
  IF NOT FOUND OR NOT app_can_see_project(pid) OR app_observes_project(pid) OR kind NOT IN ('document', 'meeting')
     OR NOT ((app_org_kind() = 'firm' AND app_role() IN ('firm_admin', 'consultant')) OR app_role() = 'client_admin') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  side := CASE WHEN p.kind = 'client' AND app_org() = p.org_id THEN 'client' ELSE 'firm' END;
  RETURN QUERY
    SELECT u.id, u.name, mo.org_id = p.firm_org_id,
      app_audience_lock_of(u.id, kind, pid, vis, side, app_uid(), ARRAY[app_uid()], app_uid(),
        ARRAY(SELECT r FROM unnest(coalesce(required, '{}')) r WHERE r = ANY (coalesce(attendees, '{}'))))
    FROM org_memberships mo
    JOIN "user" u ON u.id = mo.user_id
    WHERE mo.active AND mo.org_id IN (p.firm_org_id, p.org_id)
      AND (side = 'firm' OR (p.kind = 'client' AND mo.org_id = p.org_id))
      AND CASE kind
            WHEN 'document' THEN app_user_sees_file(u.id, pid, p.org_id, vis, dept, app_uid(),
                   (CASE WHEN side = 'firm' THEN 'deliverable' ELSE 'client_document' END)::document_purpose, 'submitted', false)
            ELSE app_user_sees_meeting_as(u.id, pid, vis, dept, app_uid(), u.id = app_uid() OR u.id = ANY (coalesce(attendees, '{}')))
          END
    ORDER BY mo.org_id = p.firm_org_id DESC, u.name;
END $$;
--> statement-breakpoint
-- 7. Set, change or clear ("everyone") an item's audience. The only way to
--    write the two tables. Refuses: someone who may not manage it, a closed
--    project, an "only" list with nobody, a person who could not see the
--    item, on a client's item one of the firm's people, and leaving out
--    someone who always sees it. An "only" list keeps the people picked; the
--    ones who always see it are worked out live, so none is frozen in. Mail
--    about a meeting still queued for someone now left out is withdrawn, and
--    nobody is told about the change.
CREATE FUNCTION app_set_audience(kind text, item uuid, new_mode text, chosen uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  pid uuid := app_audience_project(kind, item);
  side text := app_audience_side(kind, item);
  ids uuid[];
  people uuid[];
  keep uuid[] := '{}';
  person uuid;
  firm_org uuid;
  row_org uuid;
BEGIN
  IF kind NOT IN ('document', 'meeting') OR pid IS NULL OR NOT app_can_manage_audience(kind, item) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT p.firm_org_id, p.org_id INTO firm_org, row_org FROM projects p WHERE p.id = pid;
  IF EXISTS (SELECT 1 FROM projects p WHERE p.id = pid AND p.state = 'closed') THEN
    RAISE EXCEPTION 'this project is closed' USING ERRCODE = 'SL400';
  END IF;
  ids := CASE kind WHEN 'document' THEN ARRAY(SELECT app_document_versions(item)) ELSE ARRAY[item] END;
  IF new_mode = 'everyone' THEN
    DELETE FROM item_audiences WHERE item_type = kind AND item_id = ANY (ids);
    RETURN;
  END IF;
  IF new_mode IS NULL OR new_mode NOT IN ('except', 'only') THEN
    RAISE EXCEPTION 'choose everyone, everyone except, or only' USING ERRCODE = 'SL400';
  END IF;
  people := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(chosen, '{}')) x WHERE x IS NOT NULL);
  IF new_mode = 'only' AND cardinality(people) = 0 THEN
    RAISE EXCEPTION 'an "only" list needs at least one person' USING ERRCODE = 'SL400';
  END IF;
  FOREACH person IN ARRAY people LOOP
    IF NOT app_user_sees_item(kind, item, person) THEN
      RAISE EXCEPTION 'pick only people who can already see it' USING ERRCODE = 'SL400';
    END IF;
    IF side = 'client' AND NOT EXISTS (
      SELECT 1 FROM org_memberships om WHERE om.user_id = person AND om.org_id = row_org AND om.active) THEN
      RAISE EXCEPTION 'on your company''s own items, choose among your company''s people' USING ERRCODE = 'SL400';
    END IF;
    IF app_audience_lock(kind, item, person, app_uid()) IS NOT NULL THEN
      IF new_mode = 'except' THEN
        RAISE EXCEPTION 'that person always sees it and cannot be left out' USING ERRCODE = 'SL400';
      END IF;
    ELSE
      keep := keep || person;
    END IF;
  END LOOP;
  INSERT INTO item_audiences (org_id, item_type, item_id, mode, set_by, set_at)
    SELECT row_org, kind, i, new_mode, app_uid(), now() FROM unnest(ids) i
  ON CONFLICT (item_type, item_id) DO UPDATE SET mode = EXCLUDED.mode, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at;
  DELETE FROM item_audience_people WHERE item_type = kind AND item_id = ANY (ids);
  INSERT INTO item_audience_people (item_type, item_id, user_id)
    SELECT kind, i, x FROM unnest(ids) i, unnest(keep) x;
  IF kind = 'meeting' THEN
    DELETE FROM outbound_emails o
    WHERE o.meeting_id = item AND o.sent_at IS NULL AND o.failed_at IS NULL
      AND EXISTS (SELECT 1 FROM "user" u WHERE lower(u.email) = lower(o.to_email) AND NOT app_audience_ok('meeting', item, u.id));
  END IF;
END $$;
--> statement-breakpoint
-- 8. What the caller's own screens need about items they already see: which
--    are narrowed (the "Limited audience" marker), and enough about the
--    caller alone for authorize()'s sixth question. Never who else is on it.
CREATE FUNCTION app_audience_mine(kind text, ids uuid[]) RETURNS TABLE (item_id uuid, mode text, listed boolean, locked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.item_id, a.mode,
    EXISTS (SELECT 1 FROM item_audience_people x WHERE x.item_type = a.item_type AND x.item_id = a.item_id AND x.user_id = app_uid()),
    app_audience_locked(a.item_type, a.item_id, app_uid(), a.set_by)
  FROM item_audiences a
  WHERE a.item_type = kind AND a.item_id = ANY (ids) AND app_can_see_project(app_audience_project(a.item_type, a.item_id))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_document_versions(uuid), app_audience_project(text, uuid), app_audience_side(text, uuid), app_try_uuid(text),
  app_audience_lock_of(uuid, text, uuid, visibility, text, uuid, uuid[], uuid, uuid[]), app_audience_lock(text, uuid, uuid, uuid, visibility),
  app_audience_locked(text, uuid, uuid, uuid), app_audience_ok(text, uuid, uuid), app_audience_entity_ok(text, uuid, uuid),
  app_user_opens_project(uuid, uuid), app_user_sees_file(uuid, uuid, uuid, visibility, uuid, uuid, document_purpose, document_state, boolean),
  app_user_sees_document(uuid, uuid, visibility), app_user_sees_meeting_as(uuid, uuid, visibility, uuid, uuid, boolean),
  app_user_sees_meeting(uuid, uuid), app_user_sees_item(text, uuid, uuid, visibility), app_can_manage_audience(text, uuid),
  app_audience_people(text, uuid, visibility), app_audience_people_new(text, uuid, visibility, uuid, uuid[], uuid[]),
  app_set_audience(text, uuid, text, uuid[]), app_audience_mine(text, uuid[]) FROM PUBLIC;
--> statement-breakpoint
-- The policies call the first four as the app role; the services the rest
-- (app_audience_side says only whose item it is, the firm's or the client's).
GRANT EXECUTE ON FUNCTION app_try_uuid(text), app_audience_ok(text, uuid, uuid), app_audience_entity_ok(text, uuid, uuid),
  app_can_manage_audience(text, uuid), app_audience_side(text, uuid), app_audience_people(text, uuid, visibility),
  app_audience_people_new(text, uuid, visibility, uuid, uuid[], uuid[]), app_set_audience(text, uuid, text, uuid[]),
  app_audience_mine(text, uuid[]) TO selah_app;
--> statement-breakpoint
-- 9. The two tables: read by whoever manages the item; written only by
--    app_set_audience(), which asks the same rule and the checks above.
GRANT SELECT ON item_audiences, item_audience_people TO selah_app;
--> statement-breakpoint
ALTER TABLE item_audiences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE item_audience_people ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY manage_read ON item_audiences FOR SELECT TO selah_app USING (app_can_manage_audience(item_type, item_id));
--> statement-breakpoint
CREATE POLICY manage_read ON item_audience_people FOR SELECT TO selah_app USING (app_can_manage_audience(item_type, item_id));
--> statement-breakpoint
-- 10. Triggers. The audience goes with its item; a new version of a file
--     takes the file's audience.
CREATE FUNCTION drop_item_audience() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM item_audiences WHERE item_type = TG_ARGV[0] AND item_id = OLD.id;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION copy_item_audience() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO item_audiences (org_id, item_type, item_id, mode, set_by, set_at)
    SELECT a.org_id, 'document', NEW.id, a.mode, a.set_by, a.set_at FROM item_audiences a
    WHERE a.item_type = 'document' AND a.item_id = NEW.supersedes_id
  ON CONFLICT DO NOTHING;
  INSERT INTO item_audience_people (item_type, item_id, user_id)
    SELECT 'document', NEW.id, x.user_id FROM item_audience_people x
    WHERE x.item_type = 'document' AND x.item_id = NEW.supersedes_id
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- Left out beats a share, an invitation and a follow-up: each is refused for
-- someone left out, and none silently lifts the exclusion.
CREATE FUNCTION check_audience_share() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app_audience_ok('document', NEW.document_id, NEW.user_id) THEN
    RAISE EXCEPTION 'that person is left out of this file: change who sees it before sharing it with them' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION check_audience_attendee() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.role IS DISTINCT FROM OLD.role)
     AND NOT app_audience_ok('meeting', NEW.meeting_id, NEW.user_id) THEN
    RAISE EXCEPTION 'that person is left out of this meeting: change who sees it before inviting them' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION check_audience_follow_up() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.meeting_id IS NOT NULL AND NEW.assignee_user_id IS NOT NULL
     AND NOT app_audience_ok('meeting', NEW.meeting_id, NEW.assignee_user_id) THEN
    RAISE EXCEPTION 'that person is left out of this meeting: pick someone who sees it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Nobody is ever told about an item they are left out of.
CREATE FUNCTION drop_left_out_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app_audience_entity_ok(NEW.entity_type, NEW.entity_id, NEW.user_id) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION drop_item_audience(), copy_item_audience(), check_audience_share(), check_audience_attendee(),
  check_audience_follow_up(), drop_left_out_notification() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER item_audience_gone AFTER DELETE ON documents FOR EACH ROW EXECUTE FUNCTION drop_item_audience('document');
--> statement-breakpoint
CREATE TRIGGER item_audience_gone AFTER DELETE ON meetings FOR EACH ROW EXECUTE FUNCTION drop_item_audience('meeting');
--> statement-breakpoint
CREATE TRIGGER item_audience_version AFTER INSERT ON documents FOR EACH ROW WHEN (NEW.supersedes_id IS NOT NULL)
  EXECUTE FUNCTION copy_item_audience();
--> statement-breakpoint
CREATE TRIGGER audience_share BEFORE INSERT ON document_shares FOR EACH ROW EXECUTE FUNCTION check_audience_share();
--> statement-breakpoint
CREATE TRIGGER audience_attendee BEFORE INSERT OR UPDATE OF role ON meeting_attendees FOR EACH ROW EXECUTE FUNCTION check_audience_attendee();
--> statement-breakpoint
CREATE TRIGGER audience_follow_up BEFORE INSERT OR UPDATE OF assignee_user_id, meeting_id ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION check_audience_follow_up();
--> statement-breakpoint
CREATE TRIGGER drop_left_out_notification BEFORE INSERT ON notifications FOR EACH ROW
  WHEN (NEW.entity_type IN ('document', 'meeting', 'meeting_summary', 'meeting_decision', 'meeting_note', 'follow_up'))
  EXECUTE FUNCTION drop_left_out_notification();
--> statement-breakpoint
-- 11. The restrictive policies: on each table that gets the picker and on
--     every table under those items. RESTRICTIVE, so they only take away.
CREATE POLICY audience ON documents AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_audience_ok('document', id, app_uid()));
--> statement-breakpoint
CREATE POLICY audience ON document_shares AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_audience_ok('document', document_id, app_uid()));
--> statement-breakpoint
CREATE POLICY audience ON document_summaries AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_audience_ok('document', document_id, app_uid()));
--> statement-breakpoint
CREATE POLICY audience ON info_request_files AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_audience_ok('document', document_id, app_uid()));
--> statement-breakpoint
CREATE POLICY audience ON assessment_evidence AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_audience_ok('document', document_id, app_uid()));
--> statement-breakpoint
CREATE POLICY audience ON meetings AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_audience_ok('meeting', id, app_uid()));
--> statement-breakpoint
CREATE POLICY audience ON meeting_attendees AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_audience_ok('meeting', meeting_id, app_uid()));
--> statement-breakpoint
CREATE POLICY audience ON meeting_decisions AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_audience_ok('meeting', meeting_id, app_uid()));
--> statement-breakpoint
CREATE POLICY audience ON meeting_summaries AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_audience_ok('meeting', meeting_id, app_uid()));
--> statement-breakpoint
CREATE POLICY audience ON meeting_summary_sources AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_audience_ok('meeting', meeting_id, app_uid()) AND app_audience_ok('document', document_id, app_uid()));
--> statement-breakpoint
CREATE POLICY audience ON meeting_transcripts AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_audience_ok('meeting', meeting_id, app_uid()));
--> statement-breakpoint
CREATE POLICY audience ON meeting_notes AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_audience_ok('meeting', meeting_id, app_uid()));
--> statement-breakpoint
CREATE POLICY audience ON follow_ups AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_audience_ok('meeting', meeting_id, app_uid()));
--> statement-breakpoint
CREATE POLICY audience ON ai_chunks AS RESTRICTIVE FOR ALL TO selah_app
  USING (CASE source_type
    WHEN 'document' THEN app_audience_ok('document', source_id, app_uid())
    WHEN 'meeting_note' THEN app_audience_entity_ok('meeting_note', source_id, app_uid())
    ELSE true
  END);
--> statement-breakpoint
CREATE POLICY audience ON content_translations AS RESTRICTIVE FOR ALL TO selah_app
  USING (CASE WHEN entity_type IN ('document', 'meeting', 'meeting_summary', 'meeting_decision', 'meeting_note', 'follow_up')
    THEN app_audience_entity_ok(entity_type, entity_id, app_uid()) ELSE true END);
--> statement-breakpoint
-- activity_events keeps its own copy of the label; it gets the audience too,
-- for an event about the item and for one that names a file in its details.
CREATE POLICY audience ON activity_events AS RESTRICTIVE FOR ALL TO selah_app
  USING (
    CASE WHEN entity_type IN ('document', 'meeting', 'meeting_summary', 'meeting_decision', 'meeting_note', 'follow_up')
      THEN app_audience_entity_ok(entity_type, entity_id, app_uid()) ELSE true END
    AND CASE WHEN meta ? 'documentId' THEN app_audience_ok('document', app_try_uuid(meta ->> 'documentId'), app_uid()) ELSE true END
  );
--> statement-breakpoint
CREATE POLICY audience ON notifications AS RESTRICTIVE FOR SELECT TO selah_app
  USING (CASE WHEN entity_type IN ('document', 'meeting', 'meeting_summary', 'meeting_decision', 'meeting_note', 'follow_up')
    THEN app_audience_entity_ok(entity_type, entity_id, app_uid()) ELSE true END);
--> statement-breakpoint
-- 12. The definer functions that read these items past row-level security
--     ask the same check.
--
-- Whether the caller opens a meeting (latest: 0082). Attendees, decisions,
-- summaries, summary sources, transcripts, the agenda and running a meeting
-- all ask it.
CREATE OR REPLACE FUNCTION app_can_see_meeting(mid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM meetings m
    WHERE m.id = mid AND app_can_see_project(m.project_id) AND app_label_ok(m.visibility, m.org_id, m.organizer_id)
      AND app_meeting_dept_ok(m.id, m.department_id, m.org_id, m.organizer_id)
      AND app_meeting_whole_ok(m.id, m.project_id, m.department_id)
      AND app_audience_ok('meeting', m.id, app_uid())
  )
$$;
--> statement-breakpoint
-- Follow-ups and notes of a meeting (latest: 0082).
CREATE OR REPLACE FUNCTION app_meeting_open_to_me(mid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT app_meeting_dept_ok(m.id, m.department_id, m.org_id, m.organizer_id) AND app_meeting_whole_ok(m.id, m.project_id, m.department_id)
      AND app_audience_ok('meeting', m.id, app_uid())
    FROM meetings m WHERE m.id = mid
  ), true)
$$;
--> statement-breakpoint
-- The live agenda for one reader (latest: 0085): "changed since the last
-- meeting" counts from the last held meeting that reader may open, so a
-- meeting she is left out of never moves her list.
CREATE OR REPLACE FUNCTION app_meeting_agenda(pid uuid, before timestamptz, lang text, dept uuid, reader uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  -- At booking, today; for one reader, the meeting's day when it is past.
  today date := CASE WHEN reader IS NULL THEN app_firm_today() ELSE least(app_firm_today(), app_firm_date(before)) END;
  last_held timestamptz := (SELECT max(m.starts_at) FROM meetings m WHERE m.project_id = pid AND m.status = 'held' AND m.starts_at < before
                              AND (reader IS NULL OR app_audience_ok('meeting', m.id, reader)));
  out text := '';
  part text;
  en boolean := lang = 'en';
  l text := CASE WHEN lang = 'en' THEN 'en' ELSE 'ar' END;
BEGIN
  SELECT string_agg('- ' || a.title || CASE WHEN en THEN ' (due ' ELSE ' (الاستحقاق ' END || app_agenda_date(a.due_date, l) || ')', E'\n' ORDER BY a.due_date) INTO part FROM (
    SELECT a.title, a.due_date FROM actions a JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
    WHERE a.project_id = pid AND a.due_date < today AND app_action_open(a.status) AND (dept IS NULL OR a.department_id = dept)
      AND (reader IS NULL OR app_user_sees_action(reader, a.id))
    ORDER BY a.due_date LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Overdue\n' ELSE E'## متأخرة\n' END || part || E'\n\n'; END IF;
  SELECT string_agg('- ' || a.title, E'\n' ORDER BY a.title) INTO part FROM (
    SELECT a.title FROM actions a JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
    WHERE a.project_id = pid AND a.status = 'awaiting_review' AND (dept IS NULL OR a.department_id = dept)
      AND (reader IS NULL OR app_user_sees_action(reader, a.id))
    ORDER BY a.title LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Awaiting review\n' ELSE E'## بانتظار المراجعة\n' END || part || E'\n\n'; END IF;
  SELECT string_agg('- ' || a.title || coalesce(': ' || a.blocked_reason, ''), E'\n' ORDER BY a.title) INTO part FROM (
    SELECT a.title, a.blocked_reason FROM actions a JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
    WHERE a.project_id = pid AND a.status = 'blocked' AND (dept IS NULL OR a.department_id = dept)
      AND (reader IS NULL OR app_user_sees_action(reader, a.id))
    ORDER BY a.title LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Blocked\n' ELSE E'## متوقفة\n' END || part || E'\n\n'; END IF;
  IF last_held IS NOT NULL THEN
    SELECT string_agg('- ' || c.title || ' (' || app_action_status_label(c.status, l) || ')', E'\n' ORDER BY c.title) INTO part FROM (
      SELECT c.* FROM app_changed_actions(pid, last_held) c
        JOIN actions a ON a.id = c.action_id JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
      WHERE (dept IS NULL OR a.department_id = dept) AND (reader IS NULL OR app_user_sees_action(reader, a.id))
      ORDER BY c.title LIMIT 20) c;
    IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Changed since the last meeting\n' ELSE E'## ما تغيّر منذ الاجتماع السابق\n' END || part || E'\n\n'; END IF;
  END IF;
  RETURN nullif(rtrim(out, E'\n'), '');
END $$;
--> statement-breakpoint
-- The calendar invite (latest: baseline): never queued for an attendee left
-- out of the meeting.
CREATE OR REPLACE FUNCTION app_send_meeting_invites(mid uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m meetings%ROWTYPE; n integer;
BEGIN
  SELECT * INTO m FROM meetings WHERE id = mid;
  IF NOT FOUND OR NOT app_can_run_meeting(mid) OR m.status = 'held' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO outbound_emails (to_email, kind, meeting_id)
    SELECT DISTINCT addr, CASE m.status WHEN 'cancelled' THEN 'meeting.cancel' ELSE 'meeting.invite' END, mid
    FROM (SELECT u.email AS addr FROM meeting_attendees a JOIN "user" u ON u.id = a.user_id
          WHERE a.meeting_id = mid AND a.user_id <> app_uid() AND app_audience_ok('meeting', mid, a.user_id)
          UNION SELECT c.email FROM meeting_attendees a JOIN client_contacts c ON c.id = a.contact_id
          WHERE a.meeting_id = mid AND c.email IS NOT NULL) x;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
