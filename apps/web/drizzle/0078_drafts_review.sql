-- Review of D6 (docs/review/work/drafts-hidden-review.md), one section per
-- finding.
--
-- 1. A deleted draft. Only drafts are deleted, so an action that no longer
--    exists was a draft the client never saw. The check through an action
--    answered "visible" for a missing one, so a deleted draft's activity
--    events (and any old notice about it) came back for the client admin.
--    Now a missing action is hidden from a client, like a draft, and the
--    function answers the same for both (no way to tell a draft's id from an
--    unknown one). A row that names no action (NULL) keeps its own rules.
CREATE OR REPLACE FUNCTION app_action_visible_to_client(aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(app_org_kind() = 'firm', false)
    OR aid IS NULL
    OR EXISTS (SELECT 1 FROM actions a WHERE a.id = aid AND a.status <> 'draft')
$$;
--> statement-breakpoint
-- 4. Closing and replacing with a draft on the project. The firm could mark
--    a draft "handed over" to the client at closing, though the client never
--    sees it (and closing leaves it a draft for ever), and could close a
--    released action as "superseded" by a draft the client cannot open.
--    Both are refused now: a draft is released first, or withdrawn.
CREATE OR REPLACE FUNCTION app_dispose_action(act uuid, p_disp closure_disposition, p_note text, s_user uuid, s_contact uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a actions;
  round uuid;
  item uuid;
BEGIN
  SELECT * INTO a FROM actions WHERE id = act;
  IF a.id IS NULL OR app_org_kind() IS DISTINCT FROM 'firm' OR NOT app_can_see_project(a.project_id) THEN
    RAISE EXCEPTION 'no such action' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT state::text FROM projects WHERE id = a.project_id) <> 'closing' THEN
    RAISE EXCEPTION 'dispose of open actions while the project is closing' USING ERRCODE = 'check_violation';
  END IF;
  IF a.status::text IN ('verified_complete', 'closed') THEN
    RAISE EXCEPTION 'this action is finished' USING ERRCODE = 'check_violation';
  END IF;
  IF a.status = 'draft' AND p_disp = 'handed_over' THEN
    RAISE EXCEPTION 'a draft cannot be handed over to the client: release it first, or withdraw it' USING ERRCODE = 'check_violation';
  END IF;
  IF length(coalesce(p_note, '')) > 2000 THEN
    RAISE EXCEPTION 'the note is too long' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM app_check_sustainer(a.org_id, s_user, s_contact);
  round := app_open_closure(a.project_id);
  INSERT INTO project_closure_items (closure_id, action_id, project_id, org_id, disposition, note, sustainer_user_id, sustainer_contact_id, decided_by)
  VALUES (round, act, a.project_id, a.org_id, p_disp, nullif(btrim(p_note), ''), s_user, s_contact, app_uid())
  ON CONFLICT (closure_id, action_id) DO UPDATE SET disposition = EXCLUDED.disposition, note = EXCLUDED.note,
    sustainer_user_id = EXCLUDED.sustainer_user_id, sustainer_contact_id = EXCLUDED.sustainer_contact_id,
    decided_by = EXCLUDED.decided_by, updated_at = now()
  RETURNING id INTO item;
  RETURN item;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_action_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  is_client boolean := app_uid() IS NOT NULL AND app_org_kind() IS DISTINCT FROM 'firm';
  -- What a client may change. Everything else, including columns added
  -- later, is the firm's.
  client_cols text[] := ARRAY['status', 'owner_user_id', 'blocked_reason', 'updated_at'];
BEGIN
  -- Client users move their actions and (managers, admins) assign owners;
  -- the plan itself is the firm's. Jobs and migrations (no user) are not limited.
  IF is_client AND (
    (to_jsonb(NEW) - client_cols) <> (to_jsonb(OLD) - client_cols)
    OR (NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id AND app_role() NOT IN ('client_admin', 'client_manager'))
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
