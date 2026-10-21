-- Meetings (2026-10-20, research sections 5-6).
--
-- Selah records meetings and links to the call; it never hosts one. Call
-- links must be https on an allowlisted host, so a link that looks like it
-- came from the consultant cannot point anywhere else. Every change that
-- calendars must pick up bumps the .ics sequence, and the UID never
-- changes. Firm-private meetings, and their decisions and summaries, are
-- invisible to clients. Decisions are append-only; a summary is written
-- by a person (an AI draft counts only once someone confirms it).

ALTER TABLE meetings ADD CONSTRAINT meeting_times CHECK (ends_at > starts_at);
--> statement-breakpoint
ALTER TABLE meetings ADD CONSTRAINT meeting_spoken_lang CHECK (spoken_lang IN ('ar', 'en', 'mixed'));
--> statement-breakpoint
ALTER TABLE meetings ADD CONSTRAINT meeting_online_link CHECK (location <> 'online' OR join_url IS NOT NULL);
--> statement-breakpoint
ALTER TABLE meeting_decisions ADD CONSTRAINT decision_lang CHECK (lang IN ('ar', 'en'));
--> statement-breakpoint
ALTER TABLE meeting_summaries ADD CONSTRAINT summary_lang CHECK (lang IN ('ar', 'en'));
--> statement-breakpoint
ALTER TABLE meeting_summaries ADD CONSTRAINT summary_source CHECK (source IN ('manual', 'ai_draft_confirmed'));
--> statement-breakpoint
ALTER TABLE outbound_emails DROP CONSTRAINT outbound_kind;
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_kind CHECK (kind IN (
  'invitation', 'email_change.confirm', 'email_change.notice', 'access_review.due',
  'meeting.invite', 'meeting.cancel'));
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_meeting CHECK ((kind LIKE 'meeting.%') = (meeting_id IS NOT NULL));
--> statement-breakpoint

-- ------------------------------------------------------------- helpers

-- Whether `target` could open the project, by the same rules as
-- app_can_see_project() but for another person.
CREATE FUNCTION app_user_sees_project(target uuid, pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects e
    JOIN org_memberships m ON m.user_id = target AND m.active
    WHERE e.id = pid AND (
      (m.role = 'firm_admin' AND e.firm_org_id = m.org_id)
      OR (m.role = 'consultant' AND e.firm_org_id = m.org_id AND (
            EXISTS (SELECT 1 FROM project_members em WHERE em.project_id = pid AND em.user_id = target)
            OR (e.kind = 'client' AND EXISTS (
              SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = e.org_id AND ca.user_id = target AND ca.is_lead))))
      OR (m.role = 'client_admin' AND e.kind = 'client' AND e.org_id = m.org_id)
      OR (m.role IN ('client_manager', 'action_owner') AND e.kind = 'client' AND e.org_id = m.org_id
          AND EXISTS (SELECT 1 FROM project_members em WHERE em.project_id = pid AND em.user_id = target))
    )
  )
$$;
--> statement-breakpoint
CREATE FUNCTION app_can_see_meeting(mid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM meetings m
    WHERE m.id = mid AND app_can_see_project(m.project_id) AND app_label_ok(m.visibility, m.org_id, m.organizer_id)
  )
