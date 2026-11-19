-- Decision D1 (product owner, 17 Nov 2026; batch 4): one open action may be
-- given to a colleague in the same organisation. On the firm's side, staff on
-- the project (not observers); on the client's side, the client's admin and
-- the project's coordinator and sponsor only (a client manager without one of
-- those roles no longer may: before, the database let any client manager).
-- The status does not change in the same step. The new owner is told on the
-- action; the old owner on the project, because they no longer read the
-- action (an action owner reads only their own, 0081); the client's lead and
-- deputy and the consultants staffed on the project on the action. The
-- service writes the audit row (services/action-owner.ts).
--
-- Who may: the one rule, read by the update trigger below, by the notices,
-- and by the service before it offers the control.
CREATE FUNCTION app_can_change_owner(aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT p.state::text <> 'closed'
      AND a.status::text IN ('draft', 'assigned', 'in_progress', 'blocked', 'awaiting_review', 'revision_requested')
      AND CASE
        WHEN app_org_kind() = 'firm' THEN
          p.firm_org_id = app_org() AND app_can_see_action(a.id)
          AND NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = app_uid() AND pm.observer)
        -- The client's admin sees every project of the company (and hands a
        -- leaver's work over, app_hand_over); a coordinator or sponsor only
        -- what they may open.
        WHEN app_org_kind() = 'client' THEN
          a.org_id = app_org() AND a.status::text <> 'draft'
          AND (app_role() = 'client_admin'
               OR (app_role() = 'client_manager' AND app_can_see_action(a.id) AND EXISTS (
                     SELECT 1 FROM project_client_roles r
                     WHERE r.project_id = a.project_id AND r.user_id = app_uid() AND r.role IN ('coordinator', 'sponsor'))))
        ELSE false
      END
    FROM actions a JOIN projects p ON p.id = a.project_id
    WHERE a.id = aid
  ), false)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_change_owner(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_change_owner(uuid) TO selah_app;
--> statement-breakpoint
-- Who is told, once the owner has changed (called by the service in the same
-- transaction). Refused to anyone who may not change the owner, so it cannot
-- be used to send notices. A draft tells nobody: its owner hears at release.
CREATE FUNCTION app_tell_owner_changed(aid uuid, old_owner uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a actions;
  p projects;
BEGIN
  IF NOT app_can_change_owner(aid) THEN
    RAISE EXCEPTION 'not allowed to change who owns this action' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO a FROM actions WHERE id = aid;
  SELECT * INTO p FROM projects WHERE id = a.project_id;
  IF a.status = 'draft' THEN
    RETURN;
  END IF;
  -- The new owner: the action is theirs (mailed by their choices, like any assignment).
  IF a.owner_user_id IS NOT NULL AND a.owner_user_id <> app_uid() THEN
    INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES (a.owner_user_id, 'action.assigned', 'action', aid);
  END IF;
  -- The old owner: about the project, never the action they no longer read.
  IF old_owner IS NOT NULL AND old_owner <> app_uid() AND old_owner IS DISTINCT FROM a.owner_user_id
     AND EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = old_owner AND m.org_id = a.org_id AND m.active) THEN
    INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES (old_owner, 'action.owner_moved', 'project', a.project_id);
  END IF;
  -- The client's lead and deputy, and the consultants staffed on the project (not observers): active firm people.
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT DISTINCT x.user_id, 'action.owner_changed', 'action', aid
    FROM (
      SELECT ca.user_id FROM client_assignments ca WHERE ca.client_org_id = a.org_id AND (ca.is_lead OR ca.is_deputy) AND p.kind = 'client'
      UNION
      SELECT pm.user_id FROM project_members pm WHERE pm.project_id = a.project_id AND NOT pm.observer
    ) x
    JOIN org_memberships m ON m.user_id = x.user_id AND m.org_id = p.firm_org_id AND m.active
    WHERE x.user_id <> app_uid() AND x.user_id IS DISTINCT FROM a.owner_user_id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_tell_owner_changed(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_tell_owner_changed(uuid, uuid) TO selah_app;
--> statement-breakpoint
-- The update rule (latest: 0078_drafts_review), with D1 for the client's
-- side: the owner changes only for someone app_can_change_owner() allows,
-- and never together with the status. Everything else as 0078.
CREATE OR REPLACE FUNCTION check_action_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  is_client boolean := app_uid() IS NOT NULL AND app_org_kind() IS DISTINCT FROM 'firm';
  -- What a client may change. Everything else, including columns added
  -- later, is the firm's.
  client_cols text[] := ARRAY['status', 'owner_user_id', 'blocked_reason', 'updated_at'];
BEGIN
  -- Client users move their actions and (the admin, the coordinator and the
  -- sponsor: D1) give one to a colleague; the plan itself is the firm's.
  -- Jobs and migrations (no user) are not limited.
  IF is_client AND (
    (to_jsonb(NEW) - client_cols) <> (to_jsonb(OLD) - client_cols)
    OR (NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
        AND (NEW.status IS DISTINCT FROM OLD.status OR NOT app_can_change_owner(OLD.id)))
  ) THEN
    RAISE EXCEPTION 'clients can only move an action through its workflow' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.updated_at := now();

  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF (OLD.status, NEW.status) NOT IN (
    ('draft', 'assigned'),
    ('assigned', 'in_progress'),
    ('in_progress', 'blocked'),
    ('blocked', 'in_progress'),
    ('in_progress', 'awaiting_review'),
    ('awaiting_review', 'verified_complete'),
    ('awaiting_review', 'revision_requested'),
    ('revision_requested', 'in_progress'),
    ('assigned', 'closed'), ('in_progress', 'closed'), ('blocked', 'closed'),
    ('awaiting_review', 'closed'), ('revision_requested', 'closed'),
    ('verified_complete', 'in_progress'), ('closed', 'in_progress')
  ) THEN
    RAISE EXCEPTION 'invalid action status change % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;

  -- Releasing, reviewing, closing and reopening are the firm's.
  IF is_client AND (OLD.status IN ('draft', 'awaiting_review') OR NEW.status = 'closed' OR OLD.status IN ('verified_complete', 'closed')) THEN
    RAISE EXCEPTION 'only the firm can release, review, close or reopen an action' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Transaction time, like reviews.created_at, so a review written in the
  -- same transaction as the move still belongs to this round.
  IF NEW.status = 'awaiting_review' THEN
    NEW.awaiting_review_at := now();
  END IF;

  IF NEW.status = 'verified_complete' THEN
    -- The accept must review this round: an older accept (before a reopen or
    -- a resubmission) does not count.
    IF COALESCE((
      SELECT r.outcome FROM reviews r
      WHERE r.action_id = NEW.id AND r.created_at >= COALESCE(OLD.awaiting_review_at, '-infinity')
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1
    ), 'reject') <> 'accept' THEN
      RAISE EXCEPTION 'verified_complete needs an accept review of this round' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM evidence_requests er WHERE er.action_id = NEW.id AND er.status NOT IN ('accepted', 'waived')) THEN
      RAISE EXCEPTION 'every evidence request must be accepted or waived first' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status = 'closed' THEN
    -- Signed since the action was last reopened, by someone who still holds
    -- a client admin or manager role.
    IF NEW.closure_outcome = 'risk_accepted' AND NOT EXISTS (
      SELECT 1 FROM risk_acceptances ra
      JOIN org_memberships m ON m.user_id = ra.accepted_by AND m.org_id = NEW.org_id AND m.active
        AND m.role IN ('client_admin', 'client_manager')
      WHERE ra.action_id = NEW.id AND ra.created_at >= COALESCE(OLD.reopened_at, '-infinity')
    ) THEN
      RAISE EXCEPTION 'risk acceptance needs a signed statement from the client' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.closure_outcome = 'superseded' AND NOT EXISTS (
      SELECT 1 FROM actions a WHERE a.id = NEW.superseded_by AND a.project_id = NEW.project_id
    ) THEN
      RAISE EXCEPTION 'a superseding action must be in the same project' USING ERRCODE = 'check_violation';
    END IF;
    -- The client reads what replaced its work: never a draft it cannot open (D6).
    IF NEW.closure_outcome = 'superseded' AND EXISTS (
      SELECT 1 FROM actions a WHERE a.id = NEW.superseded_by AND a.status = 'draft'
    ) THEN
      RAISE EXCEPTION 'the replacement is still a draft: release it first' USING ERRCODE = 'check_violation';
    END IF;
    NEW.closed_at := now();
    NEW.closed_by := COALESCE(app_uid(), NEW.closed_by);
  END IF;

  -- Reopening clears the closure; the history stays in activity_events.
  IF OLD.status IN ('verified_complete', 'closed') THEN
    NEW.closure_outcome := NULL;
    NEW.closure_note := NULL;
    NEW.closed_by := NULL;
    NEW.closed_at := NULL;
    NEW.superseded_by := NULL;
    NEW.reopened_at := now();
  END IF;
  RETURN NEW;
END $$;
