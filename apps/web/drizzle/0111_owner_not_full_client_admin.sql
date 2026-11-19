-- A full client's admin does not do actions (owner decision, 19 Nov 2026), so
-- nobody gives one to them: the "Give to a colleague" list already leaves them
-- out (PR #202); here the database refuses it too, not only the list. Only on a
-- full client (engagement mode 'full'). A restricted client has admin
-- accounts only and its admin does the work on the actions they own (0107), so there an admin may still be given
-- one; a client the firm runs is unchanged.
--
-- What it covers: a signed-in person changing an action's owner (giving it to
-- a colleague, D1; the firm's edit dialog; a plain UPDATE as the app role).
-- What it leaves as it was: creating an action (the firm may still name the
-- admin, as for the documents it asks of them), releasing a draft, and the
-- leaver hand-over (app_hand_over(), 0034), which hands a departing person's
-- work to whichever active colleague the admin picks, the admin included; the
-- admin then gives each action on with D1. That function runs as its owner,
-- so the check below, which runs as the caller, is skipped inside it; jobs
-- and migrations (not the app role) are skipped too.

-- 1. Is this person an active client admin of this full client?
CREATE FUNCTION app_full_client_admin(target uuid, org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_memberships m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = target AND m.org_id = org AND m.active AND m.role = 'client_admin'
      AND o.kind = 'client' AND o.engagement_mode = 'full'
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_full_client_admin(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_full_client_admin(uuid, uuid) TO selah_app;
--> statement-breakpoint
-- 2. The owner change. Not a definer function on purpose: current_user is the
--    app role for a direct change, and the function's owner inside
--    app_hand_over().
CREATE FUNCTION check_owner_not_full_client_admin() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'selah_app' AND app_uid() IS NOT NULL
     AND NEW.owner_user_id IS NOT NULL AND NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     AND app_full_client_admin(NEW.owner_user_id, NEW.org_id) THEN
    RAISE EXCEPTION 'a full client''s admin does not own actions: give it to a colleague who does the work' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER owner_not_full_client_admin BEFORE UPDATE OF owner_user_id ON actions
  FOR EACH ROW EXECUTE FUNCTION check_owner_not_full_client_admin();
