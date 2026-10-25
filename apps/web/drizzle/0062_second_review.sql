CREATE TYPE "public"."second_review_rule" AS ENUM('off', 'repeat_revisions', 'high_priority', 'all');--> statement-breakpoint
CREATE TABLE "client_review_settings" (
	"client_org_id" uuid PRIMARY KEY NOT NULL,
	"rule" "second_review_rule" DEFAULT 'off' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_signoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"evidence_submission_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"evidence_sha256" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_signoffs_note" CHECK ("review_signoffs"."note" IS NULL OR length(btrim("review_signoffs"."note")) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "second_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "client_review_settings" ADD CONSTRAINT "client_review_settings_client_org_id_organizations_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_review_settings" ADD CONSTRAINT "client_review_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_signoffs" ADD CONSTRAINT "review_signoffs_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_signoffs" ADD CONSTRAINT "review_signoffs_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_signoffs" ADD CONSTRAINT "review_signoffs_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_signoffs_action_idx" ON "review_signoffs" USING btree ("action_id","created_at");--> statement-breakpoint
-- Hand-written (F22): a second consultant's sign-off on evidence. The lead
-- who wrote an action is often the only one reviewing it, and when evidence
-- goes back twice a fresh pair of eyes helps (research/platforms/02-audit-
-- followup.md §6 item 9; lifecycle gaps C.4: the reviewer is not the author).
--
-- How it works: the first consultant who accepts records a sign-off and the
-- action stays Awaiting Review. A second consultant (never the owner, never
-- a submitter of the round, never the first reviewer) accepts it, and only
-- then is it Verified Complete. Either may ask for a revision instead, which
-- starts a new round needing both again.
--
-- When it applies: the client's rule (client_review_settings, "off" without
-- a row), or the action's own switch (actions.second_review), which only
-- the client's lead or deputy, an internal project's lead, or the firm admin
-- turns on or off. The rule's levels each include the one before:
--   repeat_revisions  evidence has gone back for revision twice since the
--                     action was released or last reopened
--   high_priority     that, or the recommendation is high or critical
--   all               every action of the client
CREATE FUNCTION app_action_needs_second_review(aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT a.second_review OR CASE coalesce(s.rule, 'off')
        WHEN 'all' THEN true
        WHEN 'high_priority' THEN r.priority IN ('high', 'critical') OR rev.n >= 2
        WHEN 'repeat_revisions' THEN rev.n >= 2
        ELSE false
      END
    FROM actions a
      JOIN projects p ON p.id = a.project_id
      JOIN recommendations r ON r.id = a.recommendation_id
      LEFT JOIN client_review_settings s ON s.client_org_id = a.org_id AND p.kind = 'client'
      CROSS JOIN LATERAL (
        SELECT count(*) AS n FROM reviews v
        WHERE v.action_id = a.id AND v.outcome = 'revise' AND v.created_at >= coalesce(a.reopened_at, '-infinity')
      ) rev
    WHERE a.id = aid), false)
