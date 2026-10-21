-- On-demand translations (docs/translations.md).
--
-- A translation can be read or made only by someone who can read the text it
-- comes from, and only while that text is unchanged: the source is read with
-- the caller's own rights (row-level security applies) and its hash must
-- match. Editing or deleting the source deletes its translations. Firm staff
-- may correct a translation and mark it reviewed; nobody deletes one.

GRANT SELECT, INSERT, UPDATE ON content_translations TO selah_app;
--> statement-breakpoint
ALTER TABLE content_translations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE content_translations ADD CONSTRAINT translation_langs
  CHECK (source_lang IN ('ar', 'en') AND target_lang IN ('ar', 'en') AND source_lang <> target_lang);
--> statement-breakpoint
ALTER TABLE content_translations ADD CONSTRAINT translation_hash CHECK (source_sha256 ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
ALTER TABLE content_translations ADD CONSTRAINT translation_text CHECK (length(text) BETWEEN 1 AND 40000);
--> statement-breakpoint
ALTER TABLE content_translations ADD CONSTRAINT translation_reviewed CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
--> statement-breakpoint

-- The only text that can be translated, read with the caller's rights: a row
-- they can't see returns nothing.
CREATE FUNCTION app_translation_source(etype text, eid uuid, fld text)
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
    ELSE RAISE EXCEPTION 'this text cannot be translated' USING ERRCODE = 'check_violation';
  END CASE;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_translation_source(text, uuid, text) TO selah_app;
--> statement-breakpoint

-- True when the caller can read the source and it is still the text this
-- translation was made from.
CREATE FUNCTION app_translation_current(etype text, eid uuid, fld text, pid uuid, oid uuid, hash text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_translation_source(etype, eid, fld) s
    WHERE s.body IS NOT NULL AND s.project_id = pid AND s.org_id = oid
      AND encode(sha256(convert_to(s.body, 'UTF8')), 'hex') = hash
  )
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_translation_current(text, uuid, text, uuid, uuid, text) TO selah_app;
--> statement-breakpoint

CREATE POLICY read_with_source ON content_translations FOR SELECT TO selah_app
  USING (app_translation_current(entity_type, entity_id, field, project_id, org_id, source_sha256));
--> statement-breakpoint
CREATE POLICY make_with_source ON content_translations FOR INSERT TO selah_app
  WITH CHECK (created_by = app_uid() AND reviewed_by IS NULL
              AND app_translation_current(entity_type, entity_id, field, project_id, org_id, source_sha256));
--> statement-breakpoint
CREATE POLICY firm_reviews ON content_translations FOR UPDATE TO selah_app
  USING (app_role() IN ('firm_admin', 'consultant')
         AND app_translation_current(entity_type, entity_id, field, project_id, org_id, source_sha256))
  WITH CHECK (app_role() IN ('firm_admin', 'consultant'));
--> statement-breakpoint

-- At most 200 new translations per person an hour: each one is a model call.
-- A review may change only the text, and records who reviewed it and when.
CREATE FUNCTION check_translation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- A definer function: session_user is who connected (the owner's jobs and tests skip these checks).
  IF session_user <> 'selah_app' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF (SELECT count(*) FROM content_translations
        WHERE created_by = app_uid() AND created_at > now() - interval '1 hour') >= 200 THEN
      RAISE EXCEPTION 'too many translations, try again later' USING ERRCODE = 'SL429';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.project_id, NEW.org_id, NEW.entity_type, NEW.entity_id, NEW.field, NEW.source_lang, NEW.target_lang,
      NEW.source_sha256, NEW.model, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.project_id, OLD.org_id, OLD.entity_type, OLD.entity_id, OLD.field, OLD.source_lang, OLD.target_lang,
      OLD.source_sha256, OLD.model, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'only the text of a translation can change' USING ERRCODE = 'check_violation';
  END IF;
  NEW.reviewed_by := app_uid();
  NEW.reviewed_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER translation_rules BEFORE INSERT OR UPDATE ON content_translations
  FOR EACH ROW EXECUTE FUNCTION check_translation();
--> statement-breakpoint

-- Editing a source field, blanking it (minimal records) or deleting the row
-- deletes its translations, so no old wording outlives the original.
-- Arguments: the entity type, the id column, then the translatable fields.
CREATE FUNCTION drop_translations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  etype text := TG_ARGV[0];
  eid uuid := (to_jsonb(OLD) ->> TG_ARGV[1])::uuid;
  f text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM content_translations WHERE entity_type = etype AND entity_id = eid;
    RETURN OLD;
  END IF;
  FOR i IN 2 .. TG_NARGS - 1 LOOP
    f := TG_ARGV[i];
    IF (to_jsonb(OLD) ->> f) IS DISTINCT FROM (to_jsonb(NEW) ->> f) THEN
      DELETE FROM content_translations WHERE entity_type = etype AND entity_id = eid AND field = f;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER translations_follow AFTER UPDATE OR DELETE ON recommendations
  FOR EACH ROW EXECUTE FUNCTION drop_translations('recommendation', 'id', 'title', 'rationale', 'target_outcome', 'required_evidence');
--> statement-breakpoint
CREATE TRIGGER translations_follow AFTER UPDATE OR DELETE ON actions
  FOR EACH ROW EXECUTE FUNCTION drop_translations('action', 'id', 'title', 'description', 'blocked_reason', 'closure_note');
--> statement-breakpoint
CREATE TRIGGER translations_follow AFTER UPDATE OR DELETE ON findings
  FOR EACH ROW EXECUTE FUNCTION drop_translations('finding', 'id', 'title', 'description');
--> statement-breakpoint
CREATE TRIGGER translations_follow AFTER UPDATE OR DELETE ON meeting_summaries
  FOR EACH ROW EXECUTE FUNCTION drop_translations('meeting_summary', 'meeting_id', 'main_points_md');
--> statement-breakpoint
CREATE TRIGGER translations_follow AFTER UPDATE OR DELETE ON meeting_decisions
  FOR EACH ROW EXECUTE FUNCTION drop_translations('meeting_decision', 'id', 'text');
--> statement-breakpoint
CREATE TRIGGER translations_follow AFTER UPDATE OR DELETE ON progress_updates
  FOR EACH ROW EXECUTE FUNCTION drop_translations('progress_update', 'id', 'body');
--> statement-breakpoint
CREATE TRIGGER translations_follow AFTER UPDATE OR DELETE ON assessment_answers
  FOR EACH ROW EXECUTE FUNCTION drop_translations('assessment_answer', 'id', 'comment');
