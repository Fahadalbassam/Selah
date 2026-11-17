-- The meeting agenda (page audit N3, N5, B1; decision D8).
--
-- The agenda is one text the database writes when a meeting is booked: the
-- project's (or the department's) late, waiting and blocked actions by title.
-- Every reader of the meeting got it, so a manager limited to her department
-- and an action owner read other people's action titles. How the agenda
-- should be rebuilt is not decided yet; this closes the leak with the
-- smallest change.
--
-- 1. Who may read the stored text: a person who may open every action it can
--    name. That is the firm's people on the project, the client's admin, and
--    a client manager for whom no action of the project (of the department,
--    for a department's meeting) fails the department check. An action owner
--    reads only their own actions, so never. Only actions under shared
--    recommendations count: the agenda names no others, and a client can
--    never open those.
CREATE FUNCTION app_reads_all_actions(pid uuid, dept uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_can_see_project(pid) AND (
    (app_org_kind() = 'firm' AND app_role() IS NOT NULL)
    OR (app_role() IN ('client_admin', 'client_manager') AND NOT EXISTS (
          SELECT 1 FROM actions a JOIN recommendations r ON r.id = a.recommendation_id
          WHERE a.project_id = pid AND r.visibility = 'shared' AND (dept IS NULL OR a.department_id = dept)
            AND NOT (app_dept_ok(a.department_id, a.org_id) OR coalesce(a.owner_user_id = app_uid(), false))))
  )
$$;
--> statement-breakpoint
-- 2. The only way the app reads the text. No row for a meeting the caller
--    cannot open; otherwise the text, or (withheld) the fact that there is
--    one the caller may not read, so the page can say so in one line.
CREATE FUNCTION app_meeting_agenda_for(mid uuid) RETURNS TABLE (agenda text, withheld boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN x.ok THEN m.agenda_md END, NOT x.ok AND coalesce(btrim(m.agenda_md), '') <> ''
  FROM meetings m CROSS JOIN LATERAL (SELECT app_reads_all_actions(m.project_id, m.department_id) AS ok) x
  WHERE m.id = mid AND app_can_see_meeting(mid)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_reads_all_actions(uuid, uuid), app_meeting_agenda_for(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_reads_all_actions(uuid, uuid), app_meeting_agenda_for(uuid) TO selah_app;
--> statement-breakpoint
-- 3. The app role no longer reads the column itself, so no query, present or
--    future, can hand the text to a reader the function would refuse. A
--    column added to meetings later needs its own GRANT SELECT (column) here;
--    tests/db/privacy-leaks.test.ts fails by name until it has one.
REVOKE SELECT ON meetings FROM selah_app;
--> statement-breakpoint
GRANT SELECT (id, project_id, org_id, kind, title, starts_at, ends_at, location, join_url, provider, location_text, organizer_id, status,
              ics_uid, ics_sequence, spoken_lang, transcript_consent, consent_noted_by, visibility, created_at, updated_at, department_id)
  ON meetings TO selah_app;
--> statement-breakpoint
-- 4. New agendas say an action's status in words and its date the way the
--    screens write it, in the meeting's language. (Stored agendas keep their
--    text; the meeting page maps the old keys when it draws them.) The words
--    are the ones in messages/*.json under "status"; a test compares them.
CREATE FUNCTION app_action_status_label(s text, lang text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lang = 'en' THEN
    CASE s WHEN 'draft' THEN 'Draft' WHEN 'assigned' THEN 'Assigned' WHEN 'in_progress' THEN 'In progress' WHEN 'blocked' THEN 'Blocked'
           WHEN 'awaiting_review' THEN 'Awaiting review' WHEN 'revision_requested' THEN 'Revision requested'
           WHEN 'verified_complete' THEN 'Verified complete' WHEN 'closed' THEN 'Closed' ELSE s END
  ELSE
    CASE s WHEN 'draft' THEN 'مسودة' WHEN 'assigned' THEN 'مُسند' WHEN 'in_progress' THEN 'قيد التنفيذ' WHEN 'blocked' THEN 'متعثر'
           WHEN 'awaiting_review' THEN 'بانتظار المراجعة' WHEN 'revision_requested' THEN 'مطلوب تعديل'
           WHEN 'verified_complete' THEN 'مكتمل ومُتحقق منه' WHEN 'closed' THEN 'مغلق' ELSE s END
  END
$$;
--> statement-breakpoint
-- A day as the screens print it (the "medium" date of each language): "Nov 2,
-- 2026" in English; in Arabic day, month, year with the right-to-left marks
-- the browser's own Arabic format carries, so it reads the same on the page.
CREATE FUNCTION app_agenda_date(d date, lang text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN lang = 'en' THEN to_char(d, 'Mon FMDD, YYYY')
    ELSE to_char(d, 'DD') || U&'\200F' || '/' || to_char(d, 'MM') || U&'\200F' || '/' || to_char(d, 'YYYY') END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_action_status_label(text, text), app_agenda_date(date, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_action_status_label(text, text), app_agenda_date(date, text) TO selah_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_meeting_agenda(pid uuid, before timestamptz, lang text, dept uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  today date := app_firm_today();
  last_held timestamptz := (SELECT max(m.starts_at) FROM meetings m WHERE m.project_id = pid AND m.status = 'held' AND m.starts_at < before);
  out text := '';
  part text;
  en boolean := lang = 'en';
  l text := CASE WHEN lang = 'en' THEN 'en' ELSE 'ar' END;
BEGIN
  SELECT string_agg('- ' || a.title || CASE WHEN en THEN ' (due ' ELSE ' (الاستحقاق ' END || app_agenda_date(a.due_date, l) || ')', E'\n' ORDER BY a.due_date) INTO part FROM (
    SELECT a.title, a.due_date FROM actions a JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
    WHERE a.project_id = pid AND a.due_date < today AND app_action_open(a.status) AND (dept IS NULL OR a.department_id = dept)
    ORDER BY a.due_date LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Overdue\n' ELSE E'## متأخرة\n' END || part || E'\n\n'; END IF;
  SELECT string_agg('- ' || a.title, E'\n' ORDER BY a.title) INTO part FROM (
    SELECT a.title FROM actions a JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
    WHERE a.project_id = pid AND a.status = 'awaiting_review' AND (dept IS NULL OR a.department_id = dept) ORDER BY a.title LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Awaiting review\n' ELSE E'## بانتظار المراجعة\n' END || part || E'\n\n'; END IF;
  SELECT string_agg('- ' || a.title || coalesce(': ' || a.blocked_reason, ''), E'\n' ORDER BY a.title) INTO part FROM (
    SELECT a.title, a.blocked_reason FROM actions a JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
    WHERE a.project_id = pid AND a.status = 'blocked' AND (dept IS NULL OR a.department_id = dept) ORDER BY a.title LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Blocked\n' ELSE E'## متوقفة\n' END || part || E'\n\n'; END IF;
  IF last_held IS NOT NULL THEN
    SELECT string_agg('- ' || c.title || ' (' || app_action_status_label(c.status, l) || ')', E'\n' ORDER BY c.title) INTO part FROM (
      SELECT c.* FROM app_changed_actions(pid, last_held) c
        JOIN actions a ON a.id = c.action_id JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
      WHERE dept IS NULL OR a.department_id = dept
      ORDER BY c.title LIMIT 20) c;
    IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Changed since the last meeting\n' ELSE E'## ما تغيّر منذ الاجتماع السابق\n' END || part || E'\n\n'; END IF;
  END IF;
  RETURN nullif(rtrim(out, E'\n'), '');
END $$;
