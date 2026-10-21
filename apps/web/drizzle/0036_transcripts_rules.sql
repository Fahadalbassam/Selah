-- Meeting transcripts (docs/meetings.md). Personal data (PDPL), so:
--   - imported only for a held meeting whose record says participants were told;
--   - firm staff who run the meeting import, read and delete it; clients never see it;
--   - never changed, only replaced;
--   - deleted when consent is withdrawn, and on delete_after: the firm's
--     transcript_keep_days after the summary is confirmed, or 90 days after
--     import at the latest (npm run job:purge-transcripts, daily).

GRANT SELECT, INSERT, DELETE ON meeting_transcripts TO selah_app;
--> statement-breakpoint
ALTER TABLE meeting_transcripts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE meeting_transcripts ADD CONSTRAINT transcript_lang CHECK (lang IN ('ar', 'en', 'mixed'));
--> statement-breakpoint
ALTER TABLE meeting_transcripts ADD CONSTRAINT transcript_format CHECK (format IN ('text', 'vtt', 'srt'));
--> statement-breakpoint
ALTER TABLE meeting_transcripts ADD CONSTRAINT transcript_size CHECK (length(body) BETWEEN 1 AND 500000);
--> statement-breakpoint
ALTER TABLE firm_settings ADD CONSTRAINT transcript_keep_days CHECK (transcript_keep_days BETWEEN 1 AND 90);
--> statement-breakpoint

CREATE POLICY firm_runs ON meeting_transcripts FOR ALL TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_run_meeting(meeting_id))
  WITH CHECK (app_org_kind() = 'firm' AND app_can_run_meeting(meeting_id) AND imported_by = app_uid());
--> statement-breakpoint

CREATE FUNCTION check_meeting_transcript() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m meetings%ROWTYPE; keep integer;
BEGIN
  SELECT * INTO m FROM meetings WHERE id = NEW.meeting_id;
  IF NOT m.transcript_consent THEN
    RAISE EXCEPTION 'record that participants were told the meeting may be transcribed before importing a transcript'
      USING ERRCODE = 'check_violation';
  END IF;
  IF m.status::text <> 'held' THEN
    RAISE EXCEPTION 'a transcript can be imported only for a held meeting' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.project_id <> m.project_id OR NEW.org_id <> m.org_id THEN
    RAISE EXCEPTION 'a transcript belongs to its meeting''s project' USING ERRCODE = 'check_violation';
  END IF;
  NEW.imported_at := now();
  -- Already summarised: keep it for the firm's days from now; otherwise 90 days at most.
  SELECT coalesce(max(s.transcript_keep_days), 30) INTO keep FROM firm_settings s;
  NEW.delete_after := CASE
    WHEN EXISTS (SELECT 1 FROM meeting_summaries x WHERE x.meeting_id = NEW.meeting_id)
      THEN (now() AT TIME ZONE 'Asia/Riyadh')::date + keep
    ELSE (now() AT TIME ZONE 'Asia/Riyadh')::date + 90
  END;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER transcript_rules BEFORE INSERT ON meeting_transcripts FOR EACH ROW EXECUTE FUNCTION check_meeting_transcript();
--> statement-breakpoint

-- Imports and deletions go to the meeting's activity, without the text.
CREATE FUNCTION log_meeting_transcript() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r meeting_transcripts%ROWTYPE := CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
  VALUES (app_uid(), r.org_id, CASE TG_OP WHEN 'DELETE' THEN 'meeting.transcript_delete' ELSE 'meeting.transcript_import' END,
          'meeting', r.meeting_id, 'allow',
          jsonb_build_object('lang', r.lang, 'format', r.format, 'chars', length(r.body), 'by_job', app_uid() IS NULL));
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER transcript_log AFTER INSERT OR DELETE ON meeting_transcripts FOR EACH ROW EXECUTE FUNCTION log_meeting_transcript();
--> statement-breakpoint

-- Consent withdrawn: the transcript goes at once.
CREATE FUNCTION transcript_consent_withdrawn() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM meeting_transcripts WHERE meeting_id = NEW.id;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER transcript_consent_withdrawn AFTER UPDATE OF transcript_consent ON meetings
  FOR EACH ROW WHEN (OLD.transcript_consent AND NOT NEW.transcript_consent) EXECUTE FUNCTION transcript_consent_withdrawn();
--> statement-breakpoint

-- The summary is confirmed (or rewritten): the transcript has done its job.
CREATE FUNCTION transcript_summary_confirmed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE keep integer;
BEGIN
  SELECT coalesce(max(s.transcript_keep_days), 30) INTO keep FROM firm_settings s;
  UPDATE meeting_transcripts SET delete_after = least(delete_after, (now() AT TIME ZONE 'Asia/Riyadh')::date + keep)
  WHERE meeting_id = NEW.meeting_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER transcript_summary_confirmed AFTER INSERT OR UPDATE ON meeting_summaries
  FOR EACH ROW EXECUTE FUNCTION transcript_summary_confirmed();
--> statement-breakpoint

-- Daily, as the schema owner.
CREATE FUNCTION app_purge_transcripts(today date) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  DELETE FROM meeting_transcripts WHERE delete_after <= today;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_purge_transcripts(date) FROM PUBLIC;
