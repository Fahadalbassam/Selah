-- Follow-ups from a meeting (docs/meetings.md, "After the meeting").
--
-- A follow-up can come out of a meeting, and can follow up one of its
-- decisions. It stays in the meeting's project and is never more visible than
-- the meeting. The person it is assigned to must be able to open the project
-- (and be firm staff when it is firm-private). The firm writes follow-ups; the
-- assignee can mark their own one done or open again, and change nothing else.

CREATE FUNCTION check_follow_up() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d meeting_decisions%ROWTYPE; m meetings%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND session_user = 'selah_app' THEN
    IF (NEW.project_id, NEW.org_id, NEW.meeting_id, NEW.meeting_decision_id, NEW.meeting_note_id, NEW.action_id,
        NEW.created_by, NEW.created_at, NEW.checkin_day)
       IS DISTINCT FROM
       (OLD.project_id, OLD.org_id, OLD.meeting_id, OLD.meeting_decision_id, OLD.meeting_note_id, OLD.action_id,
        OLD.created_by, OLD.created_at, OLD.checkin_day) THEN
      RAISE EXCEPTION 'a follow-up keeps its project, meeting and author' USING ERRCODE = 'check_violation';
    END IF;
    -- The assignee's own policy lets them in; only the firm edits the rest.
    IF app_org_kind() IS DISTINCT FROM 'firm'
       AND (NEW.title, NEW.due_at, NEW.assignee_user_id, NEW.visibility)
           IS DISTINCT FROM (OLD.title, OLD.due_at, OLD.assignee_user_id, OLD.visibility) THEN
      RAISE EXCEPTION 'the assignee only marks a follow-up done' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.meeting_decision_id IS NOT NULL THEN
    SELECT * INTO d FROM meeting_decisions WHERE id = NEW.meeting_decision_id;
    NEW.meeting_id := coalesce(NEW.meeting_id, d.meeting_id);
    IF NEW.meeting_id <> d.meeting_id THEN
      RAISE EXCEPTION 'the follow-up''s decision is from another meeting' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.meeting_id IS NOT NULL THEN
    SELECT * INTO m FROM meetings WHERE id = NEW.meeting_id;
    IF m.project_id <> NEW.project_id THEN
      RAISE EXCEPTION 'the follow-up''s meeting is in another project' USING ERRCODE = 'check_violation';
    END IF;
    IF m.visibility = 'firm_private' AND NEW.visibility <> 'firm_private' THEN
      RAISE EXCEPTION 'a firm-private meeting keeps its follow-ups firm-private' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.assignee_user_id IS NOT NULL AND (TG_OP = 'INSERT'
     OR NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id OR NEW.visibility <> OLD.visibility) THEN
    IF NOT app_user_sees_project(NEW.assignee_user_id, NEW.project_id)
       OR (NEW.visibility = 'firm_private'
           AND app_user_org(NEW.assignee_user_id) <> (SELECT firm_org_id FROM projects WHERE id = NEW.project_id)) THEN
      RAISE EXCEPTION 'that person cannot open this follow-up''s project' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER follow_up_rules BEFORE INSERT OR UPDATE ON follow_ups FOR EACH ROW EXECUTE FUNCTION check_follow_up();
--> statement-breakpoint

CREATE POLICY assignee_done ON follow_ups FOR UPDATE TO selah_app
  USING (assignee_user_id = app_uid() AND app_can_see_project(project_id) AND app_label_ok(visibility, org_id, created_by))
  WITH CHECK (assignee_user_id = app_uid() AND app_can_see_project(project_id) AND app_label_ok(visibility, org_id, created_by));
--> statement-breakpoint

-- Whom the caller can invite to a meeting on the project: people with an
-- account who can open it. The firm sees everyone; a client sees its own
-- people and the firm staff on the project, not the firm's whole staff.
CREATE FUNCTION app_meeting_invitees(pid uuid)
RETURNS TABLE (user_id uuid, name text, firm boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.name, mo.org_id = p.firm_org_id
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
