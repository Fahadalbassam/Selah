ALTER TABLE "ai_conversations" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "content_translations" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "project_ids" uuid[];--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversation_case_project" CHECK ("ai_conversations"."case_id" IS NULL OR "ai_conversations"."project_id" IS NOT NULL);--> statement-breakpoint
-- ==========================================================================
-- Assistant chats across projects ("All my clients", 2026-10-25)
-- ==========================================================================
-- A chat with no project asks across every project the person may ask
-- about. Retrieval still runs project by project through the same
-- permission check (src/services/assistant.ts), so nothing new is readable.
-- What is new is that one answer can quote several projects, so:
--   1. Each question and answer in such a chat records the projects its
--      passages came from (project_ids). Both are readable only while the
--      person can still see every one of them: a consultant taken off a
--      client stops reading old answers that quote it, as with project chats.
--   2. A deleted project takes those messages with it, and the nightly job
--      deletes them once a project they quote is past the firm's days after
--      closing, as a project chat would be.
--   3. The chat itself is deleted after the firm's idle days (no project to
--      close). Its firm is the owner's firm.
--   4. Its answers can be translated like any other answer.

CREATE OR REPLACE FUNCTION app_sees_projects(ids uuid[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT ids IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(ids) x WHERE NOT app_can_see_project(x))
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_sees_projects(uuid[]) TO selah_app;
--> statement-breakpoint
DROP POLICY own ON ai_conversations;
--> statement-breakpoint
CREATE POLICY own ON ai_conversations FOR ALL TO selah_app
  USING (user_id = app_uid() AND (project_id IS NULL OR app_can_see_project(project_id)))
  WITH CHECK (user_id = app_uid() AND (project_id IS NULL OR app_can_see_project(project_id)));
--> statement-breakpoint
DROP POLICY own ON ai_messages;
--> statement-breakpoint
-- The subquery runs under ai_conversations' own policy.
CREATE POLICY own ON ai_messages FOR ALL TO selah_app
  USING (user_id = app_uid() AND EXISTS (SELECT 1 FROM ai_conversations c WHERE c.id = conversation_id) AND app_sees_projects(project_ids))
  WITH CHECK (user_id = app_uid() AND EXISTS (SELECT 1 FROM ai_conversations c WHERE c.id = conversation_id) AND app_sees_projects(project_ids));
--> statement-breakpoint
-- project_ids only in a chat across projects, and only projects the writer can see (the policy).
CREATE FUNCTION check_chat_message() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.project_ids IS NOT NULL AND EXISTS (SELECT 1 FROM ai_conversations c WHERE c.id = NEW.conversation_id AND c.project_id IS NOT NULL) THEN
    RAISE EXCEPTION 'a project chat''s messages name no projects' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER check_chat_message BEFORE INSERT ON ai_messages FOR EACH ROW EXECUTE FUNCTION check_chat_message();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_chat() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE found boolean;
BEGIN
  IF current_user = 'selah_app' THEN
    IF TG_OP = 'UPDATE' AND (NEW.user_id <> OLD.user_id OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN
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
-- ------------------------------------------------------------ 2. deletion
CREATE FUNCTION drop_chat_messages_of_project() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM ai_messages WHERE OLD.id = ANY(project_ids);
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION drop_chat_messages_of_project() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER drop_chat_messages AFTER DELETE ON projects FOR EACH ROW EXECUTE FUNCTION drop_chat_messages_of_project();
--> statement-breakpoint
CREATE INDEX ai_messages_projects_idx ON ai_messages USING gin (project_ids) WHERE project_ids IS NOT NULL;
--> statement-breakpoint
-- ------------------------------------------------------------ 3. retention
-- The firm a person works for or with: their own organisation when it is
-- the firm, otherwise the firm their organisation's projects are with.
CREATE FUNCTION app_chat_firm(uid uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT m.org_id FROM org_memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = uid AND o.kind = 'firm' LIMIT 1),
    (SELECT p.firm_org_id FROM org_memberships m JOIN projects p ON p.org_id = m.org_id WHERE m.user_id = uid LIMIT 1))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_chat_firm(uuid) FROM PUBLIC;
--> statement-breakpoint
-- The day a chat will be deleted, for any chat: a project chat as before,
-- a chat across projects after the firm's idle days.
CREATE FUNCTION app_chat_delete_on(last_at timestamptz, pid uuid, uid uuid) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN pid IS NOT NULL THEN app_chat_delete_on(last_at, pid)
    WHEN session_user <> 'selah_app' OR uid = app_uid() THEN
      app_firm_date(last_at) + coalesce((SELECT fs.chat_idle_delete_days FROM firm_settings fs WHERE fs.org_id = app_chat_firm(uid)), 180)
  END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_chat_delete_on(timestamptz, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_chat_delete_on(timestamptz, uuid, uuid) TO selah_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_purge_chats(today date, OUT archived integer, OUT deleted integer)
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE ai_conversations c SET archived_at = now()
    WHERE c.archived_at IS NULL AND NOT c.keep
      AND app_firm_date(c.last_message_at) + coalesce((
        SELECT fs.chat_archive_days FROM firm_settings fs
        WHERE fs.org_id = coalesce((SELECT p.firm_org_id FROM projects p WHERE p.id = c.project_id), app_chat_firm(c.user_id))), 30) <= today;
  GET DIAGNOSTICS archived = ROW_COUNT;

  -- Answers quoting a project past the firm's days after closing go, as that project's own chats do.
  DELETE FROM ai_messages m
    USING projects p LEFT JOIN firm_settings fs ON fs.org_id = p.firm_org_id
    WHERE m.project_ids IS NOT NULL AND p.id = ANY(m.project_ids)
      AND app_firm_date(p.closed_at) + coalesce(fs.chat_after_close_days, 90) <= today;

  WITH gone AS (
    DELETE FROM ai_conversations c
      WHERE app_chat_delete_on(c.last_message_at, c.project_id, c.user_id) <= today
      RETURNING c.id, c.user_id, c.project_id
  )
  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, reason)
    SELECT NULL, coalesce((SELECT p.org_id FROM projects p WHERE p.id = g.project_id), app_chat_firm(g.user_id)),
      'assistant.chat_deleted', 'ai_conversation', g.id, 'allow', 'retention'
    FROM gone g;
  GET DIAGNOSTICS deleted = ROW_COUNT;
END $$;
--> statement-breakpoint
-- ------------------------------------------------------------ 4. translation
CREATE OR REPLACE FUNCTION app_translation_source(etype text, eid uuid, fld text)
RETURNS TABLE (project_id uuid, org_id uuid, body text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  CASE etype || '.' || fld
    WHEN 'recommendation.title' THEN RETURN QUERY SELECT r.project_id, r.org_id, r.title FROM recommendations r WHERE r.id = eid;
    WHEN 'recommendation.rationale' THEN RETURN QUERY SELECT r.project_id, r.org_id, r.rationale FROM recommendations r WHERE r.id = eid;
    WHEN 'recommendation.target_outcome' THEN RETURN QUERY SELECT r.project_id, r.org_id, r.target_outcome FROM recommendations r WHERE r.id = eid;
    WHEN 'recommendation.required_evidence' THEN RETURN QUERY SELECT r.project_id, r.org_id, r.required_evidence FROM recommendations r WHERE r.id = eid;
    WHEN 'action.title' THEN RETURN QUERY SELECT a.project_id, a.org_id, a.title FROM actions a WHERE a.id = eid;
    WHEN 'action.description' THEN RETURN QUERY SELECT a.project_id, a.org_id, a.description FROM actions a WHERE a.id = eid;
    WHEN 'action.blocked_reason' THEN RETURN QUERY SELECT a.project_id, a.org_id, a.blocked_reason FROM actions a WHERE a.id = eid;
    WHEN 'action.closure_note' THEN RETURN QUERY SELECT a.project_id, a.org_id, a.closure_note FROM actions a WHERE a.id = eid;
    WHEN 'finding.title' THEN RETURN QUERY SELECT f.project_id, f.org_id, f.title FROM findings f WHERE f.id = eid;
    WHEN 'finding.description' THEN RETURN QUERY SELECT f.project_id, f.org_id, f.description FROM findings f WHERE f.id = eid;
    WHEN 'meeting_summary.main_points_md' THEN
      RETURN QUERY SELECT s.project_id, s.org_id, s.main_points_md FROM meeting_summaries s WHERE s.meeting_id = eid;
    WHEN 'meeting_decision.text' THEN RETURN QUERY SELECT d.project_id, d.org_id, d.text FROM meeting_decisions d WHERE d.id = eid;
    WHEN 'progress_update.body' THEN RETURN QUERY SELECT p.project_id, p.org_id, p.body FROM progress_updates p WHERE p.id = eid;
    WHEN 'assessment_answer.comment' THEN RETURN QUERY SELECT x.project_id, x.org_id, x.comment FROM assessment_answers x WHERE x.id = eid;
    -- An assistant answer: only its owner reads it (row-level security on ai_messages).
    WHEN 'ai_message.content' THEN
      -- In a chat across projects there is no one project: the asker's own organisation.
      RETURN QUERY SELECT c.project_id, coalesce(p.org_id, app_org()), m.content FROM ai_messages m
        JOIN ai_conversations c ON c.id = m.conversation_id LEFT JOIN projects p ON p.id = c.project_id
        WHERE m.id = eid AND m.role = 'assistant';
    ELSE RAISE EXCEPTION 'this text cannot be translated' USING ERRCODE = 'check_violation';
  END CASE;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_translation_current(etype text, eid uuid, fld text, pid uuid, oid uuid, hash text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_translation_source(etype, eid, fld) s
    WHERE s.body IS NOT NULL AND s.project_id IS NOT DISTINCT FROM pid AND s.org_id = oid
      AND encode(sha256(convert_to(s.body, 'UTF8')), 'hex') = hash
  )
$$;
--> statement-breakpoint
-- A streamed answer that failed gives the question back: ask() counts in the
-- transaction that answers, so a failure rolls the count back, but a streamed
-- answer is counted in the transaction that prepared it, which has ended.
-- Only the caller's own count, never below zero.
CREATE FUNCTION app_uncount_ai_question(p_day date) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE ai_usage SET queries = queries - 1 WHERE user_id = app_uid() AND day = p_day AND queries > 0;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_uncount_ai_question(date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_uncount_ai_question(date) TO selah_app;
