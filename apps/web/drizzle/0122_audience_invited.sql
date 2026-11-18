-- Who sees an item (feature A): everyone invited to a meeting sees it (the
-- product owner's decision on the re-check, S9). Anyone on its attendee list,
-- required or optional, is locked ("invited"), as its organiser is: leaving
-- them out is refused in app_set_audience(), which booking, editing and the
-- picker all go through, and an "only" list that misses them still lets them
-- in. Taking someone off the meeting is how they stop seeing it: their unsent
-- invitation is withdrawn (kept, never deleted), and if one already reached
-- their calendar they are sent a cancellation that names only them, once
-- (mail kind meeting.removed: a calendar CANCEL, worded "you were taken off a
-- meeting", since the meeting itself goes ahead).

-- 1. The locked people (latest: 0111): "invited" replaces "requiredAttendee"
--    and covers every attendee. The parameter is renamed, so the function is
--    dropped and made again (nothing depends on it but other functions' text).
DROP FUNCTION app_audience_lock_of(uuid, text, uuid, visibility, text, uuid, uuid[], uuid, uuid[]);
--> statement-breakpoint
CREATE FUNCTION app_audience_lock_of(target uuid, item_kind text, pid uuid, vis visibility, side text, setter uuid,
  uploaders uuid[], organizer uuid, invited uuid[]) RETURNS text
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
    WHEN item_kind = 'meeting' AND target = ANY (coalesce(invited, '{}')) THEN 'invited'
  END
  FROM projects p WHERE p.id = pid
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_audience_lock_of(uuid, text, uuid, visibility, text, uuid, uuid[], uuid, uuid[]) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_audience_lock(kind text, item uuid, target uuid, setter uuid, vis_as visibility DEFAULT NULL) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE kind
    WHEN 'document' THEN (
      SELECT app_audience_lock_of(target, 'document', d.project_id, coalesce(vis_as, d.visibility), app_audience_side('document', d.id), setter,
               ARRAY(SELECT x.uploaded_by FROM documents x WHERE x.id IN (SELECT app_document_versions(d.id))), NULL, NULL)
      FROM documents d WHERE d.id = item)
    WHEN 'meeting' THEN (
      SELECT app_audience_lock_of(target, 'meeting', m.project_id, m.visibility, app_audience_side('meeting', m.id), setter, NULL, m.organizer_id,
               ARRAY(SELECT a.user_id FROM meeting_attendees a WHERE a.meeting_id = m.id AND a.user_id IS NOT NULL))
      FROM meetings m WHERE m.id = item)
  END
$$;
--> statement-breakpoint
-- 2. The people a meeting not booked yet would be seen by (latest: 0111): everyone
--    the form invites is locked, so the list of required ones is no longer asked for.
DROP FUNCTION app_audience_people_new(text, uuid, visibility, uuid, uuid[], uuid[]);
--> statement-breakpoint
CREATE FUNCTION app_audience_people_new(kind text, pid uuid, vis visibility, dept uuid, attendees uuid[])
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
      app_audience_lock_of(u.id, kind, pid, vis, side, app_uid(), ARRAY[app_uid()], app_uid(), coalesce(attendees, '{}'))
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
REVOKE ALL ON FUNCTION app_audience_people_new(text, uuid, visibility, uuid, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_audience_people_new(text, uuid, visibility, uuid, uuid[]) TO selah_app;
--> statement-breakpoint
-- 3. Setting the audience (latest: 0121): leaving out anyone invited is refused, saying what to
--    do instead; the mail it withdraws is never the cancellation for someone taken off the
--    meeting (that one has to reach her calendar, left out or not).
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
-- 4. The new mail kind (latest list: 0060), and whether an address is still on a meeting's
--    attendee list, as a person or a contact.
ALTER TABLE outbound_emails DROP CONSTRAINT outbound_kind;
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_kind CHECK (kind IN (
  'invitation', 'email_change.confirm', 'email_change.notice', 'access_review.due',
  'meeting.invite', 'meeting.cancel', 'meeting.removed', 'password_reset', 'password_reset.notice', 'two_factor.reset',
  'inquiry.new', 'inquiry.received', 'inquiry.declined', 'action.assigned', 'action.revision_requested',
  'action.verified_complete', 'evidence.requested', 'action.commented', 'action.mentioned', 'follow_up.digest', 'client.archived',
  'pulse.requested', 'sign_in_link', 'info_request.upload_link', 'support.requested'));
--> statement-breakpoint
CREATE FUNCTION app_meeting_address_on(mid uuid, addr text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM meeting_attendees a
    LEFT JOIN "user" u ON u.id = a.user_id
    LEFT JOIN client_contacts c ON c.id = a.contact_id
    WHERE a.meeting_id = mid AND lower(coalesce(u.email, c.email)) = lower(addr))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_meeting_address_on(uuid, text) FROM PUBLIC;
--> statement-breakpoint
-- 5. Taken off a meeting: her invitation not sent yet is withdrawn; if one reached her calendar
--    since the last cancellation queued for her, a cancellation for her alone is queued
--    (meeting.removed). Not for a meeting that is gone, already held or cancelled (the whole
--    cancellation goes to everyone invited), or over; not while the same address is still on it.
CREATE FUNCTION meeting_attendee_removed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m meetings%ROWTYPE; addr text;
BEGIN
  SELECT * INTO m FROM meetings WHERE id = OLD.meeting_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  addr := coalesce((SELECT u.email FROM "user" u WHERE u.id = OLD.user_id), (SELECT c.email FROM client_contacts c WHERE c.id = OLD.contact_id));
  IF addr IS NULL OR app_meeting_address_on(m.id, addr) THEN RETURN NULL; END IF;
  UPDATE outbound_emails SET withdrawn_at = now(), next_attempt_at = NULL
  WHERE meeting_id = m.id AND lower(to_email) = lower(addr) AND kind = 'meeting.invite'
    AND sent_at IS NULL AND failed_at IS NULL AND withdrawn_at IS NULL;
  IF m.status = 'scheduled' AND m.ends_at > now() AND EXISTS (
    SELECT 1 FROM outbound_emails i
    WHERE i.meeting_id = m.id AND lower(i.to_email) = lower(addr) AND i.kind = 'meeting.invite' AND i.sent_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM outbound_emails c
        WHERE c.meeting_id = m.id AND lower(c.to_email) = lower(addr) AND c.kind IN ('meeting.removed', 'meeting.cancel')
          AND c.withdrawn_at IS NULL AND c.failed_at IS NULL AND c.created_at >= i.created_at)
  ) THEN
    INSERT INTO outbound_emails (to_email, kind, meeting_id) VALUES (addr, 'meeting.removed', m.id);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION meeting_attendee_removed() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER attendee_removed AFTER DELETE ON meeting_attendees FOR EACH ROW EXECUTE FUNCTION meeting_attendee_removed();
--> statement-breakpoint
-- 6. The sender's check just before each meeting mail goes (latest: 0114) now knows the kind.
--    The cancellation for someone taken off the meeting goes only while she is still off it (once
--    she is invited again it would wipe the new invitation) and if an invitation reached her; it
--    says nothing she was not sent (the sender builds it so). Every other meeting mail: only to
--    someone on the meeting who is not left out of it.
DROP FUNCTION app_meeting_mail_ok(uuid, text);
--> statement-breakpoint
CREATE FUNCTION app_meeting_mail_ok(mid uuid, addr text, mail_kind text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN mail_kind = 'meeting.removed' THEN NOT app_meeting_address_on(mid, addr) AND EXISTS (
      SELECT 1 FROM outbound_emails i
      WHERE i.meeting_id = mid AND lower(i.to_email) = lower(addr) AND i.kind = 'meeting.invite' AND i.sent_at IS NOT NULL)
    ELSE EXISTS (
        SELECT 1 FROM meeting_attendees a JOIN client_contacts c ON c.id = a.contact_id
        WHERE a.meeting_id = mid AND lower(c.email) = lower(addr))
      OR EXISTS (
        SELECT 1 FROM meeting_attendees a JOIN "user" u ON u.id = a.user_id
        WHERE a.meeting_id = mid AND lower(u.email) = lower(addr) AND app_audience_ok('meeting', mid, u.id))
  END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_meeting_mail_ok(uuid, text, text) FROM PUBLIC;
