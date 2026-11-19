-- Gate B, 19 Nov 2026: three answers from the product owner (docs/review/unfinished-assessment.md,
-- D1, D3 and B item 1). Functions, triggers and grants only; no table changes.
--
-- 1. A file's assistant switch (D1; phase 3, C2). The row rule on documents
--    (check_document_manage, 0005) let anyone on the owning side switch
--    "available to the assistant" on or off: any client manager for any
--    client file she could see, any consultant for any firm file. Now only
--    the person who uploaded that version, or an admin of the side that owns
--    it (the client's admin, the firm admin). The owning-side rule of 0005
--    still applies on top. The database's own functions (a new version
--    retiring the old one, 0005; withdrawing a file, 0018) and jobs are not
--    stopped: they run as the owner, not as the app.
CREATE FUNCTION check_document_assistant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'selah_app' AND app_uid() IS NOT NULL
     AND NEW.ai_indexable IS DISTINCT FROM OLD.ai_indexable
     AND NOT (OLD.uploaded_by = app_uid()
              OR (app_org() = OLD.owner_org_id AND app_role() IN ('firm_admin', 'client_admin'))) THEN
    RAISE EXCEPTION 'only the person who uploaded a file, or an admin of its side, lets the assistant read it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Named to fire after document_manage (triggers run in name order), so the
-- other side hears "only the side that owns a file" first.
CREATE TRIGGER document_manage_assistant BEFORE UPDATE OF ai_indexable ON documents
  FOR EACH ROW EXECUTE FUNCTION check_document_assistant();
