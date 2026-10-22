-- AI sources and languages (docs/assistant.md). Research thread, 2026-10-21.
--
--   1. Chat messages are stored once, with their language. An assistant
--      answer is shown in the other language through the translation cache,
--      like any other text, and only its owner can read either.
--   2. A file summary is made once per file version and language, and kept.
--      It is read with the file's own rights, follows the file's AI flag,
--      and has its own, lower hourly limit.
--   3. Every line of a meeting summary can point at where it came from: a
--      transcript passage or a page of a project file.
--   4. A file whose text can't be read is marked not searchable; only the
--      indexing job (the schema owner) sets that.

ALTER TABLE ai_messages ADD CONSTRAINT ai_message_lang CHECK (lang IN ('ar', 'en'));
--> statement-breakpoint
ALTER TABLE ai_chunks ADD CONSTRAINT ai_chunk_page CHECK (page IS NULL OR page >= 1);
--> statement-breakpoint
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
      RETURN QUERY SELECT c.project_id, p.org_id, m.content FROM ai_messages m
        JOIN ai_conversations c ON c.id = m.conversation_id JOIN projects p ON p.id = c.project_id
        WHERE m.id = eid AND m.role = 'assistant';
    ELSE RAISE EXCEPTION 'this text cannot be translated' USING ERRCODE = 'check_violation';
  END CASE;
END $$;
--> statement-breakpoint
CREATE TRIGGER translations_follow AFTER UPDATE OR DELETE ON ai_messages
  FOR EACH ROW EXECUTE FUNCTION drop_translations('ai_message', 'id', 'content');
--> statement-breakpoint

-- ------------------------------------------------------- text status

CREATE FUNCTION check_text_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Set by the indexing job (the schema owner), never by a person.
  IF session_user = 'selah_app' AND (TG_OP = 'INSERT' AND NEW.text_status <> 'pending'
     OR TG_OP = 'UPDATE' AND NEW.text_status <> OLD.text_status) THEN
    RAISE EXCEPTION 'the text status is set by the indexing job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- These changes drop the file's passages (drop_document_chunks,
  -- drop_department_chunks): the job indexes it again.
  IF TG_OP = 'UPDATE' AND (NEW.ai_indexable AND NOT OLD.ai_indexable OR NEW.visibility <> OLD.visibility
     OR NEW.department_id IS DISTINCT FROM OLD.department_id) THEN
    NEW.text_status := 'pending';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER text_status BEFORE INSERT OR UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION check_text_status();
--> statement-breakpoint
-- A file's passages are read only by people who can open the file, still
-- indexable and not archived, whatever the passage's own label says.
CREATE POLICY with_file ON ai_chunks AS RESTRICTIVE FOR SELECT TO selah_app
  USING (source_type <> 'document'
         OR EXISTS (SELECT 1 FROM documents d WHERE d.id = source_id AND d.ai_indexable AND d.state <> 'archived'));
--> statement-breakpoint

-- --------------------------------------------------- file summaries

GRANT SELECT, INSERT ON document_summaries TO selah_app;
--> statement-breakpoint
ALTER TABLE document_summaries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The file's own row-level security decides, through the subquery.
CREATE POLICY with_file ON document_summaries FOR SELECT TO selah_app
  USING (EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id AND d.ai_indexable AND d.state <> 'archived'));
--> statement-breakpoint
CREATE POLICY make_with_file ON document_summaries FOR INSERT TO selah_app
  WITH CHECK (created_by = app_uid() AND EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = document_id AND d.ai_indexable AND d.state <> 'archived' AND d.text_status = 'searchable'
      AND d.scan_status::text IN ('clean', 'skipped') AND d.sha256 = document_summaries.sha256));
