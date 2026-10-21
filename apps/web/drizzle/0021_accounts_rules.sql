-- Accounts and identity (2026-10-20, research section 10).
--
-- People sign in with their own address; Selah never issues mailboxes.
-- Addresses are unique whatever their case (user_email_lower_uq, 0020) and
-- must sit on the organisation's email domains when it has set them. Admins
-- invite people (the link goes to the invited address only), change their
-- address (confirmed from the new one), switch accounts off with a reason
-- (their sessions end at once) and, every access_review_days, confirm who
-- still works there. Contacts without a login are firm-only. A PDPL erasure
-- clears a person's details but keeps every id, so the history still holds.

-- ------------------------------------------------------- email domains

-- The domain list is lowercase, without "@", and never empty (null means any).
CREATE FUNCTION normalise_email_domains() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE d text;
BEGIN
  IF NEW.allowed_email_domains IS NOT NULL THEN
    NEW.allowed_email_domains := ARRAY(
      SELECT DISTINCT lower(ltrim(trim(x), '@')) FROM unnest(NEW.allowed_email_domains) x WHERE trim(x) <> '' ORDER BY 1
    );
    IF cardinality(NEW.allowed_email_domains) = 0 THEN
      NEW.allowed_email_domains := NULL;
    END IF;
    FOREACH d IN ARRAY coalesce(NEW.allowed_email_domains, '{}') LOOP
      IF d !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
        RAISE EXCEPTION 'not an email domain: %', d USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER email_domains BEFORE INSERT OR UPDATE OF allowed_email_domains ON organizations
  FOR EACH ROW EXECUTE FUNCTION normalise_email_domains();
--> statement-breakpoint
-- Erased accounts (app_erase_user) use a reserved domain that no list holds.
CREATE FUNCTION app_email_ok(org uuid, email text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT email LIKE '%@erased.invalid'
    OR coalesce((SELECT o.allowed_email_domains IS NULL OR lower(split_part(email, '@', 2)) = ANY (o.allowed_email_domains)
                 FROM organizations o WHERE o.id = org), true)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_email_ok(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_email_ok(uuid, text) TO selah_app;
--> statement-breakpoint
-- Checked whenever someone joins an organisation and whenever an address changes.
CREATE FUNCTION check_user_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE org uuid := app_user_org(NEW.id);
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email AND org IS NOT NULL AND NOT app_email_ok(org, NEW.email) THEN
    RAISE EXCEPTION 'that address is not on the organisation''s email domains' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER user_email BEFORE UPDATE OF email ON "user" FOR EACH ROW EXECUTE FUNCTION check_user_email();
--> statement-breakpoint

-- ------------------------------------------------------- memberships

-- A membership stays with its person and organisation. Switching it off
-- needs a reason, records who and when, and is never done to yourself.
CREATE FUNCTION check_membership_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.user_id <> OLD.user_id OR NEW.org_id <> OLD.org_id THEN
    IF TG_OP = 'UPDATE' AND app_uid() IS NOT NULL THEN
      RAISE EXCEPTION 'a membership stays with its person and organisation' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT app_email_ok(NEW.org_id, (SELECT u.email FROM "user" u WHERE u.id = NEW.user_id)) THEN
      RAISE EXCEPTION 'that address is not on the organisation''s email domains' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.active AND NOT NEW.active THEN
    IF app_uid() IS NOT NULL THEN
      IF NEW.user_id = app_uid() THEN
        RAISE EXCEPTION 'you cannot switch off your own account' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.deactivation_reason IS NULL OR NEW.deactivation_reason IS NOT DISTINCT FROM OLD.deactivation_reason THEN
        RAISE EXCEPTION 'say why the account is switched off' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    NEW.deactivated_at := now();
    NEW.deactivated_by := app_uid();
  ELSIF TG_OP = 'UPDATE' AND NOT OLD.active AND NEW.active THEN
    NEW.deactivated_at := NULL;
    NEW.deactivated_by := NULL;
    NEW.deactivation_reason := NULL;
  ELSIF TG_OP = 'UPDATE' AND app_uid() IS NOT NULL AND (
    NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at OR NEW.deactivated_by IS DISTINCT FROM OLD.deactivated_by
    OR NEW.deactivation_reason IS DISTINCT FROM OLD.deactivation_reason
  ) THEN
    RAISE EXCEPTION 'the deactivation record is kept by the database' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER membership_change BEFORE INSERT OR UPDATE ON org_memberships FOR EACH ROW EXECUTE FUNCTION check_membership_change();
--> statement-breakpoint
-- Switching an account off ends its sessions in the same transaction, and
-- both directions go to the audit log.
CREATE FUNCTION log_membership_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.active AND NOT NEW.active THEN
    DELETE FROM session WHERE user_id = NEW.user_id;
    INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, reason)
      VALUES (app_uid(), NEW.org_id, 'membership.deactivate', 'user', NEW.user_id, 'allow', NEW.deactivation_reason);
  ELSIF NOT OLD.active AND NEW.active THEN
    INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome)
      VALUES (app_uid(), NEW.org_id, 'membership.reactivate', 'user', NEW.user_id, 'allow');
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER membership_log AFTER UPDATE OF active ON org_memberships FOR EACH ROW EXECUTE FUNCTION log_membership_change();
--> statement-breakpoint