$$;
--> statement-breakpoint
-- The organiser, or the firm's people on the project, run a meeting.
CREATE FUNCTION app_can_run_meeting(mid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_can_see_meeting(mid) AND EXISTS (
    SELECT 1 FROM meetings m WHERE m.id = mid AND (m.organizer_id = app_uid() OR app_org_kind() = 'firm')
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_user_sees_project(uuid, uuid), app_can_see_meeting(uuid), app_can_run_meeting(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_see_meeting(uuid), app_can_run_meeting(uuid) TO selah_app;
--> statement-breakpoint

-- What to cover: the project's open actions that need attention, and what
-- changed since the last meeting that was held. Written once, at booking,
-- in the meeting's language (Arabic unless it is held in English).
CREATE FUNCTION app_meeting_agenda(pid uuid, before timestamptz, lang text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  last_held timestamptz := (SELECT max(m.starts_at) FROM meetings m WHERE m.project_id = pid AND m.status = 'held' AND m.starts_at < before);
  out text := '';
  part text;
  en boolean := lang = 'en';
BEGIN
  SELECT string_agg('- ' || a.title || CASE WHEN en THEN ' (due ' ELSE ' (الاستحقاق ' END || a.due_date || ')', E'\n' ORDER BY a.due_date) INTO part FROM (
    SELECT title, due_date FROM actions
    WHERE project_id = pid AND due_date < today AND status::text NOT IN ('draft', 'verified_complete', 'closed')
    ORDER BY due_date LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Overdue\n' ELSE E'## متأخرة\n' END || part || E'\n\n'; END IF;
  SELECT string_agg('- ' || a.title, E'\n' ORDER BY a.title) INTO part FROM (
    SELECT title FROM actions WHERE project_id = pid AND status = 'awaiting_review' ORDER BY title LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Awaiting review\n' ELSE E'## بانتظار المراجعة\n' END || part || E'\n\n'; END IF;
  SELECT string_agg('- ' || a.title || coalesce(': ' || a.blocked_reason, ''), E'\n' ORDER BY a.title) INTO part FROM (
    SELECT title, blocked_reason FROM actions WHERE project_id = pid AND status = 'blocked' ORDER BY title LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Blocked\n' ELSE E'## متوقفة\n' END || part || E'\n\n'; END IF;
  IF last_held IS NOT NULL THEN
    SELECT string_agg('- ' || a.title || ' (' || a.status || ')', E'\n' ORDER BY a.title) INTO part FROM (
      SELECT title, status::text AS status FROM actions
      WHERE project_id = pid AND updated_at > last_held AND status <> 'draft' ORDER BY title LIMIT 20) a;
    IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Changed since the last meeting\n' ELSE E'## ما تغيّر منذ الاجتماع السابق\n' END || part || E'\n\n'; END IF;
  END IF;
  RETURN nullif(rtrim(out, E'\n'), '');
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_meeting_agenda(uuid, timestamptz, text) FROM PUBLIC;
--> statement-breakpoint

-- ------------------------------------------------------------- meetings

GRANT SELECT, INSERT, UPDATE ON meetings TO selah_app;
--> statement-breakpoint
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY scoped_read ON meetings FOR SELECT TO selah_app
  USING (app_can_see_project(project_id) AND app_label_ok(visibility, org_id, organizer_id));
--> statement-breakpoint
-- The firm on the project books any meeting; a client admin or manager
-- books shared ones. Meetings are cancelled, never deleted.
CREATE POLICY book ON meetings FOR INSERT TO selah_app
  WITH CHECK (app_can_see_project(project_id) AND app_label_ok(visibility, org_id, organizer_id) AND organizer_id = app_uid()
    AND (app_org_kind() = 'firm' OR (app_role() IN ('client_admin', 'client_manager') AND visibility = 'shared')));
--> statement-breakpoint
CREATE POLICY run ON meetings FOR UPDATE TO selah_app
  USING (app_can_see_project(project_id) AND app_label_ok(visibility, org_id, organizer_id)
         AND (organizer_id = app_uid() OR app_org_kind() = 'firm'))
  WITH CHECK (app_can_see_project(project_id) AND app_label_ok(visibility, org_id, organizer_id)
         AND (app_org_kind() = 'firm' OR visibility = 'shared'));
--> statement-breakpoint
CREATE FUNCTION check_meeting() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE host text;
BEGIN
  IF NEW.join_url IS NOT NULL THEN
    host := lower(substring(NEW.join_url FROM '^https://([^/?#]+)'));
    NEW.provider := CASE
      WHEN host = 'meet.google.com' THEN 'google_meet'
      WHEN host IN ('teams.microsoft.com', 'teams.live.com') THEN 'teams'
      WHEN host = 'zoom.us' OR host ~ '^[a-z0-9-]+\.zoom\.us$' THEN 'zoom'
    END::meeting_provider;
    IF NEW.provider IS NULL THEN
      RAISE EXCEPTION 'use a Google Meet, Teams or Zoom link starting with https://' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    NEW.provider := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.ics_uid := gen_random_uuid() || '@selah';
    NEW.ics_sequence := 0;
    NEW.status := 'scheduled';
    NEW.agenda_md := app_meeting_agenda(NEW.project_id, NEW.starts_at, NEW.spoken_lang);
    NEW.consent_noted_by := CASE WHEN NEW.transcript_consent THEN app_uid() END;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.ics_uid <> OLD.ics_uid OR NEW.project_id <> OLD.project_id OR NEW.org_id <> OLD.org_id
     OR NEW.organizer_id <> OLD.organizer_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'a meeting keeps its project, organiser and calendar id' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (OLD.status = 'scheduled' AND NEW.status IN ('held', 'cancelled')) THEN
    RAISE EXCEPTION 'invalid meeting status change % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'scheduled' AND NEW.status = OLD.status AND (
     NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at OR NEW.location <> OLD.location
     OR NEW.join_url IS DISTINCT FROM OLD.join_url OR NEW.location_text IS DISTINCT FROM OLD.location_text) THEN
    RAISE EXCEPTION 'a % meeting cannot be moved', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.transcript_consent IS DISTINCT FROM OLD.transcript_consent THEN
    NEW.consent_noted_by := CASE WHEN NEW.transcript_consent THEN app_uid() END;
  ELSIF NEW.consent_noted_by IS DISTINCT FROM OLD.consent_noted_by THEN
    RAISE EXCEPTION 'consent is recorded by the database' USING ERRCODE = 'check_violation';
  END IF;
  NEW.agenda_md := OLD.agenda_md;
  -- Anything a calendar shows: tell calendars it changed (RFC 5545 SEQUENCE).
  IF NEW.title <> OLD.title OR NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at OR NEW.location <> OLD.location
     OR NEW.join_url IS DISTINCT FROM OLD.join_url OR NEW.location_text IS DISTINCT FROM OLD.location_text
     OR NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    NEW.ics_sequence := OLD.ics_sequence + 1;
  ELSE
    NEW.ics_sequence := OLD.ics_sequence;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER meeting_rules BEFORE INSERT OR UPDATE ON meetings FOR EACH ROW EXECUTE FUNCTION check_meeting();
--> statement-breakpoint

-- ------------------------------------------------------------- attendees

GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_attendees TO selah_app;
--> statement-breakpoint
ALTER TABLE meeting_attendees ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY read ON meeting_attendees FOR SELECT TO selah_app USING (app_can_see_meeting(meeting_id));
--> statement-breakpoint
CREATE POLICY invite ON meeting_attendees FOR INSERT TO selah_app WITH CHECK (app_can_run_meeting(meeting_id));
--> statement-breakpoint
CREATE POLICY uninvite ON meeting_attendees FOR DELETE TO selah_app USING (app_can_run_meeting(meeting_id));
--> statement-breakpoint
-- Whoever runs the meeting changes anything; an attendee answers for themselves.
CREATE POLICY respond ON meeting_attendees FOR UPDATE TO selah_app
  USING (app_can_run_meeting(meeting_id) OR (user_id = app_uid() AND app_can_see_meeting(meeting_id)))
  WITH CHECK (app_can_run_meeting(meeting_id) OR (user_id = app_uid() AND app_can_see_meeting(meeting_id)));
--> statement-breakpoint
-- A person invited must be able to open the project (and be firm staff for
-- a firm-private meeting); a contact must belong to the meeting's client
-- and is added only by the firm, which keeps the contact list.
CREATE FUNCTION check_attendee() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m meetings%ROWTYPE;
BEGIN
  SELECT * INTO m FROM meetings WHERE id = NEW.meeting_id;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.meeting_id <> OLD.meeting_id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.contact_id IS DISTINCT FROM OLD.contact_id THEN
      RAISE EXCEPTION 'change the attendee by removing and adding' USING ERRCODE = 'check_violation';
    END IF;
    IF app_uid() IS NOT NULL AND NOT app_can_run_meeting(NEW.meeting_id) AND NEW.role <> OLD.role THEN
      RAISE EXCEPTION 'an attendee only answers the invitation' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  NEW.response := CASE WHEN NEW.user_id = m.organizer_id THEN 'accepted'::attendee_response ELSE 'needs_action' END;
  IF NEW.user_id IS NOT NULL THEN
    IF NOT app_user_sees_project(NEW.user_id, m.project_id)
       OR (m.visibility = 'firm_private' AND app_user_org(NEW.user_id) <> (SELECT firm_org_id FROM projects WHERE id = m.project_id)) THEN
      RAISE EXCEPTION 'that person cannot open this meeting''s project' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF app_uid() IS NOT NULL AND app_org_kind() <> 'firm' THEN
      RAISE EXCEPTION 'contacts are invited by the firm' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF m.visibility = 'firm_private' OR NOT EXISTS (SELECT 1 FROM client_contacts c WHERE c.id = NEW.contact_id AND c.org_id = m.org_id) THEN
      RAISE EXCEPTION 'that contact cannot be invited to this meeting' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER attendee_rules BEFORE INSERT OR UPDATE ON meeting_attendees FOR EACH ROW EXECUTE FUNCTION check_attendee();
--> statement-breakpoint
-- Queue the calendar invite (or the cancellation) for every attendee with
-- an address. The sender builds the .ics from the meeting when it sends.
CREATE FUNCTION app_send_meeting_invites(mid uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m meetings%ROWTYPE; n integer;
BEGIN
  SELECT * INTO m FROM meetings WHERE id = mid;
  IF NOT FOUND OR NOT app_can_run_meeting(mid) OR m.status = 'held' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO outbound_emails (to_email, kind, meeting_id)
    SELECT DISTINCT addr, CASE m.status WHEN 'cancelled' THEN 'meeting.cancel' ELSE 'meeting.invite' END, mid
    FROM (SELECT u.email AS addr FROM meeting_attendees a JOIN "user" u ON u.id = a.user_id
          WHERE a.meeting_id = mid AND a.user_id <> app_uid()
          UNION SELECT c.email FROM meeting_attendees a JOIN client_contacts c ON c.id = a.contact_id
          WHERE a.meeting_id = mid AND c.email IS NOT NULL) x;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_send_meeting_invites(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_send_meeting_invites(uuid) TO selah_app;
--> statement-breakpoint

-- ------------------------------------------------------ decisions, summary

GRANT SELECT, INSERT ON meeting_decisions TO selah_app;
--> statement-breakpoint
ALTER TABLE meeting_decisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY scoped_read ON meeting_decisions FOR SELECT TO selah_app
  USING (app_can_see_meeting(meeting_id) AND app_label_ok(visibility, org_id, created_by));
--> statement-breakpoint
CREATE POLICY record ON meeting_decisions FOR INSERT TO selah_app
  WITH CHECK (app_can_run_meeting(meeting_id) AND app_label_ok(visibility, org_id, created_by) AND created_by = app_uid());
--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON meeting_decisions FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON meeting_summaries TO selah_app;
--> statement-breakpoint
ALTER TABLE meeting_summaries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY scoped_read ON meeting_summaries FOR SELECT TO selah_app
  USING (app_can_see_meeting(meeting_id) AND app_label_ok(visibility, org_id, confirmed_by));
--> statement-breakpoint
CREATE POLICY write ON meeting_summaries FOR INSERT TO selah_app
  WITH CHECK (app_can_run_meeting(meeting_id) AND app_label_ok(visibility, org_id, confirmed_by));
--> statement-breakpoint
CREATE POLICY rewrite ON meeting_summaries FOR UPDATE TO selah_app
  USING (app_can_run_meeting(meeting_id)) WITH CHECK (app_can_run_meeting(meeting_id) AND app_label_ok(visibility, org_id, confirmed_by));
--> statement-breakpoint
-- A record of the meeting sits in the meeting's project and is never more
-- visible than the meeting itself.
CREATE FUNCTION check_meeting_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE m meetings%ROWTYPE;
BEGIN
  SELECT * INTO m FROM meetings WHERE id = NEW.meeting_id;
  IF NEW.project_id <> m.project_id OR NEW.org_id <> m.org_id THEN
    RAISE EXCEPTION 'a meeting record belongs to the meeting''s project' USING ERRCODE = 'check_violation';
  END IF;
  IF m.visibility = 'firm_private' AND NEW.visibility <> 'firm_private' THEN
    RAISE EXCEPTION 'a firm-private meeting keeps its records firm-private' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'meeting_decisions' THEN
    IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM meeting_decisions d WHERE d.id = NEW.supersedes_id AND d.meeting_id = NEW.meeting_id) THEN
      RAISE EXCEPTION 'a correction replaces a decision of the same meeting' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF m.status <> 'held' THEN
      RAISE EXCEPTION 'mark the meeting as held before writing its summary' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.meeting_id <> OLD.meeting_id THEN
      RAISE EXCEPTION 'a summary stays with its meeting' USING ERRCODE = 'check_violation';
    END IF;
    -- Whoever saves it confirms it.
    NEW.confirmed_by := coalesce(app_uid(), NEW.confirmed_by);
    NEW.confirmed_at := now();
    IF NEW.source = 'manual' THEN NEW.drafted_by_ai_at := NULL; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER decision_rules BEFORE INSERT ON meeting_decisions FOR EACH ROW EXECUTE FUNCTION check_meeting_record();
--> statement-breakpoint
CREATE TRIGGER summary_rules BEFORE INSERT OR UPDATE ON meeting_summaries FOR EACH ROW EXECUTE FUNCTION check_meeting_record();
--> statement-breakpoint
-- Notes and follow-ups that point at a meeting or decision stay in its project.
CREATE FUNCTION check_meeting_links() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Nested, because a record has only its own table's fields.
  IF TG_TABLE_NAME = 'meeting_notes' THEN
    IF NEW.meeting_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM meetings m WHERE m.id = NEW.meeting_id AND m.project_id = NEW.project_id) THEN
      RAISE EXCEPTION 'the note''s meeting is in another project' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.meeting_decision_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM meeting_decisions d WHERE d.id = NEW.meeting_decision_id AND d.project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'the follow-up''s decision is in another project' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER meeting_link BEFORE INSERT OR UPDATE OF meeting_id, project_id ON meeting_notes
  FOR EACH ROW EXECUTE FUNCTION check_meeting_links();
--> statement-breakpoint
CREATE TRIGGER decision_link BEFORE INSERT OR UPDATE OF meeting_decision_id, project_id ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION check_meeting_links();
--> statement-breakpoint

-- ------------------------------------------------------------- schedule

-- One calendar for meetings, action due dates and follow-ups. It runs with
-- the caller's rights (security_invoker), so each row is one the caller can
-- already see. `people` is who the item is for: the organiser and
-- attendees, the action's owner, the follow-up's assignee.
CREATE VIEW v_schedule WITH (security_invoker = true) AS
  SELECT 'meeting'::text AS item_type, m.id AS item_id, m.project_id, m.org_id, m.title, m.kind::text AS detail,
         m.starts_at, m.ends_at, false AS all_day, m.status::text AS status, m.visibility,
         array_remove(array_append(array(SELECT a.user_id FROM meeting_attendees a WHERE a.meeting_id = m.id AND a.user_id IS NOT NULL),
                                   m.organizer_id), NULL) AS people
  FROM meetings m
  UNION ALL
  SELECT 'action', a.id, a.project_id, a.org_id, a.title, NULL,
         (a.due_date::timestamp AT TIME ZONE 'Asia/Riyadh'), NULL, true, a.status::text, 'shared'::visibility,
         array_remove(ARRAY[a.owner_user_id], NULL)
  FROM actions a
  WHERE a.due_date IS NOT NULL AND a.status::text NOT IN ('draft', 'verified_complete', 'closed')
  UNION ALL
  SELECT 'follow_up', f.id, f.project_id, f.org_id, f.title, NULL,
         f.due_at, NULL, false, f.status::text, f.visibility,
         array_remove(ARRAY[f.assignee_user_id], NULL)
  FROM follow_ups f
  WHERE f.due_at IS NOT NULL AND f.status = 'open';
--> statement-breakpoint
GRANT SELECT ON v_schedule TO selah_app;
