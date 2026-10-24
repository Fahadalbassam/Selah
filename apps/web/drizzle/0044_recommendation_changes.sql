ALTER TABLE "findings" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "withdrawn_by" uuid;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "withdrawn_reason" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "withdrawn_by" uuid;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "withdrawn_reason" text;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_withdrawn_by_user_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_withdrawn_by_user_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Hand-written: correcting, releasing, withdrawing and deleting findings and
-- recommendations (journey-map gap N1, 2026-10-24). Until now they could only
-- be created. The rule is the one the journey map settled: archive what was
-- released, delete only what the client never saw.
ALTER TABLE findings ADD CONSTRAINT findings_withdrawn_whole CHECK (
  (withdrawn_at IS NULL) = (withdrawn_by IS NULL) AND (withdrawn_at IS NULL) = (withdrawn_reason IS NULL));
--> statement-breakpoint
ALTER TABLE recommendations ADD CONSTRAINT recommendations_withdrawn_whole CHECK (
  (withdrawn_at IS NULL) = (withdrawn_by IS NULL) AND (withdrawn_at IS NULL) = (withdrawn_reason IS NULL));
--> statement-breakpoint
-- Records shared from the start count as released when they were made.
UPDATE findings SET released_at = created_at WHERE visibility = 'shared';
--> statement-breakpoint
UPDATE recommendations SET released_at = created_at WHERE visibility = 'shared';
--> statement-breakpoint
-- 1. What a change may do.
--    - A withdrawn record is final.
--    - The label moves one way only, firm-only to shared, and the database
--      stamps when (released_at is never written by hand).
--    - Withdrawing needs a reason. A recommendation is withdrawn once none
--      of its actions is still open or a draft (the app closes and deletes
--      them first); a finding once no live recommendation answers it.
CREATE FUNCTION check_releasable_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  -- The minimal-records purge blanks text on withdrawn records too. Not
  -- SECURITY DEFINER, so current_user is the caller and the app can't use it.
  IF current_setting('selah.purge', true) = 'on' AND current_user NOT IN ('selah_app', 'selah_auth') THEN
    RETURN NEW;
  END IF;
  IF OLD.withdrawn_at IS NOT NULL THEN
    IF (to_jsonb(NEW) - '{updated_at,meeting_note_id}'::text[]) IS DISTINCT FROM (to_jsonb(OLD) - '{updated_at,meeting_note_id}'::text[]) THEN
      RAISE EXCEPTION 'a withdrawn % cannot change', rtrim(TG_TABLE_NAME, 's') USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.visibility IS DISTINCT FROM OLD.visibility THEN
    IF NOT (OLD.visibility = 'firm_private' AND NEW.visibility = 'shared') THEN
      RAISE EXCEPTION 'a % moves only from firm-only to shared', rtrim(TG_TABLE_NAME, 's') USING ERRCODE = 'check_violation';
    END IF;
    NEW.released_at := now();
  ELSE
    NEW.released_at := OLD.released_at;
  END IF;
  IF NEW.withdrawn_at IS NOT NULL THEN
    IF coalesce(btrim(NEW.withdrawn_reason), '') = '' THEN
      RAISE EXCEPTION 'withdrawing needs a reason' USING ERRCODE = 'check_violation';
    END IF;
    NEW.withdrawn_at := now();
    NEW.withdrawn_by := coalesce(app_uid(), NEW.withdrawn_by);
    IF TG_TABLE_NAME = 'recommendations' AND EXISTS (
      SELECT 1 FROM actions a WHERE a.recommendation_id = NEW.id AND a.status NOT IN ('verified_complete', 'closed')) THEN
      RAISE EXCEPTION 'close or delete its open actions before withdrawing the recommendation' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_TABLE_NAME = 'findings' AND EXISTS (
      SELECT 1 FROM recommendations r WHERE r.finding_id = NEW.id AND r.withdrawn_at IS NULL) THEN
      RAISE EXCEPTION 'withdraw the recommendations that answer this finding first' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.withdrawn_by IS NOT NULL OR NEW.withdrawn_reason IS NOT NULL THEN
    RAISE EXCEPTION 'a withdrawal is recorded whole' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
