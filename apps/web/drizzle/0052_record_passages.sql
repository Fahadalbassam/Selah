-- Recommendations and actions as assistant passages (bug register 21,
-- approved 2026-10-22). A plain question about the plan ("what does
-- approving the board charter need?") found nothing, because only files were
-- searchable. The indexing job now adds one passage per recommendation and
-- per action (its title and written text) to ai_chunks, so they are found by
-- meaning and by words like file passages. What reaches the model is not the
-- passage but the record read live under the person's row-level security
-- (status, due date, last review), see linkedRecords() in
-- src/services/assistant.ts.
--
-- A record's passage is read only by someone who can read the record itself,
-- and the passage's label (its recommendation's) must allow it too: a client
-- never finds a firm-only recommendation or its actions, and a department's
-- action stays in it.
DROP POLICY with_file ON ai_chunks;
--> statement-breakpoint
CREATE POLICY with_source ON ai_chunks AS RESTRICTIVE FOR SELECT TO selah_app
  USING (CASE source_type
    WHEN 'document' THEN EXISTS (SELECT 1 FROM documents d WHERE d.id = source_id AND d.ai_indexable AND d.state <> 'archived')
    WHEN 'recommendation' THEN EXISTS (SELECT 1 FROM recommendations r WHERE r.id = source_id)
    WHEN 'action' THEN EXISTS (SELECT 1 FROM actions a WHERE a.id = source_id)
    ELSE true
  END);
--> statement-breakpoint

-- A record's passage goes when its text, its label or the record goes; the
-- job writes it again from the record as it now stands. An action's passage
-- carries its recommendation's title and label, so a change there drops the
-- actions' passages too. (A move to another department is 0025's trigger.)
CREATE FUNCTION drop_record_chunks() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Saving a form writes every field; only a real change drops the passage.
    IF TG_TABLE_NAME = 'recommendations' THEN
      IF (NEW.title, NEW.rationale, NEW.target_outcome, NEW.required_evidence, NEW.visibility)
         IS NOT DISTINCT FROM (OLD.title, OLD.rationale, OLD.target_outcome, OLD.required_evidence, OLD.visibility) THEN
        RETURN NULL;
      END IF;
    ELSIF (NEW.title, NEW.description, NEW.recommendation_id) IS NOT DISTINCT FROM (OLD.title, OLD.description, OLD.recommendation_id) THEN
      RETURN NULL;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'recommendations' THEN
    DELETE FROM ai_chunks WHERE (source_type = 'recommendation' AND source_id = OLD.id)
      OR (source_type = 'action' AND source_id IN (SELECT a.id FROM actions a WHERE a.recommendation_id = OLD.id));
  ELSE
    DELETE FROM ai_chunks WHERE source_type = 'action' AND source_id = OLD.id;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION drop_record_chunks() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER record_chunks AFTER UPDATE OF title, rationale, target_outcome, required_evidence, visibility ON recommendations
  FOR EACH ROW EXECUTE FUNCTION drop_record_chunks();
--> statement-breakpoint
CREATE TRIGGER record_chunks_gone AFTER DELETE ON recommendations
  FOR EACH ROW EXECUTE FUNCTION drop_record_chunks();
--> statement-breakpoint
CREATE TRIGGER record_chunks AFTER UPDATE OF title, description, recommendation_id ON actions
  FOR EACH ROW EXECUTE FUNCTION drop_record_chunks();
--> statement-breakpoint
CREATE TRIGGER record_chunks_gone AFTER DELETE ON actions
  FOR EACH ROW EXECUTE FUNCTION drop_record_chunks();
--> statement-breakpoint
-- One passage per record, even when two indexing runs overlap.
CREATE UNIQUE INDEX ai_chunks_record_uq ON ai_chunks (source_type, source_id) WHERE source_type IN ('recommendation', 'action');
