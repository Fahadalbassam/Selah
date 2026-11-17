-- The agenda follows the meeting (decision 1a, option C, product owner,
-- 17 Nov 2026; with his answer of the same day on action owners).
--
-- A meeting filed under a department lists that department's work and keeps
-- the opening rule of 0070: the department's people, the client's admins,
-- the firm on the project, its organiser and anyone invited.
--
-- A meeting with no department is a whole-project meeting: its agenda names
-- the whole project's late, waiting and blocked work. It opens only for
-- people who may see everything on the project (the firm on the project,
-- the client's admin, and a client manager whom no department limit
-- stops: app_reads_all_actions, the rule the agenda already used, 0072/0077),
-- plus action owners invited to it, who see only their own actions on its
-- agenda. Everyone else gets nothing: the meeting, its attendees, decisions,
-- summary and its sources, notes, follow-ups (unless assigned to them),
-- transcript, calendar file and its line on the schedule.
--
-- 1. Whether a client person may open every released action of a project
--    (of a department, when dept is given), worked out for anyone: the
--    question 0072 asked for the caller only, now also asked about the people
--    an organiser invites, so the booking form can warn before saving.
CREATE FUNCTION app_user_reads_all_actions(target uuid, pid uuid, dept uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM actions a JOIN recommendations r ON r.id = a.recommendation_id JOIN organizations o ON o.id = a.org_id
    WHERE a.project_id = pid AND r.visibility = 'shared' AND (dept IS NULL OR a.department_id = dept)
      AND a.status <> 'draft'
      AND a.department_id IS NOT NULL AND o.departments_enabled
      AND a.owner_user_id IS DISTINCT FROM target
      AND NOT EXISTS (SELECT 1 FROM department_members dm WHERE dm.department_id = a.department_id AND dm.user_id = target)
      AND NOT EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = target AND m.org_id = a.org_id AND m.role = 'client_admin')
  )