-- A new record starts unreleased and live, unless it is shared from the start.
CREATE FUNCTION start_releasable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.released_at := CASE WHEN NEW.visibility = 'shared' THEN now() END;
  NEW.withdrawn_at := NULL;
  NEW.withdrawn_by := NULL;
  NEW.withdrawn_reason := NULL;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_releasable_change(), start_releasable() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER releasable_change BEFORE UPDATE ON findings FOR EACH ROW EXECUTE FUNCTION check_releasable_change();
--> statement-breakpoint
CREATE TRIGGER releasable_change BEFORE UPDATE ON recommendations FOR EACH ROW EXECUTE FUNCTION check_releasable_change();
--> statement-breakpoint
CREATE TRIGGER releasable_start BEFORE INSERT ON findings FOR EACH ROW EXECUTE FUNCTION start_releasable();
--> statement-breakpoint
CREATE TRIGGER releasable_start BEFORE INSERT ON recommendations FOR EACH ROW EXECUTE FUNCTION start_releasable();
--> statement-breakpoint
-- 2. Deleting, by anyone using Selah. Only what the client never saw: a
--    firm-only record never released, a recommendation with no released
--    actions (drafts go with it), a finding no recommendation answers.
--    The schema owner's own work (deleting a never-signed client with
--    app_discard_client, maintenance) is not held to it. Not SECURITY
--    DEFINER, so current_user is the caller.
CREATE FUNCTION check_releasable_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user NOT IN ('selah_app', 'selah_auth') THEN
    RETURN OLD;
  END IF;
  IF OLD.visibility = 'shared' OR OLD.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'a released % is withdrawn, not deleted', rtrim(TG_TABLE_NAME, 's') USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'recommendations' AND EXISTS (
    SELECT 1 FROM actions a WHERE a.recommendation_id = OLD.id AND a.status <> 'draft') THEN
    RAISE EXCEPTION 'a recommendation with released actions is withdrawn, not deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'findings' AND EXISTS (SELECT 1 FROM recommendations r WHERE r.finding_id = OLD.id) THEN
    RAISE EXCEPTION 'a finding with recommendations cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_releasable_delete() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER releasable_delete BEFORE DELETE ON findings FOR EACH ROW EXECUTE FUNCTION check_releasable_delete();
--> statement-breakpoint
CREATE TRIGGER releasable_delete BEFORE DELETE ON recommendations FOR EACH ROW EXECUTE FUNCTION check_releasable_delete();
--> statement-breakpoint
-- 3. Nothing new starts under a withdrawn recommendation: no new action, no
--    action moved under it, no closed action reopened.
CREATE FUNCTION refuse_withdrawn_recommendation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.recommendation_id IS DISTINCT FROM OLD.recommendation_id
      OR (OLD.status IN ('verified_complete', 'closed') AND NEW.status NOT IN ('verified_complete', 'closed')))
     AND EXISTS (SELECT 1 FROM recommendations r WHERE r.id = NEW.recommendation_id AND r.withdrawn_at IS NOT NULL) THEN
    RAISE EXCEPTION 'the recommendation was withdrawn' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION refuse_withdrawn_recommendation() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER withdrawn_recommendation BEFORE INSERT OR UPDATE OF recommendation_id, status ON actions
  FOR EACH ROW EXECUTE FUNCTION refuse_withdrawn_recommendation();
--> statement-breakpoint
-- 4. The assistant stops citing a withdrawn recommendation or its actions.
--    The passage goes when it is withdrawn (as for a change of text or
--    label), and the indexing job skips withdrawn records (src/jobs/index-documents.ts).
CREATE OR REPLACE FUNCTION drop_record_chunks() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Saving a form writes every field; only a real change drops the passage.
    IF TG_TABLE_NAME = 'recommendations' THEN
      IF (NEW.title, NEW.rationale, NEW.target_outcome, NEW.required_evidence, NEW.visibility, NEW.withdrawn_at)
         IS NOT DISTINCT FROM (OLD.title, OLD.rationale, OLD.target_outcome, OLD.required_evidence, OLD.visibility, OLD.withdrawn_at) THEN
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
DROP TRIGGER record_chunks ON recommendations;
--> statement-breakpoint
CREATE TRIGGER record_chunks AFTER UPDATE OF title, rationale, target_outcome, required_evidence, visibility, withdrawn_at ON recommendations
  FOR EACH ROW EXECUTE FUNCTION drop_record_chunks();
