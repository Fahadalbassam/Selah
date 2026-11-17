-- The agenda each reader gets (the lead's ruling on the review of 1a, 17 Nov
-- 2026). The stored agenda is written at booking and names work by title. It
-- was handed to anyone who could open every action of the project (of the
-- department, for a department's meeting) as the work is filed now, so work
-- refiled out of a department after booking still reached that department's
-- people by title. Now:
--   - the stored text goes only to readers who may see everything on the
--     project (app_sees_whole_project, migration 0084);
--   - everyone else who opens the meeting (department meetings included)
--     gets the same four lists built when they open it, from the actions they
--     can read now (an action owner: her own);
--   - for a meeting already past, "late" is counted as of the meeting's day.
--
-- 1. The lists for one reader (replaces the owner-only form of 0082). The
--    four-argument form, written into a meeting at booking, still calls it
--    with no reader.
DROP FUNCTION app_meeting_agenda(uuid, timestamptz, text, uuid, uuid);
--> statement-breakpoint
CREATE FUNCTION app_meeting_agenda(pid uuid, before timestamptz, lang text, dept uuid, reader uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  -- At booking, today; for one reader, the meeting's day when it is past.
  today date := CASE WHEN reader IS NULL THEN app_firm_today() ELSE least(app_firm_today(), app_firm_date(before)) END;
  last_held timestamptz := (SELECT max(m.starts_at) FROM meetings m WHERE m.project_id = pid AND m.status = 'held' AND m.starts_at < before);
  out text := '';
  part text;
  en boolean := lang = 'en';
  l text := CASE WHEN lang = 'en' THEN 'en' ELSE 'ar' END;
BEGIN
  SELECT string_agg('- ' || a.title || CASE WHEN en THEN ' (due ' ELSE ' (الاستحقاق ' END || app_agenda_date(a.due_date, l) || ')', E'\n' ORDER BY a.due_date) INTO part FROM (
    SELECT a.title, a.due_date FROM actions a JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
    WHERE a.project_id = pid AND a.due_date < today AND app_action_open(a.status) AND (dept IS NULL OR a.department_id = dept)
      AND (reader IS NULL OR app_user_sees_action(reader, a.id))
    ORDER BY a.due_date LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Overdue\n' ELSE E'## متأخرة\n' END || part || E'\n\n'; END IF;
  SELECT string_agg('- ' || a.title, E'\n' ORDER BY a.title) INTO part FROM (
    SELECT a.title FROM actions a JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
    WHERE a.project_id = pid AND a.status = 'awaiting_review' AND (dept IS NULL OR a.department_id = dept)
      AND (reader IS NULL OR app_user_sees_action(reader, a.id))
    ORDER BY a.title LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Awaiting review\n' ELSE E'## بانتظار المراجعة\n' END || part || E'\n\n'; END IF;
  SELECT string_agg('- ' || a.title || coalesce(': ' || a.blocked_reason, ''), E'\n' ORDER BY a.title) INTO part FROM (
    SELECT a.title, a.blocked_reason FROM actions a JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
    WHERE a.project_id = pid AND a.status = 'blocked' AND (dept IS NULL OR a.department_id = dept)
      AND (reader IS NULL OR app_user_sees_action(reader, a.id))
    ORDER BY a.title LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Blocked\n' ELSE E'## متوقفة\n' END || part || E'\n\n'; END IF;
  IF last_held IS NOT NULL THEN
    SELECT string_agg('- ' || c.title || ' (' || app_action_status_label(c.status, l) || ')', E'\n' ORDER BY c.title) INTO part FROM (
      SELECT c.* FROM app_changed_actions(pid, last_held) c
        JOIN actions a ON a.id = c.action_id JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
      WHERE (dept IS NULL OR a.department_id = dept) AND (reader IS NULL OR app_user_sees_action(reader, a.id))
      ORDER BY c.title LIMIT 20) c;
    IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Changed since the last meeting\n' ELSE E'## ما تغيّر منذ الاجتماع السابق\n' END || part || E'\n\n'; END IF;
  END IF;
  RETURN nullif(rtrim(out, E'\n'), '');
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_meeting_agenda(uuid, timestamptz, text, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
-- 2. The only way the app reads an agenda (latest: 0082). No row for a
--    meeting the caller cannot open. Otherwise the stored text to who may see
--    everything on the project, else the lists built for the caller (`live`).
DROP FUNCTION app_meeting_agenda_for(uuid);
--> statement-breakpoint
CREATE FUNCTION app_meeting_agenda_for(mid uuid) RETURNS TABLE (agenda text, live boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN x.whole THEN m.agenda_md
              ELSE app_meeting_agenda(m.project_id, m.starts_at, m.spoken_lang, m.department_id, app_uid()) END,
    NOT x.whole
  FROM meetings m CROSS JOIN LATERAL (SELECT app_sees_whole_project(m.project_id) AS whole) x
  WHERE m.id = mid AND app_can_see_meeting(mid)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_meeting_agenda_for(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_meeting_agenda_for(uuid) TO selah_app;
--> statement-breakpoint
-- 3. app_reads_all_actions() (0072, 0077, 0082) decided who read the stored
--    text. Nothing asks it any more: dropped, with its per-person form, so no
--    later rule leans on the work-dependent answer by mistake.
DROP FUNCTION app_reads_all_actions(uuid, uuid);
--> statement-breakpoint
DROP FUNCTION app_user_reads_all_actions(uuid, uuid, uuid);
