ALTER TABLE "outbound_emails" ADD COLUMN "reference" text;
--> statement-breakpoint
ALTER TABLE outbound_emails DROP CONSTRAINT outbound_kind;
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_kind CHECK (kind IN (
  'invitation', 'email_change.confirm', 'email_change.notice', 'access_review.due',
  'meeting.invite', 'meeting.cancel', 'password_reset', 'password_reset.notice', 'two_factor.reset',
  'inquiry.new', 'inquiry.received', 'inquiry.declined', 'action.assigned', 'action.revision_requested',
  'action.verified_complete', 'evidence.requested', 'follow_up.digest'));
--> statement-breakpoint
-- Only an inquiry's mails carry a reference.
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_reference CHECK (reference IS NULL OR kind IN ('inquiry.received', 'inquiry.declined'));--> statement-breakpoint
-- Hand-written: mails to the person who sent an inquiry (wave 1, item 8 and
-- journey gap N10). Both carry the inquiry's reference and nothing else of it.
--
-- 1. An acknowledgement on every new inquiry, at most one a day to an
--    address, so the public form can't be used to flood someone's inbox.
CREATE OR REPLACE FUNCTION mail_new_inquiry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO outbound_emails (to_email, kind, link)
    SELECT s.intake_email, 'inquiry.new', '/inquiries/' || NEW.id
    FROM firm_settings s WHERE s.org_id = NEW.firm_org_id AND s.intake_email IS NOT NULL;
  IF NEW.contact_email IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM outbound_emails o
    WHERE o.kind = 'inquiry.received' AND lower(o.to_email) = lower(NEW.contact_email) AND o.created_at > now() - interval '24 hours'
  ) THEN
    INSERT INTO outbound_emails (to_email, kind, reference, locale)
      VALUES (NEW.contact_email, 'inquiry.received', NEW.public_ref, NEW.preferred_language);
    INSERT INTO inquiry_events (inquiry_id, event) VALUES (NEW.id, 'acknowledged');
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- 2. A courteous decline, once, when the firm admin chooses to send it for
--    an inquiry closed as lost or declined.
CREATE FUNCTION app_mail_inquiry_decline(iid uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  q inquiries%ROWTYPE;
BEGIN
  SELECT * INTO q FROM inquiries WHERE id = iid;
  IF NOT FOUND OR NOT app_can_see_inquiry(iid) OR app_role() IS DISTINCT FROM 'firm_admin' THEN
    RAISE EXCEPTION 'only the firm admin sends a decline' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF q.status NOT IN ('lost', 'declined') THEN
    RAISE EXCEPTION 'a decline is sent for an inquiry closed as lost or declined' USING ERRCODE = 'check_violation';
  END IF;
  IF q.anonymised_at IS NOT NULL OR q.contact_email IS NULL THEN
    RAISE EXCEPTION 'the requester''s address is no longer kept' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM inquiry_events e WHERE e.inquiry_id = iid AND e.event = 'decline_mailed') THEN
    RAISE EXCEPTION 'the decline was already sent' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO outbound_emails (to_email, kind, reference, locale) VALUES (q.contact_email, 'inquiry.declined', q.public_ref, q.preferred_language);
  INSERT INTO inquiry_events (inquiry_id, actor_id, event) VALUES (iid, app_uid(), 'decline_mailed');
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_mail_inquiry_decline(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_mail_inquiry_decline(uuid) TO selah_app;