--> statement-breakpoint
-- 2. Inviting a manager with department limits to a meeting of the whole
--    project (D3). The rule that opens such a meeting (app_meeting_whole_ok,
--    0084) never let her in, but the invitation was allowed after a warning.
--    Now it is refused, on every path that adds an attendee; the screen
--    offers a meeting of her department instead. A manager in no department
--    is refused the same way. Action owners are still invited to any
--    meeting (they open it and see only their own actions on its agenda).
--    Invitations made before this migration stay, but she is not sent the
--    meeting's invitations again (its cancellation still reaches her), and
--    the meeting page says she cannot open it rather than "No answer yet".
CREATE FUNCTION app_user_shut_out_of_meeting(target uuid, mid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM meetings m
    JOIN projects p ON p.id = m.project_id AND p.kind = 'client'
    JOIN org_memberships om ON om.user_id = target AND om.active AND om.org_id = p.org_id AND om.role = 'client_manager'
    WHERE m.id = mid AND m.department_id IS NULL
      AND NOT app_user_sees_whole_project(target, m.project_id)
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_user_shut_out_of_meeting(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION check_meeting_invitee() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_uid() IS NOT NULL AND NEW.user_id IS NOT NULL AND app_user_shut_out_of_meeting(NEW.user_id, NEW.meeting_id) THEN
    RAISE EXCEPTION 'invite them to a department''s meeting: a meeting of the whole project opens only for people who see every department''s work'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_meeting_invitee() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER meeting_invitee BEFORE INSERT OR UPDATE OF user_id ON meeting_attendees
  FOR EACH ROW EXECUTE FUNCTION check_meeting_invitee();
--> statement-breakpoint
-- Which attendees of a meeting cannot open it (an invitation from before
-- this rule): for the meeting page, to people who open the meeting.
CREATE FUNCTION app_meeting_shut_out(mid uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.user_id FROM meeting_attendees a
  WHERE a.meeting_id = mid AND a.user_id IS NOT NULL AND app_can_see_meeting(mid)
    AND app_user_shut_out_of_meeting(a.user_id, mid)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_meeting_shut_out(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_meeting_shut_out(uuid) TO selah_app;
--> statement-breakpoint
-- The calendar invite (latest: 0095): never queued for an attendee left
-- out of the meeting, nor (unless it is the cancellation) for one who
-- cannot open it.
CREATE OR REPLACE FUNCTION app_send_meeting_invites(mid uuid) RETURNS integer
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
          WHERE a.meeting_id = mid AND a.user_id <> app_uid() AND app_audience_ok('meeting', mid, a.user_id)
            AND (m.status = 'cancelled' OR NOT app_user_shut_out_of_meeting(a.user_id, mid))
          UNION SELECT c.email FROM meeting_attendees a JOIN client_contacts c ON c.id = a.contact_id
          WHERE a.meeting_id = mid AND c.email IS NOT NULL) x;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
-- The sender's last look (latest: 0095): an invitation already queued for
-- someone who cannot open the meeting is not sent either.
CREATE OR REPLACE FUNCTION app_meeting_mail_ok(mid uuid, addr text, mail_kind text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN mail_kind = 'meeting.removed' THEN NOT app_meeting_address_on(mid, addr) AND EXISTS (
      SELECT 1 FROM outbound_emails i
      WHERE i.meeting_id = mid AND lower(i.to_email) = lower(addr) AND i.kind = 'meeting.invite' AND i.sent_at IS NOT NULL)
    ELSE EXISTS (
        SELECT 1 FROM meeting_attendees a JOIN client_contacts c ON c.id = a.contact_id
        WHERE a.meeting_id = mid AND lower(c.email) = lower(addr))
      OR EXISTS (
        SELECT 1 FROM meeting_attendees a JOIN "user" u ON u.id = a.user_id
        WHERE a.meeting_id = mid AND lower(u.email) = lower(addr) AND app_audience_ok('meeting', mid, u.id)
          AND (mail_kind <> 'meeting.invite' OR NOT app_user_shut_out_of_meeting(u.id, mid)))
  END
$$;
--> statement-breakpoint
-- 3. "I am stuck" tells the firm (Gate B, item 1). Marking an action blocked
--    told only its owner (when someone else marked it), while the hint said
--    the consultant would see it. Now the client's lead consultant and
--    deputy, and the consultants staffed on the project (not observers),
--    are told, each only if the action's label lets them read it (a
--    recommendation only its author sees stays theirs). Firm staff have no
--    department limits. Only of a move the caller has just made, as the
--    service recorded it in the same transaction (the status_changed event
--    to blocked, by this caller, now), so it cannot be called to send
--    notices about anything else.
CREATE FUNCTION app_tell_firm_stuck(act uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a actions;
  p projects;
  vis text;
  author uuid;
  n integer;
BEGIN
  SELECT * INTO a FROM actions WHERE id = act;
  IF a.id IS NULL OR NOT app_can_see_project(a.project_id) OR NOT app_can_see_action(act) THEN
    RAISE EXCEPTION 'action not visible' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF a.status <> 'blocked' OR NOT EXISTS (
    SELECT 1 FROM activity_events e
    WHERE e.entity_type = 'action' AND e.entity_id = act AND e.event = 'status_changed'
      AND e.to_state = 'blocked' AND e.actor_id = app_uid() AND e.created_at = now()
  ) THEN
    RAISE EXCEPTION 'no stuck action to tell of' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO p FROM projects WHERE id = a.project_id;
  SELECT r.visibility::text, r.created_by INTO vis, author FROM recommendations r WHERE r.id = a.recommendation_id;
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT DISTINCT x.user_id, 'action.blocked', 'action', act
    FROM (
      SELECT ca.user_id FROM client_assignments ca WHERE ca.client_org_id = a.org_id AND (ca.is_lead OR ca.is_deputy) AND p.kind = 'client'
      UNION
      SELECT pm.user_id FROM project_members pm WHERE pm.project_id = a.project_id AND NOT pm.observer
    ) x
    JOIN org_memberships m ON m.user_id = x.user_id AND m.org_id = p.firm_org_id AND m.active AND m.role IN ('firm_admin', 'consultant')
    WHERE x.user_id <> app_uid() AND x.user_id IS DISTINCT FROM a.owner_user_id
      AND (coalesce(vis, 'shared') IN ('shared', 'firm_private') OR (vis = 'user_private' AND author = x.user_id));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_tell_firm_stuck(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_tell_firm_stuck(uuid) TO selah_app;