$$;
--> statement-breakpoint
-- Who submitted evidence, or recorded progress for the client, in the round
-- under review (the same people app_submitted_this_round() checks for the
-- caller), for anyone.
CREATE FUNCTION app_round_submitters(act uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH since AS (SELECT coalesce((SELECT max(r.created_at) FROM reviews r WHERE r.action_id = act), '-infinity') AS at)
  SELECT es.submitted_by FROM evidence_submissions es, since WHERE es.action_id = act AND es.created_at > since.at
  UNION
  SELECT pu.author_id FROM progress_updates pu, since
  WHERE pu.action_id = act AND pu.source = 'consultant_recorded' AND pu.created_at > since.at
$$;
--> statement-breakpoint
-- Where an action stands, for anyone who can open its project: whether a
-- second sign-off applies and why, and the first sign-off of the round under
-- review (none unless the action is Awaiting Review).
CREATE FUNCTION app_second_review_state(aid uuid)
RETURNS TABLE (required boolean, reason text, rule second_review_rule, flagged boolean, revisions integer,
               signed_by uuid, signed_by_name text, signed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_action_needs_second_review(a.id),
    CASE
      WHEN NOT app_action_needs_second_review(a.id) THEN NULL
      WHEN a.second_review THEN 'flag'
      WHEN s.rule = 'all' THEN 'all'
      WHEN s.rule = 'high_priority' AND r.priority IN ('high', 'critical') THEN 'high_priority'
      ELSE 'repeat_revisions'
    END,
    CASE WHEN p.kind = 'client' THEN coalesce(s.rule, 'off') END,
    a.second_review,
    rev.n::int,
    so.reviewer_id, u.name, so.created_at
  FROM actions a
    JOIN projects p ON p.id = a.project_id
    JOIN recommendations r ON r.id = a.recommendation_id
    LEFT JOIN client_review_settings s ON s.client_org_id = a.org_id AND p.kind = 'client'
    CROSS JOIN LATERAL (
      SELECT count(*) AS n FROM reviews v
      WHERE v.action_id = a.id AND v.outcome = 'revise' AND v.created_at >= coalesce(a.reopened_at, '-infinity')
    ) rev
    LEFT JOIN LATERAL (
      SELECT x.reviewer_id, x.created_at FROM review_signoffs x
      WHERE x.action_id = a.id AND a.status = 'awaiting_review' AND x.created_at >= coalesce(a.awaiting_review_at, '-infinity')
      ORDER BY x.created_at DESC LIMIT 1
    ) so ON true
    LEFT JOIN "user" u ON u.id = so.reviewer_id
  WHERE a.id = aid AND app_can_see_project(a.project_id)
$$;
--> statement-breakpoint
-- Who could give the second sign-off now, for firm staff on the project:
-- active staff on the project (observers never review) and the client's lead
-- and deputy, less the owner, the round's submitters and the first reviewer.
-- When nobody on the team is left, the firm's admins (fallback = true).
CREATE FUNCTION app_second_reviewers(aid uuid) RETURNS TABLE (user_id uuid, name text, fallback boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a actions; p projects; excluded uuid[];
BEGIN
  SELECT * INTO a FROM actions WHERE id = aid;
  SELECT * INTO p FROM projects WHERE id = a.project_id;
  IF a.id IS NULL OR app_org_kind() IS DISTINCT FROM 'firm' OR NOT app_can_see_project(a.project_id) THEN
    RETURN;
  END IF;
  excluded := array_remove(ARRAY[a.owner_user_id], NULL)
    || coalesce((SELECT array_agg(s) FROM app_round_submitters(aid) s), '{}')
    || coalesce((SELECT array_agg(x.reviewer_id) FROM review_signoffs x
                 WHERE x.action_id = aid AND x.created_at >= coalesce(a.awaiting_review_at, '-infinity')), '{}');
  RETURN QUERY
    SELECT DISTINCT ON (u.name, u.id) u.id, u.name, false FROM "user" u
      JOIN org_memberships m ON m.user_id = u.id AND m.org_id = p.firm_org_id AND m.active AND m.role IN ('firm_admin', 'consultant')
    WHERE NOT (u.id = ANY (excluded)) AND (
      EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = u.id AND NOT pm.observer)
      OR (p.kind = 'client' AND EXISTS (
        SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = p.org_id AND ca.user_id = u.id AND (ca.is_lead OR ca.is_deputy))))
    ORDER BY u.name, u.id;
  IF NOT FOUND THEN
    RETURN QUERY
      SELECT u.id, u.name, true FROM "user" u
        JOIN org_memberships m ON m.user_id = u.id AND m.org_id = p.firm_org_id AND m.active AND m.role = 'firm_admin'
      WHERE NOT (u.id = ANY (excluded))
      ORDER BY u.name, u.id;
  END IF;
END $$;
--> statement-breakpoint
-- The first sign-off. The caller must be able to review the round (the same
-- checks as a review: staff on the project, not the owner, not a submitter),
-- every evidence item must be settled, and nobody may have signed off on
-- this round yet. Records what the reviewer saw, tells whoever can give the
-- second sign-off, and returns the sign-off's id.
CREATE FUNCTION app_sign_off(aid uuid, p_note text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a actions;
  since timestamptz;
  ids uuid[];
  hashes text[];
  note_in text := nullif(btrim(coalesce(p_note, '')), '');
  row_id uuid;
BEGIN
  SELECT * INTO a FROM actions WHERE id = aid FOR UPDATE;
  IF a.id IS NULL OR NOT app_can_see_project(a.project_id) OR NOT app_action_label_ok(a.id) OR NOT app_action_dept_ok(a.id)
     OR app_role() NOT IN ('firm_admin', 'consultant') THEN
    RAISE EXCEPTION 'action not visible' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app_observes_project(a.project_id) THEN
    RAISE EXCEPTION 'you observe this project; ask its lead to staff you to change anything' USING ERRCODE = 'check_violation';
  END IF;
  IF a.status <> 'awaiting_review' THEN
    RAISE EXCEPTION 'only work awaiting review is signed off' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT app_action_needs_second_review(aid) THEN
    RAISE EXCEPTION 'this action needs no second sign-off; accept it instead' USING ERRCODE = 'check_violation';
  END IF;
  IF a.owner_user_id = app_uid() OR app_submitted_this_round(aid) THEN
    RAISE EXCEPTION 'nobody signs off work they own or submitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM review_signoffs x WHERE x.action_id = aid AND x.created_at >= coalesce(a.awaiting_review_at, '-infinity')) THEN
    RAISE EXCEPTION 'this round already has its first sign-off' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM evidence_requests er WHERE er.action_id = aid AND er.status NOT IN ('accepted', 'waived')) THEN
    RAISE EXCEPTION 'every evidence request must be accepted or waived first' USING ERRCODE = 'check_violation';
  END IF;
  IF note_in IS NOT NULL AND length(note_in) > 4000 THEN
    RAISE EXCEPTION 'a note is at most 4000 characters' USING ERRCODE = 'check_violation';
  END IF;
  -- Exactly what was looked at: every submission since the previous review.
  since := coalesce((SELECT max(r.created_at) FROM reviews r WHERE r.action_id = aid), '-infinity');
  SELECT coalesce(array_agg(es.id ORDER BY es.created_at), '{}'), coalesce(array_agg(d.sha256 ORDER BY es.created_at), '{}')
    INTO ids, hashes
    FROM evidence_submissions es JOIN documents d ON d.id = es.document_id
    WHERE es.action_id = aid AND es.created_at > since;
  INSERT INTO review_signoffs (project_id, org_id, action_id, reviewer_id, evidence_submission_ids, evidence_sha256, note)
    VALUES (a.project_id, a.org_id, aid, app_uid(), ids, hashes, note_in) RETURNING id INTO row_id;
  INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, from_state, to_state)
    VALUES (a.project_id, a.org_id, app_uid(), 'action', aid, 'second_review_requested', 'awaiting_review', 'awaiting_review');
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT c.user_id, 'action.second_review', 'action', aid FROM app_second_reviewers(aid) c;
  RETURN row_id;
END $$;
--> statement-breakpoint
-- A client's rule. The firm admin, or the client's lead or deputy, while the
-- client is active. Returns the rule before the change.
CREATE FUNCTION app_set_second_review_rule(client uuid, p_rule second_review_rule) RETURNS second_review_rule
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE before second_review_rule;
BEGIN
  IF app_org_kind() IS DISTINCT FROM 'firm' OR NOT app_can_see_org(client)
     OR NOT (app_role() = 'firm_admin' OR (app_role() = 'consultant' AND app_is_client_lead(client))) THEN
    RAISE EXCEPTION 'only the firm admin or the client''s lead sets this' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT app_is_active_client(client) THEN
    RAISE EXCEPTION 'the client is not active' USING ERRCODE = 'check_violation';
  END IF;
  before := coalesce((SELECT s.rule FROM client_review_settings s WHERE s.client_org_id = client), 'off');
  INSERT INTO client_review_settings (client_org_id, rule, updated_by, updated_at) VALUES (client, p_rule, app_uid(), now())
    ON CONFLICT (client_org_id) DO UPDATE SET rule = EXCLUDED.rule, updated_by = EXCLUDED.updated_by, updated_at = now();
  RETURN before;
END $$;
--> statement-breakpoint
-- On actions: only the lead, deputy or firm admin moves the switch, and
-- Verified Complete needs the first sign-off of the round by someone other
-- than the consultant whose accept verifies it. Jobs (no user) may move the
-- switch; nothing they do verifies an action.
CREATE FUNCTION check_second_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  kind project_kind;
  accepter uuid;
BEGIN
  IF NEW.second_review IS DISTINCT FROM OLD.second_review AND app_uid() IS NOT NULL THEN
    SELECT p.kind INTO kind FROM projects p WHERE p.id = NEW.project_id;
    IF NOT (app_role() = 'firm_admin'
            OR (kind = 'client' AND app_role() = 'consultant' AND app_is_client_lead(NEW.org_id))
            OR (kind = 'internal' AND app_is_project_lead(NEW.project_id))) THEN
      RAISE EXCEPTION 'only the lead or the firm admin asks for a second sign-off' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF NEW.status = 'verified_complete' AND OLD.status = 'awaiting_review' AND app_action_needs_second_review(NEW.id) THEN
    SELECT r.reviewer_id INTO accepter FROM reviews r
      WHERE r.action_id = NEW.id AND r.created_at >= coalesce(OLD.awaiting_review_at, '-infinity')
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1;
    IF NOT EXISTS (
      SELECT 1 FROM review_signoffs x
      WHERE x.action_id = NEW.id AND x.created_at >= coalesce(OLD.awaiting_review_at, '-infinity') AND x.reviewer_id IS DISTINCT FROM accepter
    ) THEN
      RAISE EXCEPTION 'verified_complete needs a second sign-off by another consultant' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER action_second_review BEFORE UPDATE OF second_review, status ON actions
  FOR EACH ROW EXECUTE FUNCTION check_second_review();
--> statement-breakpoint
-- Sign-offs are history: never changed or removed, frozen with a closed
-- project, never written by an observer, and read like reviews.
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON review_signoffs FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER project_open BEFORE INSERT OR UPDATE OR DELETE ON review_signoffs FOR EACH ROW EXECUTE FUNCTION check_project_open();
--> statement-breakpoint
CREATE TRIGGER project_observer BEFORE INSERT OR UPDATE OR DELETE ON review_signoffs FOR EACH ROW EXECUTE FUNCTION check_not_observer();
--> statement-breakpoint
ALTER TABLE review_signoffs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_review_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON review_signoffs, client_review_settings TO selah_app;
--> statement-breakpoint
CREATE POLICY scoped_read ON review_signoffs FOR SELECT TO selah_app USING (app_can_see_project(project_id));
--> statement-breakpoint
CREATE POLICY recommendation_label ON review_signoffs AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_label_ok(action_id)) WITH CHECK (app_action_label_ok(action_id));
--> statement-breakpoint
CREATE POLICY department ON review_signoffs AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_dept_ok(action_id)) WITH CHECK (app_action_dept_ok(action_id));
--> statement-breakpoint
-- The firm's staff who can see the client read its rule; the client never does.
CREATE POLICY firm_read ON client_review_settings FOR SELECT TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_org(client_org_id));
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_action_needs_second_review(uuid), app_round_submitters(uuid), app_second_review_state(uuid),
  app_second_reviewers(uuid), app_sign_off(uuid, text), app_set_second_review_rule(uuid, second_review_rule) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_second_review_state(uuid), app_second_reviewers(uuid), app_sign_off(uuid, text),
  app_set_second_review_rule(uuid, second_review_rule) TO selah_app;