--> statement-breakpoint
CREATE FUNCTION check_document_summary() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d documents%ROWTYPE; lines integer; c jsonb;
BEGIN
  SELECT * INTO d FROM documents WHERE id = NEW.document_id;
  NEW.project_id := d.project_id;
  NEW.org_id := d.org_id;
  NEW.created_at := now();
  IF NEW.lang NOT IN ('ar', 'en') THEN
    RAISE EXCEPTION 'a summary is in Arabic or English' USING ERRCODE = 'check_violation';
  END IF;
  -- Every line cites at least one page of the file.
  lines := array_length(string_to_array(rtrim(NEW.summary, E'\n'), E'\n'), 1);
  IF jsonb_typeof(NEW.citations) <> 'array' OR jsonb_array_length(NEW.citations) <> lines THEN
    RAISE EXCEPTION 'cite the pages for every line of the summary' USING ERRCODE = 'check_violation';
  END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(NEW.citations) LOOP
    IF jsonb_typeof(c -> 'line') <> 'number' OR (c ->> 'line')::integer NOT BETWEEN 1 AND lines
       OR jsonb_typeof(c -> 'pages') <> 'array' OR jsonb_array_length(c -> 'pages') = 0
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(c -> 'pages') p WHERE jsonb_typeof(p) <> 'number' OR (p #>> '{}')::numeric < 1) THEN
      RAISE EXCEPTION 'each citation is a line and the pages it rests on' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  -- Each summary is a model call: at most 30 a person an hour (translations allow 200).
  IF session_user = 'selah_app' AND (SELECT count(*) FROM document_summaries
      WHERE created_by = app_uid() AND created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'too many summaries, try again later' USING ERRCODE = 'SL429';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER summary_rules BEFORE INSERT ON document_summaries FOR EACH ROW EXECUTE FUNCTION check_document_summary();
--> statement-breakpoint
CREATE TRIGGER minimal_records BEFORE INSERT ON document_summaries FOR EACH ROW EXECUTE FUNCTION refuse_minimal_records();
--> statement-breakpoint
-- Gone with the file's AI flag, a change of who may see it, archiving, and a new version.
CREATE FUNCTION drop_document_summaries() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    DELETE FROM document_summaries WHERE document_id = NEW.supersedes_id;
  ELSIF NOT NEW.ai_indexable OR NEW.visibility <> OLD.visibility OR NEW.state = 'archived'
        OR NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    DELETE FROM document_summaries WHERE document_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_summaries_follow AFTER UPDATE OF ai_indexable, visibility, state, department_id ON documents
  FOR EACH ROW EXECUTE FUNCTION drop_document_summaries();
--> statement-breakpoint
CREATE TRIGGER document_summaries_new_version AFTER INSERT ON documents
  FOR EACH ROW WHEN (NEW.supersedes_id IS NOT NULL) EXECUTE FUNCTION drop_document_summaries();
--> statement-breakpoint

-- ------------------------------------------ meeting summary sources

GRANT SELECT, INSERT, DELETE ON meeting_summary_sources TO selah_app;
--> statement-breakpoint
ALTER TABLE meeting_summary_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Seen with the summary. A transcript pointer is the firm's (the client never
-- sees a transcript); a file pointer only by people who can open the file.
CREATE POLICY with_summary ON meeting_summary_sources FOR SELECT TO selah_app
  USING (EXISTS (SELECT 1 FROM meeting_summaries s WHERE s.meeting_id = meeting_summary_sources.meeting_id)
         AND CASE kind WHEN 'transcript' THEN app_org_kind() = 'firm'
                       ELSE EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id) END);
--> statement-breakpoint
CREATE POLICY firm_writes ON meeting_summary_sources FOR INSERT TO selah_app
  WITH CHECK (app_org_kind() = 'firm' AND app_can_run_meeting(meeting_id)
              AND (kind = 'transcript' OR EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id)));
--> statement-breakpoint
CREATE POLICY firm_removes ON meeting_summary_sources FOR DELETE TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_run_meeting(meeting_id));
--> statement-breakpoint
CREATE FUNCTION check_summary_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s meeting_summaries%ROWTYPE; d documents%ROWTYPE; lines integer; body text;
BEGIN
  SELECT * INTO s FROM meeting_summaries WHERE meeting_id = NEW.meeting_id;
  NEW.project_id := s.project_id;
  NEW.org_id := s.org_id;
  lines := array_length(string_to_array(rtrim(s.main_points_md, E'\n'), E'\n'), 1);
  IF NEW.line NOT BETWEEN 1 AND lines THEN
    RAISE EXCEPTION 'the summary has no line %', NEW.line USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'transcript' THEN
    SELECT t.body INTO body FROM meeting_transcripts t WHERE t.meeting_id = NEW.meeting_id;
    IF body IS NULL OR NEW.document_id IS NOT NULL OR NEW.page IS NOT NULL OR NEW.transcript_start IS NULL
       OR NEW.transcript_end IS NULL OR NEW.transcript_start < 0 OR NEW.transcript_end <= NEW.transcript_start
       OR NEW.transcript_end > length(body) THEN
      RAISE EXCEPTION 'a transcript source is a passage of this meeting''s transcript' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT * INTO d FROM documents WHERE id = NEW.document_id;
    IF d.id IS NULL OR d.project_id <> s.project_id OR NEW.page IS NULL OR NEW.page < 1
       OR NEW.transcript_start IS NOT NULL OR NEW.transcript_end IS NOT NULL THEN
      RAISE EXCEPTION 'a file source is a page of a file in this project' USING ERRCODE = 'check_violation';
    END IF;
    NEW.document_version := d.version;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER source_rules BEFORE INSERT ON meeting_summary_sources FOR EACH ROW EXECUTE FUNCTION check_summary_source();
--> statement-breakpoint
-- Rewriting the summary's text retires its pointers: the lines have moved.
CREATE FUNCTION drop_summary_sources() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM meeting_summary_sources WHERE meeting_id = NEW.meeting_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER summary_sources_follow AFTER UPDATE OF main_points_md ON meeting_summaries
  FOR EACH ROW WHEN (OLD.main_points_md IS DISTINCT FROM NEW.main_points_md) EXECUTE FUNCTION drop_summary_sources();
