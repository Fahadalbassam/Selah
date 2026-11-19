-- Batch 4 review S5: the database holds decision D1 for the firm's side too,
-- not only the service. The update rule (latest: 0101_action_owner) now asks
-- app_can_change_owner() whenever a signed-in firm person changes an action's
-- owner (an account or a typed name). Everything else as 0101.
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
  -- D1 for the firm's side too (review S5): a person signed in, of the firm, changes who owns an
  -- action only where app_can_change_owner() lets them (not on a closed project, not as an
  -- observer, only an open action). Jobs and migrations (no user) are not limited.
  IF NOT is_client AND app_uid() IS NOT NULL
     AND (NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.owner_name IS DISTINCT FROM OLD.owner_name)
     AND NOT app_can_change_owner(OLD.id) THEN
    RAISE EXCEPTION 'not allowed to change who owns this action' USING ERRCODE = 'insufficient_privilege';
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
