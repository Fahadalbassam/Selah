-- The mail sender (src/jobs/mail.ts) and password reset.
--
-- The sender runs as the schema owner: it claims due rows, sends them, and
-- stamps sent_at. A row is tried up to 8 times with growing gaps, then
-- marked failed. The link is cleared once sent, so a token never outlives
-- its mail in the database.

ALTER TABLE outbound_emails DROP CONSTRAINT outbound_kind;
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_kind CHECK (kind IN (
  'invitation', 'email_change.confirm', 'email_change.notice', 'access_review.due',
  'meeting.invite', 'meeting.cancel', 'password_reset', 'password_reset.notice'));
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_attempts CHECK (attempts >= 0);
--> statement-breakpoint
CREATE INDEX outbound_emails_due_idx ON outbound_emails (created_at) WHERE sent_at IS NULL AND failed_at IS NULL;
--> statement-breakpoint

-- Wake a sender that is listening (npm run job:mail -- --watch), so a reset
-- link arrives in seconds rather than at the next poll.
CREATE FUNCTION notify_outbound_email() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_notify('outbound_email', '');
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER outbound_email_notify AFTER INSERT ON outbound_emails
  FOR EACH STATEMENT EXECUTE FUNCTION notify_outbound_email();
--> statement-breakpoint

-- ------------------------------------------------------- password reset

-- Who may reset a password: someone with an active membership in an active
-- organisation. Erased and switched-off accounts get nothing, and the caller
-- is never told which (Better Auth answers the same either way).
CREATE FUNCTION app_can_reset_password(uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_memberships m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = uid AND m.active AND o.status = 'active'
  )
$$;
--> statement-breakpoint
-- Called by Better Auth (the auth role) with the reset token it made. At most
-- three reset mails per address an hour, so nobody can flood an inbox; an
-- older unsent link is replaced by the new one.
CREATE FUNCTION app_queue_password_reset(uid uuid, token text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE addr text;
BEGIN
  IF token !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'bad token' USING ERRCODE = 'check_violation';
  END IF;
  SELECT u.email INTO addr FROM "user" u WHERE u.id = uid;
  IF addr IS NULL OR NOT app_can_reset_password(uid) THEN RETURN false; END IF;
  IF (SELECT count(*) FROM outbound_emails
      WHERE lower(to_email) = lower(addr) AND kind = 'password_reset' AND created_at > now() - interval '1 hour') >= 3 THEN
    RETURN false;
  END IF;
  DELETE FROM outbound_emails WHERE lower(to_email) = lower(addr) AND kind = 'password_reset' AND sent_at IS NULL;
  INSERT INTO outbound_emails (to_email, kind, link) VALUES (addr, 'password_reset', '/reset-password/' || token);
  RETURN true;
END $$;
--> statement-breakpoint
-- After a reset: tell the address, and log it. Sessions are ended by Better Auth.
CREATE FUNCTION app_password_was_reset(uid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE addr text;
BEGIN
  SELECT u.email INTO addr FROM "user" u WHERE u.id = uid;
  IF addr IS NULL THEN RETURN; END IF;
  INSERT INTO outbound_emails (to_email, kind) VALUES (addr, 'password_reset.notice');
  INSERT INTO audit_log (actor_id, action, resource_type, resource_id, outcome)
    VALUES (uid, 'password.reset', 'user', uid, 'allow');
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_reset_password(uuid), app_queue_password_reset(uuid, text), app_password_was_reset(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_queue_password_reset(uuid, text), app_password_was_reset(uuid) TO selah_auth;
--> statement-breakpoint

-- The access review mail pointed at a page that was never built; the people
-- list is /team.
CREATE OR REPLACE FUNCTION app_notify_access_reviews(today date) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n integer := 0; r record;
BEGIN
  FOR r IN SELECT d.org_id, d.admin_user_id, d.last_review FROM app_access_reviews_due(today) d LOOP
    IF NOT EXISTS (
      SELECT 1 FROM notifications x WHERE x.user_id = r.admin_user_id AND x.kind = 'access_review.due' AND x.entity_id = r.org_id
        AND (x.created_at AT TIME ZONE 'Asia/Riyadh')::date >= r.last_review
    ) THEN
      INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES (r.admin_user_id, 'access_review.due', 'organization', r.org_id);
      INSERT INTO outbound_emails (to_email, kind, link)
        SELECT u.email, 'access_review.due', '/team' FROM "user" u WHERE u.id = r.admin_user_id;
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;
