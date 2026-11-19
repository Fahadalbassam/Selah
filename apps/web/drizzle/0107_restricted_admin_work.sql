-- A restricted client's admin does the owner's work on the actions they own
-- (phase 3 assessment, area 7 item 1; owner decision 19 Nov 2026). A
-- restricted client has admin accounts only, and the firm records only for
-- clients it runs, so until now nobody could move a restricted client's
-- actions. authorize() now grants action.work, evidence.submit,
-- progress_update.create and deadline_request.create to client_admin as
-- "assigned" on a restricted client (RESTRICTED_POLICY in src/authz/policy.ts).
--
-- The row rules already let a client admin move an action and write its
-- progress, evidence and date requests, on any action of their client. Here
-- the database agrees with authorize() for a restricted client: its admin does
-- this work only on actions they own. Giving an action to a colleague (D1, the
-- owner changes and the status does not) is unchanged. A full client's admin
-- is not touched by any of this (no change for full clients). Reviewing stays
-- the firm's, and whoever recorded a round still cannot review it.

-- 1. False only when the caller is a client admin of a restricted client and
--    the action is not theirs. An action that does not exist is left to the
--    other rules.
CREATE FUNCTION app_restricted_admin_works(aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_role() IS DISTINCT FROM 'client_admin'
    OR NOT EXISTS (
      SELECT 1 FROM actions a JOIN organizations o ON o.id = a.org_id
      WHERE a.id = aid AND o.engagement_mode = 'restricted' AND a.owner_user_id IS DISTINCT FROM app_uid()
    )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_restricted_admin_works(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_restricted_admin_works(uuid) TO selah_app;
--> statement-breakpoint
-- 2. Progress, evidence and date requests: one RESTRICTIVE insert rule per
--    table, so no permissive rule is rewritten.
CREATE POLICY restricted_admin ON progress_updates AS RESTRICTIVE FOR INSERT TO selah_app
  WITH CHECK (app_restricted_admin_works(action_id));
--> statement-breakpoint
CREATE POLICY restricted_admin ON evidence_submissions AS RESTRICTIVE FOR INSERT TO selah_app
  WITH CHECK (app_restricted_admin_works(action_id));
--> statement-breakpoint
CREATE POLICY restricted_admin ON deadline_change_requests AS RESTRICTIVE FOR INSERT TO selah_app
  WITH CHECK (app_restricted_admin_works(action_id));
--> statement-breakpoint
-- 3. Moving the action itself (start, stuck, resume, send for review) and the
--    "I am stuck" reason: the owner's work columns a client may change
--    (check_action_transition(), client_cols), apart from the owner (D1).
--    check_action_transition() keeps every other rule.
CREATE FUNCTION check_restricted_admin_move() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.status, NEW.blocked_reason) IS DISTINCT FROM (OLD.status, OLD.blocked_reason) AND app_uid() IS NOT NULL AND NOT app_restricted_admin_works(OLD.id) THEN
    RAISE EXCEPTION 'on a restricted client, an admin moves only the actions they own' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER restricted_admin_move BEFORE UPDATE OF status, blocked_reason ON actions
  FOR EACH ROW EXECUTE FUNCTION check_restricted_admin_move();