$$;
--> statement-breakpoint
-- The caller's form (latest: 0077), now through the same check. Unchanged in
-- what it answers.
CREATE OR REPLACE FUNCTION app_reads_all_actions(pid uuid, dept uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_can_see_project(pid) AND (
    (app_org_kind() = 'firm' AND app_role() IS NOT NULL)
    OR (app_role() IN ('client_admin', 'client_manager') AND app_user_reads_all_actions(app_uid(), pid, dept))
  )
$$;
--> statement-breakpoint
-- 2. The whole-project rule. A department's meeting passes (0070 decides it).
CREATE FUNCTION app_meeting_whole_ok(mid uuid, pid uuid, dept uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT dept IS NOT NULL
    OR app_reads_all_actions(pid, NULL)
    OR (app_role() = 'action_owner' AND app_attends_meeting(mid))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_user_reads_all_actions(uuid, uuid, uuid), app_meeting_whole_ok(uuid, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_meeting_whole_ok(uuid, uuid, uuid) TO selah_app;
--> statement-breakpoint
-- Restrictive, like the department rule: on every read and write path. A
-- whole-project meeting is booked (and changed) only by someone who may open
-- it; a manager with department limits books one for her department.
CREATE POLICY whole_project ON meetings AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_meeting_whole_ok(id, project_id, department_id))
  WITH CHECK (app_meeting_whole_ok(id, project_id, department_id));
--> statement-breakpoint
-- 3. Attendees, decisions, summaries, summary sources and transcripts ask
--    app_can_see_meeting() (latest: 0070); follow-ups and notes ask
--    app_meeting_open_to_me() (latest: 0070). Both now carry the rule.
CREATE OR REPLACE FUNCTION app_can_see_meeting(mid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM meetings m
    WHERE m.id = mid AND app_can_see_project(m.project_id) AND app_label_ok(m.visibility, m.org_id, m.organizer_id)
      AND app_meeting_dept_ok(m.id, m.department_id, m.org_id, m.organizer_id)
      AND app_meeting_whole_ok(m.id, m.project_id, m.department_id)
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_meeting_open_to_me(mid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT app_meeting_dept_ok(m.id, m.department_id, m.org_id, m.organizer_id) AND app_meeting_whole_ok(m.id, m.project_id, m.department_id)
    FROM meetings m WHERE m.id = mid
  ), true)
$$;
--> statement-breakpoint
-- 4. The agenda, worked out for one action owner: the same four lists as the
--    stored one (late, awaiting review, blocked, changed since the last held
--    meeting), from the live actions, only the ones they own. The stored
--    text, with other people's titles, never reaches them.
CREATE FUNCTION app_meeting_agenda(pid uuid, before timestamptz, lang text, dept uuid, only_owner uuid) RETURNS text
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
      AND (only_owner IS NULL OR a.owner_user_id = only_owner)
    ORDER BY a.due_date LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Overdue\n' ELSE E'## متأخرة\n' END || part || E'\n\n'; END IF;
  SELECT string_agg('- ' || a.title, E'\n' ORDER BY a.title) INTO part FROM (
    SELECT a.title FROM actions a JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
    WHERE a.project_id = pid AND a.status = 'awaiting_review' AND (dept IS NULL OR a.department_id = dept)
      AND (only_owner IS NULL OR a.owner_user_id = only_owner)
    ORDER BY a.title LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Awaiting review\n' ELSE E'## بانتظار المراجعة\n' END || part || E'\n\n'; END IF;
  SELECT string_agg('- ' || a.title || coalesce(': ' || a.blocked_reason, ''), E'\n' ORDER BY a.title) INTO part FROM (
    SELECT a.title, a.blocked_reason FROM actions a JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
    WHERE a.project_id = pid AND a.status = 'blocked' AND (dept IS NULL OR a.department_id = dept)
      AND (only_owner IS NULL OR a.owner_user_id = only_owner)
    ORDER BY a.title LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Blocked\n' ELSE E'## متوقفة\n' END || part || E'\n\n'; END IF;
  IF last_held IS NOT NULL THEN
    SELECT string_agg('- ' || c.title || ' (' || app_action_status_label(c.status, l) || ')', E'\n' ORDER BY c.title) INTO part FROM (
      SELECT c.* FROM app_changed_actions(pid, last_held) c
        JOIN actions a ON a.id = c.action_id JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
      WHERE (dept IS NULL OR a.department_id = dept) AND (only_owner IS NULL OR a.owner_user_id = only_owner)
      ORDER BY c.title LIMIT 20) c;
    IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Changed since the last meeting\n' ELSE E'## ما تغيّر منذ الاجتماع السابق\n' END || part || E'\n\n'; END IF;
  END IF;
  RETURN nullif(rtrim(out, E'\n'), '');
END $$;
--> statement-breakpoint
-- The four-argument form (written into the meeting at booking) is the same
-- list for everyone; it now calls the one above. Neither is the app's to call.
CREATE OR REPLACE FUNCTION app_meeting_agenda(pid uuid, before timestamptz, lang text, dept uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_meeting_agenda(pid, before, lang, dept, NULL::uuid)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_meeting_agenda(uuid, timestamptz, text, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
-- 5. The only way the app reads an agenda (latest: 0072). No row for a
--    meeting the caller cannot open. Otherwise the stored text to a reader who
--    may open every action it can name; an action owner's own list (`own`);
--    or nothing, with `withheld` saying there is one.
DROP FUNCTION app_meeting_agenda_for(uuid);
--> statement-breakpoint
CREATE FUNCTION app_meeting_agenda_for(mid uuid) RETURNS TABLE (agenda text, withheld boolean, own boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN x.ok THEN m.agenda_md
              WHEN x.owner THEN app_meeting_agenda(m.project_id, m.starts_at, m.spoken_lang, m.department_id, app_uid()) END,
    NOT x.ok AND NOT x.owner AND coalesce(btrim(m.agenda_md), '') <> '',
    NOT x.ok AND x.owner
  FROM meetings m
    CROSS JOIN LATERAL (SELECT app_reads_all_actions(m.project_id, m.department_id) AS ok,
                               app_role() IS NOT DISTINCT FROM 'action_owner' AS owner) x
  WHERE m.id = mid AND app_can_see_meeting(mid)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_meeting_agenda_for(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_meeting_agenda_for(uuid) TO selah_app;
--> statement-breakpoint
-- 6. Whom the caller can invite (latest: baseline), and, for each, whether
--    they could open a meeting of the whole project, with their departments,
--    so the booking form can say before saving who would be left out and
--    offer a department's meeting instead. An action owner can (invited
--    owners open it, and see only their own actions on its agenda).
DROP FUNCTION app_meeting_invitees(uuid);
--> statement-breakpoint
CREATE FUNCTION app_meeting_invitees(pid uuid)
RETURNS TABLE (user_id uuid, name text, firm boolean, whole_project boolean, departments uuid[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.name, mo.org_id = p.firm_org_id,
    mo.role <> 'client_manager' OR app_user_reads_all_actions(u.id, pid, NULL),
    coalesce((SELECT array_agg(d.id ORDER BY d.id) FROM department_members dm JOIN departments d ON d.id = dm.department_id
              WHERE dm.user_id = u.id AND d.org_id = p.org_id AND d.active AND mo.org_id = p.org_id), '{}')
  FROM projects p
  JOIN org_memberships mo ON mo.active AND mo.org_id IN (p.firm_org_id, p.org_id)
  JOIN "user" u ON u.id = mo.user_id
  WHERE p.id = pid AND app_can_see_project(pid) AND app_user_sees_project(u.id, pid)
    AND (app_org_kind() = 'firm' OR mo.org_id = app_org()
         OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = pid AND pm.user_id = u.id))
  ORDER BY mo.org_id = p.firm_org_id DESC, u.name
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_meeting_invitees(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_meeting_invitees(uuid) TO selah_app;
