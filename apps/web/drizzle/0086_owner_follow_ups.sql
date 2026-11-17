-- An action owner reads only the follow-ups assigned to her (the lead's
-- ruling on the review of 1a, 17 Nov 2026; authorize() already says so:
-- follow_up.read is "assigned" for owners). An owner invited to a meeting
-- reads the meeting's record, written for the people who attended: its
-- summary and decisions, the shared notes with them, the attendee list and
-- replies. She does not read the follow-ups given to others, with their
-- names, nor one that names a colleague's action, even when it is assigned
-- to her (its action's id is a colleague's).
--
-- Replaces the follow-up policy of 0081 (which let an owner read every
-- follow-up of a meeting she opens, and one about a colleague's action when
-- assigned to her). Every other role is unchanged.
DROP POLICY owner ON follow_ups;
--> statement-breakpoint
CREATE POLICY owner ON follow_ups AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_owner_reads_action(action_id)
         AND (app_role() IS DISTINCT FROM 'action_owner' OR coalesce(assignee_user_id = app_uid(), false)))
  WITH CHECK (app_owner_reads_action(action_id)
         AND (app_role() IS DISTINCT FROM 'action_owner' OR coalesce(assignee_user_id = app_uid(), false)));
