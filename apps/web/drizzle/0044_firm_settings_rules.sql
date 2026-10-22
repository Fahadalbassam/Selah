-- The firm settings page (docs/firm-settings.md). Only the firm's admins
-- change these (RLS from 0013); here the values get limits, and the intake
-- address starts receiving mail.
--
--   1. Every number has a range, and the check-in days are a short list of
--      days after handover in increasing order.
--   2. The intake address, when set, looks like an address.
--   3. Each new inquiry queues one mail to that address, with a link only.
--      Reading it needs a firm sign-in.

ALTER TABLE firm_settings ADD CONSTRAINT kpi_grace_days_range CHECK (kpi_grace_days BETWEEN 0 AND 90);
--> statement-breakpoint
ALTER TABLE firm_settings ADD CONSTRAINT stale_days_range CHECK (stale_days BETWEEN 1 AND 365);
--> statement-breakpoint
ALTER TABLE firm_settings ADD CONSTRAINT access_review_days_range CHECK (access_review_days BETWEEN 7 AND 365);
--> statement-breakpoint
CREATE FUNCTION app_valid_checkin_days(days integer[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT cardinality(days) <= 6
    AND NOT EXISTS (SELECT 1 FROM unnest(days) d WHERE d IS NULL OR d NOT BETWEEN 1 AND 730)
    AND days = ARRAY(SELECT DISTINCT d FROM unnest(days) d ORDER BY d)
$$;
--> statement-breakpoint
ALTER TABLE firm_settings ADD CONSTRAINT checkin_days_valid CHECK (app_valid_checkin_days(checkin_days));
--> statement-breakpoint
ALTER TABLE firm_settings ADD CONSTRAINT intake_email_format
  CHECK (intake_email IS NULL OR (length(intake_email) <= 254 AND intake_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
--> statement-breakpoint

ALTER TABLE outbound_emails DROP CONSTRAINT outbound_kind;
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_kind CHECK (kind IN (
  'invitation', 'email_change.confirm', 'email_change.notice', 'access_review.due',
  'meeting.invite', 'meeting.cancel', 'password_reset', 'password_reset.notice', 'two_factor.reset',
  'inquiry.new'));
--> statement-breakpoint

-- The in-app notice to every firm admin stays in submit_inquiry; this adds
-- the mail. A link only: the inquiry's details never leave Selah by mail.
CREATE FUNCTION mail_new_inquiry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO outbound_emails (to_email, kind, link)
    SELECT s.intake_email, 'inquiry.new', '/inquiries/' || NEW.id
    FROM firm_settings s WHERE s.org_id = NEW.firm_org_id AND s.intake_email IS NOT NULL;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION mail_new_inquiry() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER inquiry_mail AFTER INSERT ON inquiries FOR EACH ROW EXECUTE FUNCTION mail_new_inquiry();
