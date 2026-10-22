-- Assistant chats (docs/assistant.md): titles, a case, archiving and deletion.
--
--   1. A chat's messages are readable only while the chat is. A chat is
--      already hidden once its owner can't see its project (0001); its
--      messages weren't, so a consultant taken off a client could still read
--      old answers quoting that client's files.
--   2. Messages are a record of what was asked and answered: nobody edits one.
--   3. A chat stays in its project and with its owner. Its case, when set, is
--      a record of that project the owner can see; deleting the record
--      unlinks it.
--   4. A project gets closed_at, set by the database when it closes.
--   5. A nightly job archives chats idle for a while (unless kept) and
--      deletes them a while after the project closes or after their last
--      message, whichever comes first. Their translations go with them.
--   6. The names to mask before text goes to a hosted model.

-- ------------------------------------------------------------ 1. reading

DROP POLICY own ON ai_messages;
--> statement-breakpoint
-- The subquery runs under ai_conversations' own policy.
CREATE POLICY own ON ai_messages FOR ALL TO selah_app
  USING (user_id = app_uid() AND EXISTS (SELECT 1 FROM ai_conversations c WHERE c.id = conversation_id))
  WITH CHECK (user_id = app_uid() AND EXISTS (SELECT 1 FROM ai_conversations c WHERE c.id = conversation_id));
--> statement-breakpoint

-- ------------------------------------------------------------ 2. messages

REVOKE UPDATE ON ai_messages FROM selah_app;
--> statement-breakpoint

-- ---------------------------------------------------- 3. the chat itself

CREATE FUNCTION check_chat() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE found boolean;
BEGIN
  IF current_user = 'selah_app' THEN
    IF TG_OP = 'UPDATE' AND (NEW.user_id <> OLD.user_id OR NEW.project_id <> OLD.project_id) THEN
      RAISE EXCEPTION 'a chat stays in its project' USING ERRCODE = 'check_violation';
    END IF;
    -- Set by the database when a message is added.
    IF TG_OP = 'INSERT' THEN
      NEW.last_message_at := now();
    ELSIF NEW.last_message_at IS DISTINCT FROM OLD.last_message_at THEN
      RAISE EXCEPTION 'the last message time is set by the database' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  NEW.title := btrim(NEW.title);
  -- The case must be a record of the same project, read under the person's own rights.
  IF NEW.case_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.case_id IS DISTINCT FROM OLD.case_id) THEN
    CASE NEW.case_type
      WHEN 'recommendation' THEN SELECT EXISTS (SELECT 1 FROM recommendations r WHERE r.id = NEW.case_id AND r.project_id = NEW.project_id) INTO found;
      WHEN 'action' THEN SELECT EXISTS (SELECT 1 FROM actions a WHERE a.id = NEW.case_id AND a.project_id = NEW.project_id) INTO found;
      WHEN 'finding' THEN SELECT EXISTS (SELECT 1 FROM findings f WHERE f.id = NEW.case_id AND f.project_id = NEW.project_id) INTO found;
      WHEN 'meeting' THEN SELECT EXISTS (SELECT 1 FROM meetings m WHERE m.id = NEW.case_id AND m.project_id = NEW.project_id) INTO found;
      WHEN 'document' THEN SELECT EXISTS (SELECT 1 FROM documents d WHERE d.id = NEW.case_id AND d.project_id = NEW.project_id) INTO found;
    END CASE;
    IF NOT found THEN
      RAISE EXCEPTION 'the case must be a record of the chat''s project' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER check_chat BEFORE INSERT OR UPDATE ON ai_conversations FOR EACH ROW EXECUTE FUNCTION check_chat();
--> statement-breakpoint

-- A new message brings its chat back from the archive.
CREATE FUNCTION touch_chat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE ai_conversations SET last_message_at = now(), archived_at = NULL WHERE id = NEW.conversation_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION touch_chat() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER touch_chat AFTER INSERT ON ai_messages FOR EACH ROW EXECUTE FUNCTION touch_chat();
--> statement-breakpoint

-- Deleting a record unlinks the chats about it; the chats stay in the project.
CREATE FUNCTION unlink_chat_case() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE ai_conversations SET case_type = NULL, case_id = NULL
    WHERE case_type = TG_ARGV[0]::chat_case_type AND case_id = OLD.id;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION unlink_chat_case() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER unlink_chat_case AFTER DELETE ON recommendations FOR EACH ROW EXECUTE FUNCTION unlink_chat_case('recommendation');
--> statement-breakpoint
CREATE TRIGGER unlink_chat_case AFTER DELETE ON actions FOR EACH ROW EXECUTE FUNCTION unlink_chat_case('action');
--> statement-breakpoint
CREATE TRIGGER unlink_chat_case AFTER DELETE ON findings FOR EACH ROW EXECUTE FUNCTION unlink_chat_case('finding');
--> statement-breakpoint
CREATE TRIGGER unlink_chat_case AFTER DELETE ON meetings FOR EACH ROW EXECUTE FUNCTION unlink_chat_case('meeting');
--> statement-breakpoint
CREATE TRIGGER unlink_chat_case AFTER DELETE ON documents FOR EACH ROW EXECUTE FUNCTION unlink_chat_case('document');
--> statement-breakpoint