-- ------------------------------------------------------- mail

-- Links only. Rows are written by the functions below, never directly, so
-- no app bug can send mail to an arbitrary address. A sender job delivers
-- them (as the schema owner) and prefixes the site's address to the link.
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_kind
  CHECK (kind IN ('invitation', 'email_change.confirm', 'email_change.notice', 'access_review.due'));
--> statement-breakpoint
ALTER TABLE outbound_emails ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ------------------------------------------------------- invitations

-- Who may invite into an organisation: the firm admin anywhere the firm
-- works, a client admin into their own organisation.
CREATE FUNCTION app_can_admin_org(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (app_role() = 'firm_admin' AND app_can_see_org(org)) OR (app_role() = 'client_admin' AND org = app_org())
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_admin_org(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_admin_org(uuid) TO selah_app;
--> statement-breakpoint
ALTER TABLE invitations ADD CONSTRAINT invitation_token_is_hash CHECK (token_hash ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON invitations TO selah_app;
--> statement-breakpoint
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY admin_read ON invitations FOR SELECT TO selah_app USING (app_can_admin_org(org_id));
--> statement-breakpoint
CREATE POLICY admin_invite ON invitations FOR INSERT TO selah_app
  WITH CHECK (app_can_admin_org(org_id) AND invited_by = app_uid());
--> statement-breakpoint
CREATE POLICY admin_revoke ON invitations FOR UPDATE TO selah_app
  USING (app_can_admin_org(org_id)) WITH CHECK (app_can_admin_org(org_id));
--> statement-breakpoint
CREATE FUNCTION check_invitation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o organizations%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF app_uid() IS NOT NULL AND ((to_jsonb(NEW) - 'revoked_at') <> (to_jsonb(OLD) - 'revoked_at')
       OR OLD.revoked_at IS NOT NULL OR OLD.accepted_at IS NOT NULL) THEN
      RAISE EXCEPTION 'an open invitation can only be revoked' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO o FROM organizations WHERE id = NEW.org_id;
  NEW.email := lower(trim(NEW.email));
  NEW.expires_at := now() + interval '7 days';
  NEW.accepted_at := NULL;
  NEW.accepted_user_id := NULL;
  NEW.revoked_at := NULL;
  IF NEW.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'not an email address' USING ERRCODE = 'check_violation';
  END IF;
  IF (o.kind = 'firm') <> (NEW.role IN ('firm_admin', 'consultant')) THEN
    RAISE EXCEPTION 'role % does not belong in a % organization', NEW.role, o.kind USING ERRCODE = 'check_violation';
  END IF;
  IF o.kind = 'firm' AND o.allowed_email_domains IS NULL THEN
    RAISE EXCEPTION 'set the firm''s email domains before inviting staff' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT app_email_ok(NEW.org_id, NEW.email) THEN
    RAISE EXCEPTION 'that address is not on the organisation''s email domains' USING ERRCODE = 'check_violation';
  END IF;
  -- One membership per person: someone with an account cannot be invited again.
  IF EXISTS (SELECT 1 FROM "user" u WHERE lower(u.email) = NEW.email) THEN
    RAISE EXCEPTION 'that address already has an account' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invitation_rules BEFORE INSERT OR UPDATE ON invitations FOR EACH ROW EXECUTE FUNCTION check_invitation();
--> statement-breakpoint
-- Queue the invitation's mail. The caller passes the raw token; it must
-- hash to the stored one, so the link can only go to the invited address.
CREATE FUNCTION app_send_invitation(iid uuid, token text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE inv invitations%ROWTYPE;
BEGIN
  SELECT * INTO inv FROM invitations WHERE id = iid;
  IF NOT FOUND OR NOT app_can_admin_org(inv.org_id) OR inv.accepted_at IS NOT NULL OR inv.revoked_at IS NOT NULL
     OR inv.token_hash <> encode(sha256(convert_to(token, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO outbound_emails (to_email, kind, link) VALUES (inv.email, 'invitation', '/invite/' || token);
END $$;
--> statement-breakpoint
-- What the invite page shows before the person sets a password. Public.
CREATE FUNCTION app_open_invitation(token_hash text)
RETURNS TABLE (id uuid, email text, name text, role role, org_name text, org_name_ar text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, i.email, i.name, i.role, o.name, o.name_ar
  FROM invitations i JOIN organizations o ON o.id = i.org_id
  WHERE i.token_hash = app_open_invitation.token_hash AND i.accepted_at IS NULL AND i.revoked_at IS NULL
    AND i.expires_at > now() AND o.status = 'active'
$$;
--> statement-breakpoint
-- Join the organisation once the account exists (the auth role creates it
-- with the invited address). Public; the token is the proof.
CREATE FUNCTION app_accept_invitation(token_hash text, new_user uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE inv invitations%ROWTYPE;
BEGIN
  SELECT * INTO inv FROM invitations i WHERE i.token_hash = app_accept_invitation.token_hash FOR UPDATE;
  IF NOT FOUND OR inv.accepted_at IS NOT NULL OR inv.revoked_at IS NOT NULL OR inv.expires_at <= now() THEN
    RAISE EXCEPTION 'this invitation is no longer valid' USING ERRCODE = 'SL400';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = new_user AND lower(u.email) = inv.email) THEN
    RAISE EXCEPTION 'the account does not match the invitation' USING ERRCODE = 'SL400';
  END IF;
  INSERT INTO org_memberships (user_id, org_id, role) VALUES (new_user, inv.org_id, inv.role);
  UPDATE invitations SET accepted_at = now(), accepted_user_id = new_user WHERE id = inv.id;
  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
    VALUES (new_user, inv.org_id, 'invitation.accept', 'invitation', inv.id, 'allow', jsonb_build_object('invited_by', inv.invited_by));
  RETURN inv.org_id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_send_invitation(uuid, text), app_open_invitation(text), app_accept_invitation(text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_send_invitation(uuid, text), app_open_invitation(text), app_accept_invitation(text, uuid) TO selah_app;
--> statement-breakpoint

-- ------------------------------------------------------- email changes

-- Whose address an admin may change: the firm admin anyone the firm works
-- with, a client admin their own organisation's other people except
-- fellow admins. Nobody changes their own.
CREATE FUNCTION app_can_change_email(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT target <> app_uid() AND (
    (app_role() = 'firm_admin' AND app_can_see_org(app_user_org(target)))
    OR (app_role() = 'client_admin' AND app_user_org(target) = app_org()
        AND (SELECT m.role FROM org_memberships m WHERE m.user_id = target) <> 'client_admin')
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_change_email(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_change_email(uuid) TO selah_app;
--> statement-breakpoint
ALTER TABLE email_changes ADD CONSTRAINT email_change_token_is_hash CHECK (token_hash ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON email_changes TO selah_app;
--> statement-breakpoint
ALTER TABLE email_changes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY admin_read ON email_changes FOR SELECT TO selah_app USING (app_can_change_email(user_id));
--> statement-breakpoint
CREATE POLICY admin_request ON email_changes FOR INSERT TO selah_app
  WITH CHECK (app_can_change_email(user_id) AND requested_by = app_uid());
--> statement-breakpoint
CREATE POLICY admin_cancel ON email_changes FOR UPDATE TO selah_app
  USING (app_can_change_email(user_id)) WITH CHECK (app_can_change_email(user_id));
--> statement-breakpoint
CREATE FUNCTION check_email_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF app_uid() IS NOT NULL AND ((to_jsonb(NEW) - 'cancelled_at') <> (to_jsonb(OLD) - 'cancelled_at')
       OR OLD.cancelled_at IS NOT NULL OR OLD.confirmed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'an open change can only be cancelled' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  NEW.new_email := lower(trim(NEW.new_email));
  NEW.old_email := (SELECT u.email FROM "user" u WHERE u.id = NEW.user_id);
  NEW.expires_at := now() + interval '2 days';
  NEW.confirmed_at := NULL;
  NEW.cancelled_at := NULL;
  IF NEW.new_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'not an email address' USING ERRCODE = 'check_violation';
  END IF;
  IF lower(NEW.old_email) = NEW.new_email THEN
    RAISE EXCEPTION 'that is already their address' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT app_email_ok(app_user_org(NEW.user_id), NEW.new_email) THEN
    RAISE EXCEPTION 'that address is not on the organisation''s email domains' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "user" u WHERE lower(u.email) = NEW.new_email) THEN
    RAISE EXCEPTION 'that address already has an account' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER email_change_rules BEFORE INSERT OR UPDATE ON email_changes FOR EACH ROW EXECUTE FUNCTION check_email_change();
--> statement-breakpoint
CREATE FUNCTION app_send_email_change(cid uuid, token text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c email_changes%ROWTYPE;
BEGIN
  SELECT * INTO c FROM email_changes WHERE id = cid;
  IF NOT FOUND OR NOT app_can_change_email(c.user_id) OR c.confirmed_at IS NOT NULL OR c.cancelled_at IS NOT NULL
     OR c.token_hash <> encode(sha256(convert_to(token, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO outbound_emails (to_email, kind, link) VALUES (c.new_email, 'email_change.confirm', '/confirm-email/' || token);
END $$;
--> statement-breakpoint
-- The new address confirms. The account switches over, signs out
-- everywhere, and the old address is told. Public; the token is the proof.
CREATE FUNCTION app_confirm_email_change(token_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c email_changes%ROWTYPE;
BEGIN
  SELECT * INTO c FROM email_changes e WHERE e.token_hash = app_confirm_email_change.token_hash FOR UPDATE;
  IF NOT FOUND OR c.confirmed_at IS NOT NULL OR c.cancelled_at IS NOT NULL OR c.expires_at <= now() THEN
    RAISE EXCEPTION 'this link is no longer valid' USING ERRCODE = 'SL400';
  END IF;
  UPDATE email_changes SET confirmed_at = now() WHERE id = c.id;
  UPDATE "user" SET email = c.new_email, email_verified = true, updated_at = now() WHERE id = c.user_id;
  DELETE FROM session WHERE user_id = c.user_id;
  INSERT INTO outbound_emails (to_email, kind) VALUES (c.old_email, 'email_change.notice');
  -- The addresses stay in email_changes (which an erasure clears), not in the append-only log.
  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
    VALUES (c.requested_by, app_user_org(c.user_id), 'user.email_change', 'user', c.user_id, 'allow',
            jsonb_build_object('email_change_id', c.id));
  RETURN c.user_id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_send_email_change(uuid, text), app_confirm_email_change(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_send_email_change(uuid, text), app_confirm_email_change(text) TO selah_app;
--> statement-breakpoint

-- ------------------------------------------------------- access reviews

GRANT SELECT, INSERT ON access_reviews TO selah_app;
--> statement-breakpoint
ALTER TABLE access_reviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY admin_read ON access_reviews FOR SELECT TO selah_app USING (app_can_admin_org(org_id));
--> statement-breakpoint
CREATE POLICY admin_review ON access_reviews FOR INSERT TO selah_app
  WITH CHECK (app_can_admin_org(org_id) AND reviewed_by = app_uid());
--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON access_reviews FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
-- A review covers everyone: each active member is kept, and each person
-- listed as switched off is a member who is now inactive.
CREATE FUNCTION check_access_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.kept && NEW.deactivated THEN
    RAISE EXCEPTION 'a person is either kept or switched off' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM org_memberships m WHERE m.org_id = NEW.org_id AND m.active AND m.user_id <> ALL (NEW.kept)) THEN
    RAISE EXCEPTION 'the review must cover every active member' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.kept) k WHERE NOT EXISTS (
       SELECT 1 FROM org_memberships m WHERE m.user_id = k AND m.org_id = NEW.org_id AND m.active))
     OR EXISTS (SELECT 1 FROM unnest(NEW.deactivated) d WHERE NOT EXISTS (
       SELECT 1 FROM org_memberships m WHERE m.user_id = d AND m.org_id = NEW.org_id AND NOT m.active)) THEN
    RAISE EXCEPTION 'the review lists someone who is not in that state' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER access_review_rules BEFORE INSERT ON access_reviews FOR EACH ROW EXECUTE FUNCTION check_access_review();
--> statement-breakpoint
-- Who owes a review on `today`: each active organisation with people,
-- through its admins (a client with no active admin falls to the firm's).
-- The clock starts at the last review, or when the organisation was added.
CREATE FUNCTION app_access_reviews_due(today date)
RETURNS TABLE (org_id uuid, admin_user_id uuid, last_review date)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH orgs AS (
    SELECT o.id, o.kind,
           coalesce((SELECT max(r.created_at) FROM access_reviews r WHERE r.org_id = o.id), o.created_at) AS since,
           (SELECT coalesce(max(s.access_review_days), 90) FROM firm_settings s) AS days
    FROM organizations o
    WHERE o.status = 'active' AND EXISTS (SELECT 1 FROM org_memberships m WHERE m.org_id = o.id AND m.active)
  ), admins AS (
    SELECT g.id AS org_id, m.user_id, g.since
    FROM orgs g JOIN org_memberships m ON m.org_id = g.id AND m.active
      AND m.role = CASE g.kind WHEN 'firm' THEN 'firm_admin'::role ELSE 'client_admin'::role END
    WHERE (g.since AT TIME ZONE 'Asia/Riyadh')::date + g.days <= today
  )
  SELECT a.org_id, a.user_id, (a.since AT TIME ZONE 'Asia/Riyadh')::date FROM admins a
  UNION ALL
  SELECT g.id, m.user_id, (g.since AT TIME ZONE 'Asia/Riyadh')::date
  FROM orgs g JOIN organizations f ON f.kind = 'firm'
  JOIN org_memberships m ON m.org_id = f.id AND m.active AND m.role = 'firm_admin'
  WHERE g.kind = 'client' AND (g.since AT TIME ZONE 'Asia/Riyadh')::date + g.days <= today
    AND NOT EXISTS (SELECT 1 FROM admins a WHERE a.org_id = g.id)
$$;
--> statement-breakpoint
-- Tell each of them once per period, in the app and by mail (a link only).
-- Run daily as the schema owner.
CREATE FUNCTION app_notify_access_reviews(today date) RETURNS integer
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
        SELECT u.email, 'access_review.due', '/settings/people' FROM "user" u WHERE u.id = r.admin_user_id;
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_access_reviews_due(date), app_notify_access_reviews(date) FROM PUBLIC;
--> statement-breakpoint

-- ------------------------------------------------------- client contacts

-- Firm-only: the firm admin, and consultants on that client's team.
GRANT SELECT, INSERT, UPDATE, DELETE ON client_contacts TO selah_app;
--> statement-breakpoint
ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION app_firm_works_with(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_org_kind() = 'firm' AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = org AND o.kind = 'client')
    AND (app_role() = 'firm_admin' OR app_is_assigned_to_client(org))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_firm_works_with(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_firm_works_with(uuid) TO selah_app;
--> statement-breakpoint
CREATE POLICY firm_all ON client_contacts FOR ALL TO selah_app
  USING (app_firm_works_with(org_id)) WITH CHECK (app_firm_works_with(org_id));
--> statement-breakpoint
CREATE FUNCTION check_client_contact() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := app_uid();
  ELSIF NEW.org_id <> OLD.org_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'a contact stays with its client' USING ERRCODE = 'check_violation';
  END IF;
  NEW.email := nullif(lower(trim(NEW.email)), '');
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER client_contact_rules BEFORE INSERT OR UPDATE ON client_contacts FOR EACH ROW EXECUTE FUNCTION check_client_contact();
--> statement-breakpoint

-- ------------------------------------------------------- erasure

CREATE SEQUENCE erased_user_seq;
--> statement-breakpoint
-- A PDPL erasure request. The person's name and address are replaced, their
-- sign-in (password, sessions, 2FA) is deleted and their account switched
-- off; every id stays, so audit rows and history still hold together and
-- now show "Former user #n". Firm admins only, never themselves; logged.
CREATE FUNCTION app_erase_user(target uuid, reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n integer;
  addrs text[];
  gone text;
BEGIN
  IF app_role() IS DISTINCT FROM 'firm_admin' OR target = app_uid()
     OR NOT (app_user_org(target) = app_org() OR app_can_see_org(app_user_org(target))) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF nullif(trim(reason), '') IS NULL THEN
    RAISE EXCEPTION 'say why the person is erased' USING ERRCODE = 'check_violation';
  END IF;
  -- Every address the person has used here.
  SELECT array_agg(DISTINCT lower(a)) INTO addrs FROM (
    SELECT email FROM "user" WHERE id = target
    UNION ALL SELECT old_email FROM email_changes WHERE user_id = target
    UNION ALL SELECT new_email FROM email_changes WHERE user_id = target AND confirmed_at IS NOT NULL
  ) x(a);
  n := nextval('erased_user_seq');
  gone := 'erased-' || n || '@erased.invalid';
  UPDATE "user" SET name = 'Former user #' || n, email = gone, image = NULL, email_verified = false,
                    two_factor_enabled = false, updated_at = now() WHERE id = target;
  DELETE FROM session WHERE user_id = target;
  DELETE FROM account WHERE user_id = target;
  DELETE FROM two_factor WHERE user_id = target;
  UPDATE org_memberships SET active = false, deactivation_reason = 'erased: ' || reason WHERE user_id = target AND active;
  -- Invitations and address changes only hold contact details; the audit
  -- log keeps the fact that they happened.
  DELETE FROM invitations WHERE accepted_user_id = target OR email = ANY (addrs);
  DELETE FROM email_changes WHERE user_id = target;
  DELETE FROM outbound_emails WHERE lower(to_email) = ANY (addrs) AND sent_at IS NULL;
  UPDATE outbound_emails SET to_email = gone WHERE lower(to_email) = ANY (addrs);
  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, reason)
    VALUES (app_uid(), app_user_org(target), 'user.erase', 'user', target, 'allow', reason);
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_erase_user(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_erase_user(uuid, text) TO selah_app;
