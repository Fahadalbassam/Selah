-- Two-factor sign-in (TOTP, Better Auth's twoFactor plugin).
--
-- Required for firm admins, consultants and client admins: the app refuses
-- them everything but the setup page until it is on (src/server/http.ts and
-- page.ts). Nobody in those roles can switch it off themselves; only their
-- admin can reset it, for a lost phone, and they set it up again at the next
-- sign-in.

-- Whether this person must use two-factor sign-in.
CREATE FUNCTION app_requires_two_factor(uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_memberships m
    WHERE m.user_id = uid AND m.active AND m.role IN ('firm_admin', 'consultant', 'client_admin')
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_requires_two_factor(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_requires_two_factor(uuid) TO selah_app, selah_auth;
--> statement-breakpoint

-- Better Auth's "disable" turns the flag off before it deletes the secret,
-- so refusing the flag change here stops the whole disable.
CREATE FUNCTION check_two_factor_off() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'selah_auth' AND app_requires_two_factor(NEW.id) THEN
    RAISE EXCEPTION 'two-factor sign-in is required for this role' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER two_factor_stays_on BEFORE UPDATE OF two_factor_enabled ON "user"
  FOR EACH ROW WHEN (OLD.two_factor_enabled AND NOT NEW.two_factor_enabled) EXECUTE FUNCTION check_two_factor_off();
--> statement-breakpoint

-- Who has it on, for the admins of an organisation (the people list).
CREATE FUNCTION app_two_factor_status(org uuid) RETURNS TABLE (user_id uuid, enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.user_id, coalesce(u.two_factor_enabled, false)
  FROM org_memberships m JOIN "user" u ON u.id = m.user_id
  WHERE m.org_id = org AND (app_org() = org AND app_role() IN ('firm_admin', 'client_admin')
                            OR app_role() = 'firm_admin' AND app_can_see_org(org))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_two_factor_status(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_two_factor_status(uuid) TO selah_app;
--> statement-breakpoint

-- An admin resets someone's two-factor sign-in (a lost phone). Same rule as
-- an address change: the firm admin for anyone the firm works with, a client
-- admin for the others in their organisation except fellow admins, nobody
-- for themselves. Ends their sessions, mails them, and is logged.
CREATE FUNCTION app_reset_two_factor(target uuid, why text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE addr text;
BEGIN
  IF NOT app_can_change_email(target) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF coalesce(btrim(why), '') = '' THEN
    RAISE EXCEPTION 'say why' USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM two_factor WHERE user_id = target;
  UPDATE "user" SET two_factor_enabled = false, updated_at = now() WHERE id = target RETURNING email INTO addr;
  DELETE FROM session WHERE user_id = target;
  INSERT INTO outbound_emails (to_email, kind) VALUES (addr, 'two_factor.reset');
  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, reason)
    VALUES (app_uid(), app_user_org(target), 'two_factor.reset', 'user', target, 'allow', why);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_reset_two_factor(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_reset_two_factor(uuid, text) TO selah_app;
--> statement-breakpoint

ALTER TABLE outbound_emails DROP CONSTRAINT outbound_kind;
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_kind CHECK (kind IN (
  'invitation', 'email_change.confirm', 'email_change.notice', 'access_review.due',
  'meeting.invite', 'meeting.cancel', 'password_reset', 'password_reset.notice', 'two_factor.reset'));