-- Chats from before this migration: titled by their first question, dated by their last message.
UPDATE ai_conversations c SET
  title = coalesce((SELECT left(btrim(regexp_replace(m.content, '\s+', ' ', 'g')), 60) FROM ai_messages m
                    WHERE m.conversation_id = c.id AND m.role = 'user' ORDER BY m.created_at LIMIT 1), ''),
  last_message_at = coalesce((SELECT max(m.created_at) FROM ai_messages m WHERE m.conversation_id = c.id), c.created_at);
--> statement-breakpoint

-- --------------------------------------------------------- 4. closing

CREATE FUNCTION set_project_closed_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.state = 'closed' THEN
    NEW.closed_at := CASE WHEN TG_OP = 'UPDATE' AND OLD.state = 'closed' THEN OLD.closed_at ELSE now() END;
  ELSE
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER project_closed_at BEFORE INSERT OR UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_project_closed_at();
--> statement-breakpoint
-- Projects already closed start their window now, so nothing is deleted the night this ships.
UPDATE projects SET closed_at = now() WHERE state = 'closed';
--> statement-breakpoint

-- ------------------------------------------------------- 5. retention

ALTER TABLE firm_settings ADD CONSTRAINT chat_archive_days_range CHECK (chat_archive_days BETWEEN 7 AND 365);
--> statement-breakpoint
ALTER TABLE firm_settings ADD CONSTRAINT chat_after_close_days_range CHECK (chat_after_close_days BETWEEN 0 AND 365);
--> statement-breakpoint
ALTER TABLE firm_settings ADD CONSTRAINT chat_idle_delete_days_range
  CHECK (chat_idle_delete_days BETWEEN 30 AND 730 AND chat_idle_delete_days > chat_archive_days);
--> statement-breakpoint

-- The day a chat will be deleted: the earlier of its project's close plus
-- the firm's days, and its last message plus the firm's days.
CREATE FUNCTION app_chat_delete_on(last_at timestamptz, pid uuid) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT least(
    (p.closed_at AT TIME ZONE 'Asia/Riyadh')::date + coalesce(fs.chat_after_close_days, 90),
    (last_at AT TIME ZONE 'Asia/Riyadh')::date + coalesce(fs.chat_idle_delete_days, 180))
  FROM projects p LEFT JOIN firm_settings fs ON fs.org_id = p.firm_org_id
  WHERE p.id = pid AND (session_user <> 'selah_app' OR app_can_see_project(pid))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_chat_delete_on(timestamptz, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_chat_delete_on(timestamptz, uuid) TO selah_app;
--> statement-breakpoint

-- Run nightly by the schema owner (npm run job:purge-chats). The audit log
-- records each deletion, never what the chat said.
CREATE FUNCTION app_purge_chats(today date, OUT archived integer, OUT deleted integer)
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE ai_conversations c SET archived_at = now()
    FROM projects p LEFT JOIN firm_settings fs ON fs.org_id = p.firm_org_id
    WHERE p.id = c.project_id AND c.archived_at IS NULL AND NOT c.keep
      AND (c.last_message_at AT TIME ZONE 'Asia/Riyadh')::date + coalesce(fs.chat_archive_days, 30) <= today;
  GET DIAGNOSTICS archived = ROW_COUNT;

  WITH gone AS (
    DELETE FROM ai_conversations c USING projects p
      WHERE p.id = c.project_id AND app_chat_delete_on(c.last_message_at, c.project_id) <= today
      RETURNING c.id, c.user_id, p.org_id
  )
  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, reason)
    SELECT NULL, g.org_id, 'assistant.chat_deleted', 'ai_conversation', g.id, 'allow', 'retention'
    FROM gone g;
  GET DIAGNOSTICS deleted = ROW_COUNT;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_purge_chats(date) FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------- 6. masking

-- The names the web app masks before text about a project goes to a hosted
-- model: the client and the firm, their people and the client's contacts,
-- and the client's departments. Only for a project the caller can see; the
-- list never reaches the browser.
CREATE FUNCTION app_mask_terms(pid uuid) RETURNS TABLE (kind text, term text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH p AS (
    SELECT org_id, firm_org_id FROM projects
    WHERE id = pid AND (session_user <> 'selah_app' OR app_can_see_project(pid))
  ), terms AS (
    SELECT 'ORG' AS kind, unnest(ARRAY[o.name, o.name_ar, o.display_alias]) AS term
      FROM organizations o, p WHERE o.id IN (p.org_id, p.firm_org_id)
    UNION
    SELECT 'PERSON', u.name FROM "user" u JOIN org_memberships m ON m.user_id = u.id, p
      WHERE m.org_id IN (p.org_id, p.firm_org_id)
    UNION
    SELECT 'PERSON', c.name FROM client_contacts c, p WHERE c.org_id = p.org_id
    UNION
    SELECT 'DEPT', unnest(ARRAY[d.name_ar, d.name_en]) FROM departments d, p WHERE d.org_id = p.org_id
  )
  SELECT DISTINCT kind, btrim(term) FROM terms WHERE term IS NOT NULL AND length(btrim(term)) >= 2
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_mask_terms(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_mask_terms(uuid) TO selah_app;
