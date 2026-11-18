-- Attendee names follow the meeting (screen re-check of batch 0, fault 2;
-- the lead's decision, 18 Nov 2026: anyone who may open a meeting sees the
-- names of its attendees, and nothing else about them).
--
-- The meeting page read each attendee's name from the user table, under the
-- user-row rule (app_can_see_user, baseline). An action owner sees a
-- colleague only through a shared project, and a client's admin is often no
-- project member, so an owner invited with her drew her as a nameless "—".
-- The user-row rule is not widened: this returns the name alone (no address,
-- no picture, no account), only for the attendees of a meeting the caller can
-- open (app_can_see_meeting, latest: 0082), and nothing for any other meeting.
CREATE FUNCTION app_meeting_attendee_names(mid uuid) RETURNS TABLE (user_id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.name
  FROM meeting_attendees ma JOIN "user" u ON u.id = ma.user_id
  WHERE ma.meeting_id = mid AND app_can_see_meeting(mid)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_meeting_attendee_names(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_meeting_attendee_names(uuid) TO selah_app;
