-- Who sees an item (feature A): the person an information request asks for a
-- file always sees a file sent for it (the product owner's decision on the
-- re-check, N4), so she never sees "Received" with nothing to open. She is
-- locked ("asked"): leaving her out of the file is refused and an "only" list
-- that misses her still lets her in. The other way round, as for a meeting's
-- invitation: a file she is left out of can't be sent for her item, and an
-- item can't be given to someone left out of a file sent for it. Neither lifts
-- an exclusion silently.

-- 1. Whether a file (any of its versions) was sent for an item that asks this person.
CREATE FUNCTION app_document_asks(doc uuid, target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT target IS NOT NULL AND EXISTS (
    SELECT 1 FROM info_request_files f JOIN info_requests r ON r.id = f.request_id
    WHERE f.document_id IN (SELECT app_document_versions(doc)) AND r.owner_user_id = target)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_document_asks(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
-- 2. The locked people of an item (latest: 0122): on a file, also "asked".
CREATE OR REPLACE FUNCTION app_audience_lock(kind text, item uuid, target uuid, setter uuid, vis_as visibility DEFAULT NULL) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE kind
    WHEN 'document' THEN (
      SELECT coalesce(
        app_audience_lock_of(target, 'document', d.project_id, coalesce(vis_as, d.visibility), app_audience_side('document', d.id), setter,
          ARRAY(SELECT x.uploaded_by FROM documents x WHERE x.id IN (SELECT app_document_versions(d.id))), NULL, NULL),
        CASE WHEN app_document_asks(d.id, target) THEN 'asked' END)
      FROM documents d WHERE d.id = item)
    WHEN 'meeting' THEN (
      SELECT app_audience_lock_of(target, 'meeting', m.project_id, m.visibility, app_audience_side('meeting', m.id), setter, NULL, m.organizer_id,
               ARRAY(SELECT a.user_id FROM meeting_attendees a WHERE a.meeting_id = m.id AND a.user_id IS NOT NULL))
      FROM meetings m WHERE m.id = item)
  END
$$;
--> statement-breakpoint
-- 3. The people a file not uploaded yet would be seen by (latest: 0122): sent for an item of the
--    project, the person it asks is locked in the form too.
DROP FUNCTION app_audience_people_new(text, uuid, visibility, uuid, uuid[]);
--> statement-breakpoint
CREATE FUNCTION app_audience_people_new(kind text, pid uuid, vis visibility, dept uuid, attendees uuid[], request uuid DEFAULT NULL)
RETURNS TABLE (user_id uuid, name text, firm boolean, locked text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p projects%ROWTYPE; side text; asked uuid;
BEGIN
  SELECT * INTO p FROM projects x WHERE x.id = pid;
  IF NOT FOUND OR NOT app_can_see_project(pid) OR app_observes_project(pid) OR kind NOT IN ('document', 'meeting')
     OR NOT ((app_org_kind() = 'firm' AND app_role() IN ('firm_admin', 'consultant')) OR app_role() = 'client_admin') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  side := CASE WHEN p.kind = 'client' AND app_org() = p.org_id THEN 'client' ELSE 'firm' END;
  IF kind = 'document' AND request IS NOT NULL THEN
    SELECT r.owner_user_id INTO asked FROM info_requests r WHERE r.id = request AND r.project_id = pid;
  END IF;
  RETURN QUERY
    SELECT u.id, u.name, mo.org_id = p.firm_org_id,
      coalesce(app_audience_lock_of(u.id, kind, pid, vis, side, app_uid(), ARRAY[app_uid()], app_uid(), coalesce(attendees, '{}')),
               CASE WHEN u.id = asked THEN 'asked' END)
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
REVOKE ALL ON FUNCTION app_audience_people_new(text, uuid, visibility, uuid, uuid[], uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_audience_people_new(text, uuid, visibility, uuid, uuid[], uuid) TO selah_app;
--> statement-breakpoint
-- 4. Setting the audience (latest: 0122): leaving out the person asked for the file is refused,
--    saying what to do instead.
CREATE OR REPLACE FUNCTION app_set_audience(kind text, item uuid, new_mode text, chosen uuid[]) RETURNS integer
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
  withdrawn integer := 0;
  why text;
BEGIN
  IF kind NOT IN ('document', 'meeting') OR pid IS NULL OR NOT app_can_manage_audience(kind, item) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT p.firm_org_id, p.org_id INTO firm_org, row_org FROM projects p WHERE p.id = pid;
  IF EXISTS (SELECT 1 FROM projects p WHERE p.id = pid AND p.state = 'closed') THEN
    RAISE EXCEPTION 'this project is closed' USING ERRCODE = 'SL400';
  END IF;
  IF kind = 'document' AND EXISTS (SELECT 1 FROM documents d WHERE d.id = item AND d.state = 'archived') THEN
    RAISE EXCEPTION 'this file is archived' USING ERRCODE = 'SL400';
  END IF;
  ids := CASE kind WHEN 'document' THEN ARRAY(SELECT app_document_versions(item)) ELSE ARRAY[item] END;
  IF new_mode = 'everyone' THEN
    DELETE FROM item_audiences WHERE item_type = kind AND item_id = ANY (ids);
    RETURN 0;
  END IF;
  IF new_mode IS NULL OR new_mode NOT IN ('except', 'only') THEN
    RAISE EXCEPTION 'choose everyone, everyone except, or only' USING ERRCODE = 'SL400';
  END IF;
  -- A copy of the file already sits as evidence on an action (same client, same bytes): everyone
  -- who sees the action sees the copy, so narrowing the file would only seem to hide it (review S7).
  IF kind = 'document' AND EXISTS (
    SELECT 1 FROM documents e
    WHERE e.org_id = row_org AND e.purpose = 'evidence' AND NOT (e.id = ANY (ids))
      AND e.sha256 IN (SELECT v.sha256 FROM documents v WHERE v.id = ANY (ids))
  ) THEN
    RAISE EXCEPTION 'this file was already used as evidence on an action, so its audience can''t be limited' USING ERRCODE = 'SL400';
  END IF;
  people := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(chosen, '{}')) x WHERE x IS NOT NULL);
  IF new_mode = 'only' AND cardinality(people) = 0 THEN
    RAISE EXCEPTION 'an "only" list needs at least one person' USING ERRCODE = 'SL400';
  END IF;
  FOREACH person IN ARRAY people LOOP
    IF NOT app_user_sees_item(kind, item, person) THEN
      RAISE EXCEPTION 'pick only people who can already see it' USING ERRCODE = 'SL400';
    END IF;
    -- On a client's own item the firm's people always see it: never left out ("except" is refused),
    -- and on an "only" list there is nothing to store for them.
    IF side = 'client' AND NOT EXISTS (
      SELECT 1 FROM org_memberships om WHERE om.user_id = person AND om.org_id = row_org AND om.active) THEN
      IF new_mode = 'except' THEN
        RAISE EXCEPTION 'on your company''s own items, choose among your company''s people' USING ERRCODE = 'SL400';
      END IF;
      CONTINUE;
    END IF;
    why := app_audience_lock(kind, item, person, app_uid());
    IF why IS NOT NULL THEN
      IF new_mode = 'except' AND why = 'invited' THEN
        RAISE EXCEPTION 'that person is invited to this meeting: take them off the meeting first' USING ERRCODE = 'SL400';
      ELSIF new_mode = 'except' AND why = 'asked' THEN
        RAISE EXCEPTION 'that person was asked for this file: name someone else to send it first' USING ERRCODE = 'SL400';
      ELSIF new_mode = 'except' THEN
        RAISE EXCEPTION 'that person always sees it and cannot be left out' USING ERRCODE = 'SL400';
      END IF;
    ELSE
      keep := keep || person;
    END IF;
  END LOOP;
  -- The person saving an "only" list is written onto it as an ordinary pick, so a later
  -- editor sees them as a chip and removes them only on purpose (they are still shown
  -- locked to themselves while they edit: "self"). Never onto a list of people left out.
  IF new_mode = 'only' AND NOT (app_uid() = ANY (keep)) THEN
    keep := keep || app_uid();
  END IF;
  -- Someone with an open follow-up on the meeting keeps seeing it: they have to do it.
  IF kind = 'meeting' AND EXISTS (
    SELECT 1 FROM follow_ups f
    WHERE f.meeting_id = item AND f.status = 'open' AND f.assignee_user_id IS NOT NULL
      AND CASE WHEN new_mode = 'except' THEN f.assignee_user_id = ANY (people)
               ELSE NOT (f.assignee_user_id = ANY (keep)) AND NOT app_audience_locked(kind, item, f.assignee_user_id, app_uid()) END
  ) THEN
    RAISE EXCEPTION 'that person has an open follow-up on this meeting: give it to someone else first' USING ERRCODE = 'SL400';
  END IF;
  INSERT INTO item_audiences (org_id, item_type, item_id, mode, set_by, set_at)
    SELECT row_org, kind, i, new_mode, app_uid(), now() FROM unnest(ids) i
  ON CONFLICT (item_type, item_id) DO UPDATE SET mode = EXCLUDED.mode, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at;
  DELETE FROM item_audience_people WHERE item_type = kind AND item_id = ANY (ids);
  INSERT INTO item_audience_people (item_type, item_id, user_id)
    SELECT kind, i, x FROM unnest(ids) i, unnest(keep) x;
  IF kind = 'meeting' THEN
    UPDATE outbound_emails o SET withdrawn_at = now()
    WHERE o.meeting_id = item AND o.kind <> 'meeting.removed' AND o.sent_at IS NULL AND o.failed_at IS NULL AND o.withdrawn_at IS NULL
      AND EXISTS (SELECT 1 FROM "user" u WHERE lower(u.email) = lower(o.to_email) AND NOT app_audience_ok('meeting', item, u.id))
      AND NOT EXISTS (SELECT 1 FROM meeting_attendees a JOIN client_contacts c ON c.id = a.contact_id
                      WHERE a.meeting_id = item AND lower(c.email) = lower(o.to_email));
    GET DIAGNOSTICS withdrawn = ROW_COUNT;
  END IF;
  RETURN withdrawn;
END $$;
--> statement-breakpoint
-- 5. A file sent for an item, and an item given to someone: refused when the person asked is left
--    out of the file (before the row is written, so the lock above does not count yet).
CREATE FUNCTION check_answer_seen_by_asked() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM info_requests r
             WHERE r.id = NEW.request_id AND r.owner_user_id IS NOT NULL AND NOT app_audience_ok('document', NEW.document_id, r.owner_user_id)) THEN
    RAISE EXCEPTION 'the person asked for this item is left out of that file: pick another file, or change who sees it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION check_asked_sees_answers() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.owner_user_id IS NOT NULL AND NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id AND EXISTS (
    SELECT 1 FROM info_request_files f WHERE f.request_id = NEW.id AND NOT app_audience_ok('document', f.document_id, NEW.owner_user_id)) THEN
    RAISE EXCEPTION 'that person is left out of a file sent for this item: change who sees the file first' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_answer_seen_by_asked(), check_asked_sees_answers() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER answer_seen_by_asked BEFORE INSERT OR UPDATE OF request_id, document_id ON info_request_files
  FOR EACH ROW EXECUTE FUNCTION check_answer_seen_by_asked();
--> statement-breakpoint
CREATE TRIGGER asked_sees_answers BEFORE UPDATE OF owner_user_id ON info_requests
  FOR EACH ROW EXECUTE FUNCTION check_asked_sees_answers();
