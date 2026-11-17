-- Who sees an item (feature A): queued meeting mail for someone left out is
-- withdrawn, never deleted (the product owner's decision on the review, B2,
-- 18 Nov 2026), and the sender checks again just before it sends.
--
-- 1. Whether a meeting's mail may still go to an address: it is a contact
--    invited to the meeting, or an invited person who is not left out of it.
--    For the mail job (schema owner) only. An address that is no longer an
--    attendee's (taken off the meeting, or an old address) is not sent either.
CREATE FUNCTION app_meeting_mail_ok(mid uuid, addr text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
      SELECT 1 FROM meeting_attendees a JOIN client_contacts c ON c.id = a.contact_id
      WHERE a.meeting_id = mid AND lower(c.email) = lower(addr))
    OR EXISTS (
      SELECT 1 FROM meeting_attendees a JOIN "user" u ON u.id = a.user_id
      WHERE a.meeting_id = mid AND lower(u.email) = lower(addr) AND app_audience_ok('meeting', mid, u.id))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_meeting_mail_ok(uuid, text) FROM PUBLIC;
--> statement-breakpoint
-- 2. Setting the audience (latest: 0111) marks a meeting's unsent mail to
--    someone now left out as withdrawn instead of deleting it, and answers how
--    many it withdrew (for the audit row; a count, no names). A contact
--    invited at the same address keeps the mail.
DROP FUNCTION app_set_audience(text, uuid, text, uuid[]);
--> statement-breakpoint
CREATE FUNCTION app_set_audience(kind text, item uuid, new_mode text, chosen uuid[]) RETURNS integer
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
    RETURN 0;
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
    UPDATE outbound_emails o SET withdrawn_at = now()
    WHERE o.meeting_id = item AND o.sent_at IS NULL AND o.failed_at IS NULL AND o.withdrawn_at IS NULL
      AND EXISTS (SELECT 1 FROM "user" u WHERE lower(u.email) = lower(o.to_email) AND NOT app_audience_ok('meeting', item, u.id))
      AND NOT EXISTS (SELECT 1 FROM meeting_attendees a JOIN client_contacts c ON c.id = a.contact_id
                      WHERE a.meeting_id = item AND lower(c.email) = lower(o.to_email));
    GET DIAGNOSTICS withdrawn = ROW_COUNT;
  END IF;
  RETURN withdrawn;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_set_audience(text, uuid, text, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_set_audience(text, uuid, text, uuid[]) TO selah_app;
--> statement-breakpoint
-- 3. Who is shown as "mail failing" (latest: 0019): a withdrawn invite is not
--    a failure.
CREATE OR REPLACE FUNCTION app_mail_failing(uids uuid[]) RETURNS TABLE (user_id uuid, since timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, coalesce(f.failed_at, r.since)
  FROM "user" u
  LEFT JOIN LATERAL (
    SELECT o.failed_at FROM outbound_emails o
    WHERE lower(o.to_email) = lower(u.email) AND (o.sent_at IS NOT NULL OR o.failed_at IS NOT NULL)
    ORDER BY coalesce(o.sent_at, o.failed_at) DESC LIMIT 1
  ) f ON true
  LEFT JOIN LATERAL (
    SELECT min(o.created_at) AS since FROM outbound_emails o
    WHERE lower(o.to_email) = lower(u.email) AND o.sent_at IS NULL AND o.failed_at IS NULL AND o.withdrawn_at IS NULL
      AND o.attempts >= 3 AND o.last_error IS NOT NULL
  ) r ON true
  WHERE u.id = ANY (uids) AND app_org_kind() = 'firm' AND app_can_see_user(u.id)
    AND (f.failed_at IS NOT NULL OR r.since IS NOT NULL)
$$;
