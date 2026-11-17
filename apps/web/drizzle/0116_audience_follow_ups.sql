-- Who sees an item (feature A): leaving out someone the meeting still needs is
-- refused, saying what to change first (review S3).
--
-- 1. Setting the audience (latest: 0115): a required attendee is asked to be
--    made optional or taken off the meeting first; someone with an open
--    follow-up on the meeting (on an "except" list, or missing from an "only"
--    list) has it given to someone else first. Before, the assignee kept a
--    task she could no longer see.
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
    why := app_audience_lock(kind, item, person, app_uid());
    IF why IS NOT NULL THEN
      IF new_mode = 'except' AND why = 'requiredAttendee' THEN
        RAISE EXCEPTION 'that person is a required attendee: make them optional or take them off the meeting first' USING ERRCODE = 'SL400';
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
               ELSE NOT (f.assignee_user_id = ANY (keep)) AND app_audience_lock(kind, item, f.assignee_user_id, app_uid()) IS NULL END
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
    WHERE o.meeting_id = item AND o.sent_at IS NULL AND o.failed_at IS NULL AND o.withdrawn_at IS NULL
      AND EXISTS (SELECT 1 FROM "user" u WHERE lower(u.email) = lower(o.to_email) AND NOT app_audience_ok('meeting', item, u.id))
      AND NOT EXISTS (SELECT 1 FROM meeting_attendees a JOIN client_contacts c ON c.id = a.contact_id
                      WHERE a.meeting_id = item AND lower(c.email) = lower(o.to_email));
    GET DIAGNOSTICS withdrawn = ROW_COUNT;
  END IF;
  RETURN withdrawn;
END $$;
--> statement-breakpoint
-- 2. The follow-up rule of 0111 ran before follow_up_rules, which fills a
--    follow-up's meeting from its decision, so a follow-up written from a
--    decision was never checked. Renamed so it runs after (triggers of the
--    same kind run in name order), and on a change of decision too.
DROP TRIGGER audience_follow_up ON follow_ups;
--> statement-breakpoint
CREATE TRIGGER follow_up_seen_by BEFORE INSERT OR UPDATE OF assignee_user_id, meeting_id, meeting_decision_id ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION check_audience_follow_up();
