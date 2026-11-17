-- Who sees an item (feature A): an assistant chat about an item its owner is
-- now left out of, or one that cites it, is hidden the way a chat is hidden
-- once its project is out of sight (review S4; the baseline's Assistant chats,
-- rule 1, and 0066). Nothing is deleted: opened up again, the chat comes back.
-- The chat's messages follow it through their own policy's subquery.
--
-- Whether the caller may still read a chat of theirs: its case is not an item
-- they are left out of, and no answer in it cites one (a file, a meeting, a
-- meeting's note). Asked about the caller only.
CREATE FUNCTION app_chat_audience_ok(conv uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (
      SELECT 1 FROM ai_conversations c
      WHERE c.id = conv AND c.case_type::text IN ('document', 'meeting')
        AND NOT app_audience_ok(c.case_type::text, c.case_id, app_uid()))
    AND NOT EXISTS (
      SELECT 1 FROM ai_messages m
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(m.citations) = 'array' THEN m.citations ELSE '[]'::jsonb END) x
      WHERE m.conversation_id = conv AND x ->> 'sourceType' IN ('document', 'meeting', 'meeting_note')
        AND NOT app_audience_entity_ok(x ->> 'sourceType', app_try_uuid(x ->> 'sourceId'), app_uid()))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_chat_audience_ok(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_chat_audience_ok(uuid) TO selah_app;
--> statement-breakpoint
CREATE POLICY audience ON ai_conversations AS RESTRICTIVE FOR ALL TO selah_app USING (app_chat_audience_ok(id));
