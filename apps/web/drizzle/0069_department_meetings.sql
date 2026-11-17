-- A department's meeting follows the department rule (page audit N3;
-- decision D8). Migration 0021 let a meeting be filed under a department and
-- gave it that department's agenda, but its read rule still checked only the
-- project and the label, so a manager outside Finance opened the Finance
-- workshop with its attendees, decisions, follow-ups and summary.
--
-- Who reads a department's meeting, at the client: the department's people
-- and the client's admins (app_dept_ok, the same check as actions and
-- recommendations), whoever organises it, and anyone invited to it. The firm
-- on the project reads it as before. A meeting with no department is
-- unchanged: everyone on the project.

-- 1. Invited, past the attendee table's own row policy (which asks whether
--    the meeting is visible, the question being answered here).
CREATE FUNCTION app_attends_meeting(mid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM meeting_attendees a WHERE a.meeting_id = mid AND a.user_id = app_uid())
$$;
--> statement-breakpoint
CREATE FUNCTION app_meeting_dept_ok(mid uuid, dept uuid, row_org uuid, organizer uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_dept_ok(dept, row_org) OR coalesce(organizer = app_uid(), false) OR app_attends_meeting(mid)
$$;
--> statement-breakpoint
-- The same check through a meeting's id, for the records that point at one.
CREATE FUNCTION app_meeting_open_to_me(mid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT app_meeting_dept_ok(m.id, m.department_id, m.org_id, m.organizer_id) FROM meetings m WHERE m.id = mid), true)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_attends_meeting(uuid), app_meeting_dept_ok(uuid, uuid, uuid, uuid), app_meeting_open_to_me(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_attends_meeting(uuid), app_meeting_dept_ok(uuid, uuid, uuid, uuid), app_meeting_open_to_me(uuid) TO selah_app;
--> statement-breakpoint
-- 2. Restrictive, like the department check on actions: added to every
--    policy on the table, so no read or write path skips it.
CREATE POLICY department ON meetings AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_meeting_dept_ok(id, department_id, org_id, organizer_id))
  WITH CHECK (app_meeting_dept_ok(id, department_id, org_id, organizer_id));
--> statement-breakpoint
-- Booking one for a department is for people who can see that department's
-- work (the firm, the client's admin, the department's people): the database
-- writes the department's agenda into the meeting.
CREATE POLICY department_book ON meetings AS RESTRICTIVE FOR INSERT TO selah_app
  WITH CHECK (app_dept_ok(department_id, org_id));
--> statement-breakpoint
-- 3. Attendees, decisions, summaries, summary sources and transcripts all ask
--    app_can_see_meeting() (or app_can_run_meeting(), which asks it).
CREATE OR REPLACE FUNCTION app_can_see_meeting(mid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM meetings m
    WHERE m.id = mid AND app_can_see_project(m.project_id) AND app_label_ok(m.visibility, m.org_id, m.organizer_id)
      AND app_meeting_dept_ok(m.id, m.department_id, m.org_id, m.organizer_id)
  )
$$;
--> statement-breakpoint
-- 4. Follow-ups and notes that came out of a meeting are read with it. The
--    person a follow-up is assigned to always reads it: they have to do it.
CREATE POLICY meeting_department ON follow_ups AS RESTRICTIVE FOR ALL TO selah_app
  USING (meeting_id IS NULL OR coalesce(assignee_user_id = app_uid(), false) OR app_meeting_open_to_me(meeting_id))
  WITH CHECK (meeting_id IS NULL OR coalesce(assignee_user_id = app_uid(), false) OR app_meeting_open_to_me(meeting_id));
--> statement-breakpoint
CREATE POLICY meeting_department ON meeting_notes AS RESTRICTIVE FOR ALL TO selah_app
  USING (meeting_id IS NULL OR app_meeting_open_to_me(meeting_id))
  WITH CHECK (meeting_id IS NULL OR app_meeting_open_to_me(meeting_id));
