ALTER TABLE "firm_settings" ADD COLUMN "sign_in_links_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Hand-written (wave 2, F14 part 1): sign-in by a link mailed to the person
-- (decision D7). Only client managers and action owners, who touch Selah a
-- few times a year, may use it. Firm staff and client admins keep password
-- and two-factor sign-in (NCA ECC asks for MFA on remote access) and never
-- get a link. Better Auth's magicLink plugin makes the single-use token and
-- keeps only its hash; these functions decide who gets the mail and whether
-- a link may still be used. The requester always gets the same answer.
ALTER TABLE outbound_emails DROP CONSTRAINT outbound_kind;
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_kind CHECK (kind IN (
  'invitation', 'email_change.confirm', 'email_change.notice', 'access_review.due',
  'meeting.invite', 'meeting.cancel', 'password_reset', 'password_reset.notice', 'two_factor.reset',
  'inquiry.new', 'inquiry.received', 'inquiry.declined', 'action.assigned', 'action.revision_requested',
  'action.verified_complete', 'evidence.requested', 'action.commented', 'action.mentioned', 'follow_up.digest', 'client.archived',
  'pulse.requested', 'sign_in_link'));
--> statement-breakpoint
-- Why this person may not sign in by link, or null when they may: an active
-- client manager or action owner of an active client, with a verified
-- address and no two-factor sign-in of their own (a link would go around
-- it), while the firm has not turned links off.
CREATE FUNCTION app_link_sign_in_refusal(uid uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN u.id IS NULL THEN 'no account'
    WHEN EXISTS (SELECT 1 FROM firm_settings fs WHERE NOT fs.sign_in_links_enabled) THEN 'turned off by the firm'
    WHEN NOT EXISTS (
      SELECT 1 FROM org_memberships m JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = u.id AND m.active AND o.status = 'active' AND o.kind = 'client'
        AND m.role IN ('client_manager', 'action_owner')
    ) THEN 'not an active client manager or action owner'
    WHEN NOT u.email_verified THEN 'address not verified'
    WHEN u.two_factor_enabled THEN 'uses two-factor sign-in'
  END
  FROM (SELECT 1) one LEFT JOIN "user" u ON u.id = uid
$$;
--> statement-breakpoint
-- Called by Better Auth (the auth role) with the token it made, for the
-- address typed. Queues the mail only for someone who may use it, at most
-- five an hour per address; an older unsent link is replaced. Returns
-- whether a mail was queued; the requester is never told.
CREATE FUNCTION app_queue_sign_in_link(addr text, token text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid uuid; who text; refusal text; org uuid;
BEGIN
  IF token !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'bad token' USING ERRCODE = 'check_violation';
  END IF;
  SELECT u.id, u.email INTO uid, who FROM "user" u WHERE lower(u.email) = lower(btrim(addr));
  IF uid IS NULL THEN RETURN false; END IF;
  SELECT m.org_id INTO org FROM org_memberships m WHERE m.user_id = uid AND m.active LIMIT 1;
  refusal := app_link_sign_in_refusal(uid);
  IF refusal IS NULL AND (SELECT count(*) FROM outbound_emails
      WHERE lower(to_email) = lower(who) AND kind = 'sign_in_link' AND created_at > now() - interval '1 hour') >= 5 THEN
    refusal := 'too many links';
  END IF;
  IF refusal IS NOT NULL THEN
    INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, reason)
      VALUES (NULL, org, 'auth.sign_in_link.refused', 'user', uid, 'deny', refusal);
    RETURN false;
  END IF;
  DELETE FROM outbound_emails WHERE lower(to_email) = lower(who) AND kind = 'sign_in_link' AND sent_at IS NULL;
  INSERT INTO outbound_emails (to_email, kind, link) VALUES (who, 'sign_in_link', '/sign-in/link/' || token);
  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome)
    VALUES (NULL, org, 'auth.sign_in_link.sent', 'user', uid, 'allow');
  RETURN true;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_link_sign_in_refusal(uuid), app_queue_sign_in_link(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_link_sign_in_refusal(uuid), app_queue_sign_in_link(text, text) TO selah_auth;
