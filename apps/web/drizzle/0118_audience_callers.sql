-- Who sees an item (feature A): the functions the app may call answer only
-- about an item the caller can already see, and only about the caller
-- (review S6). app_audience_ok, app_audience_entity_ok, app_audience_side and
-- app_audience_mine (0111) answered the app role about any item in any
-- tenant, for anyone: whether it exists, whether it is narrowed, who is left
-- out. The three-argument forms stay for the definer functions (they run as
-- the schema owner); the app gets forms about the caller alone, which give an
-- item the caller cannot see the same answer as an id that does not exist.
--
-- 1. Whether the caller opens an item by the rules before any audience: a
--    file as the row policies on documents say (0112), a meeting as
--    app_can_see_meeting() did before the audience (0082).
CREATE FUNCTION app_caller_sees_meeting(mid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM meetings m
    WHERE m.id = mid AND app_can_see_project(m.project_id) AND app_label_ok(m.visibility, m.org_id, m.organizer_id)
      AND app_meeting_dept_ok(m.id, m.department_id, m.org_id, m.organizer_id)
      AND app_meeting_whole_ok(m.id, m.project_id, m.department_id)
  )
$$;
--> statement-breakpoint
CREATE FUNCTION app_caller_sees_item(kind text, item uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE kind
    WHEN 'document' THEN app_caller_sees_document(item)
    WHEN 'meeting' THEN app_caller_sees_meeting(item)
    ELSE false
  END
$$;
--> statement-breakpoint
-- 2. The caller's own answer, for the row policies and the assistant's search:
--    not left out, or an item the caller cannot see anyway (the other rules
--    hide it, so the answer says nothing and widens nothing).
CREATE FUNCTION app_audience_ok(kind text, item uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN app_audience_ok(kind, item, app_uid()) THEN true ELSE NOT app_caller_sees_item(kind, item) END
$$;
--> statement-breakpoint
CREATE FUNCTION app_audience_entity_ok(etype text, eid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE etype
    WHEN 'document' THEN app_audience_ok('document', eid)
    WHEN 'meeting' THEN app_audience_ok('meeting', eid)
    WHEN 'meeting_summary' THEN app_audience_ok('meeting', eid)
    WHEN 'meeting_decision' THEN app_audience_ok('meeting', (SELECT d.meeting_id FROM meeting_decisions d WHERE d.id = eid))
    WHEN 'meeting_note' THEN app_audience_ok('meeting', (SELECT n.meeting_id FROM meeting_notes n WHERE n.id = eid))
    WHEN 'follow_up' THEN app_audience_ok('meeting', (SELECT f.meeting_id FROM follow_ups f WHERE f.id = eid))
    ELSE true
  END
$$;
--> statement-breakpoint
-- 3. Whose item it is (firm or client), for an item the caller sees; nothing otherwise.
CREATE FUNCTION app_audience_side_for_me(kind text, item uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN app_caller_sees_item(kind, item) AND app_audience_ok(kind, item, app_uid()) THEN app_audience_side(kind, item) END
$$;
--> statement-breakpoint
-- 4. The caller's own part of the narrowed items among ids (latest: 0111),
--    only for items the caller sees: someone left out gets nothing, as for an
--    unknown id. (authorize()'s sixth question then repeats what row-level
--    security already decided for what the services load.)
CREATE OR REPLACE FUNCTION app_audience_mine(kind text, ids uuid[]) RETURNS TABLE (item_id uuid, mode text, listed boolean, locked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.item_id, a.mode,
    EXISTS (SELECT 1 FROM item_audience_people x WHERE x.item_type = a.item_type AND x.item_id = a.item_id AND x.user_id = app_uid()),
    app_audience_locked(a.item_type, a.item_id, app_uid(), a.set_by)
  FROM item_audiences a
  WHERE a.item_type = kind AND a.item_id = ANY (ids)
    AND app_caller_sees_item(a.item_type, a.item_id) AND app_audience_ok(a.item_type, a.item_id, app_uid())
$$;
--> statement-breakpoint
-- 5. Whether a file is narrowed (latest: 0112): also nothing for someone left out of it.
CREATE OR REPLACE FUNCTION app_document_narrowed(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_caller_sees_document(doc) AND app_audience_ok('document', doc, app_uid())
    AND EXISTS (SELECT 1 FROM item_audiences a WHERE a.item_type = 'document' AND a.item_id = doc)
$$;
--> statement-breakpoint
-- 6. A chat (latest: 0117): answered only about the caller's own chats.
CREATE OR REPLACE FUNCTION app_chat_audience_ok(conv uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM ai_conversations c
    WHERE c.id = conv AND c.user_id = app_uid() AND (
      (c.case_type::text IN ('document', 'meeting') AND NOT app_audience_ok(c.case_type::text, c.case_id, app_uid()))
      OR EXISTS (
        SELECT 1 FROM ai_messages m
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(m.citations) = 'array' THEN m.citations ELSE '[]'::jsonb END) x
        WHERE m.conversation_id = c.id AND x ->> 'sourceType' IN ('document', 'meeting', 'meeting_note')
          AND NOT app_audience_entity_ok(x ->> 'sourceType', app_try_uuid(x ->> 'sourceId'), app_uid())))
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_caller_sees_meeting(uuid), app_caller_sees_item(text, uuid), app_audience_ok(text, uuid),
  app_audience_entity_ok(text, uuid), app_audience_side_for_me(text, uuid) FROM PUBLIC;
--> statement-breakpoint
-- The app asks about the caller only.
REVOKE EXECUTE ON FUNCTION app_audience_ok(text, uuid, uuid), app_audience_entity_ok(text, uuid, uuid), app_audience_side(text, uuid) FROM selah_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_audience_ok(text, uuid), app_audience_entity_ok(text, uuid), app_audience_side_for_me(text, uuid) TO selah_app;
--> statement-breakpoint
-- 7. The restrictive policies (latest: 0111) ask the caller's form.
DROP POLICY audience ON documents;
--> statement-breakpoint
CREATE POLICY audience ON documents AS RESTRICTIVE FOR ALL TO selah_app USING (app_audience_ok('document', id));
--> statement-breakpoint
DROP POLICY audience ON document_shares;
--> statement-breakpoint
CREATE POLICY audience ON document_shares AS RESTRICTIVE FOR ALL TO selah_app USING (app_audience_ok('document', document_id));
--> statement-breakpoint
DROP POLICY audience ON document_summaries;
--> statement-breakpoint
CREATE POLICY audience ON document_summaries AS RESTRICTIVE FOR ALL TO selah_app USING (app_audience_ok('document', document_id));
--> statement-breakpoint
DROP POLICY audience ON info_request_files;
--> statement-breakpoint
CREATE POLICY audience ON info_request_files AS RESTRICTIVE FOR ALL TO selah_app USING (app_audience_ok('document', document_id));
--> statement-breakpoint
DROP POLICY audience ON assessment_evidence;
--> statement-breakpoint
CREATE POLICY audience ON assessment_evidence AS RESTRICTIVE FOR ALL TO selah_app USING (app_audience_ok('document', document_id));
--> statement-breakpoint
DROP POLICY audience ON meetings;
--> statement-breakpoint
CREATE POLICY audience ON meetings AS RESTRICTIVE FOR ALL TO selah_app USING (app_audience_ok('meeting', id));
--> statement-breakpoint
DROP POLICY audience ON meeting_attendees;
--> statement-breakpoint
CREATE POLICY audience ON meeting_attendees AS RESTRICTIVE FOR ALL TO selah_app USING (app_audience_ok('meeting', meeting_id));
--> statement-breakpoint
DROP POLICY audience ON meeting_decisions;
--> statement-breakpoint
CREATE POLICY audience ON meeting_decisions AS RESTRICTIVE FOR ALL TO selah_app USING (app_audience_ok('meeting', meeting_id));
--> statement-breakpoint
DROP POLICY audience ON meeting_summaries;
--> statement-breakpoint
CREATE POLICY audience ON meeting_summaries AS RESTRICTIVE FOR ALL TO selah_app USING (app_audience_ok('meeting', meeting_id));
--> statement-breakpoint
DROP POLICY audience ON meeting_summary_sources;
--> statement-breakpoint
CREATE POLICY audience ON meeting_summary_sources AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_audience_ok('meeting', meeting_id) AND app_audience_ok('document', document_id));
--> statement-breakpoint
DROP POLICY audience ON meeting_transcripts;
--> statement-breakpoint
CREATE POLICY audience ON meeting_transcripts AS RESTRICTIVE FOR ALL TO selah_app USING (app_audience_ok('meeting', meeting_id));
--> statement-breakpoint
DROP POLICY audience ON meeting_notes;
--> statement-breakpoint
CREATE POLICY audience ON meeting_notes AS RESTRICTIVE FOR ALL TO selah_app USING (app_audience_ok('meeting', meeting_id));
--> statement-breakpoint
DROP POLICY audience ON follow_ups;
--> statement-breakpoint
CREATE POLICY audience ON follow_ups AS RESTRICTIVE FOR ALL TO selah_app USING (app_audience_ok('meeting', meeting_id));
--> statement-breakpoint
DROP POLICY audience ON ai_chunks;
--> statement-breakpoint
CREATE POLICY audience ON ai_chunks AS RESTRICTIVE FOR ALL TO selah_app
  USING (CASE source_type
    WHEN 'document' THEN app_audience_ok('document', source_id)
    WHEN 'meeting_note' THEN app_audience_entity_ok('meeting_note', source_id)
    ELSE true
  END);
--> statement-breakpoint
DROP POLICY audience ON content_translations;
--> statement-breakpoint
CREATE POLICY audience ON content_translations AS RESTRICTIVE FOR ALL TO selah_app
  USING (CASE WHEN entity_type IN ('document', 'meeting', 'meeting_summary', 'meeting_decision', 'meeting_note', 'follow_up')
    THEN app_audience_entity_ok(entity_type, entity_id) ELSE true END);
--> statement-breakpoint
DROP POLICY audience ON activity_events;
--> statement-breakpoint
CREATE POLICY audience ON activity_events AS RESTRICTIVE FOR ALL TO selah_app
  USING (
    CASE WHEN entity_type IN ('document', 'meeting', 'meeting_summary', 'meeting_decision', 'meeting_note', 'follow_up')
      THEN app_audience_entity_ok(entity_type, entity_id) ELSE true END
    AND CASE WHEN meta ? 'documentId' THEN app_audience_ok('document', app_try_uuid(meta ->> 'documentId')) ELSE true END
  );
--> statement-breakpoint
DROP POLICY audience ON notifications;
--> statement-breakpoint
CREATE POLICY audience ON notifications AS RESTRICTIVE FOR SELECT TO selah_app
  USING (CASE WHEN entity_type IN ('document', 'meeting', 'meeting_summary', 'meeting_decision', 'meeting_note', 'follow_up')
    THEN app_audience_entity_ok(entity_type, entity_id) ELSE true END);
