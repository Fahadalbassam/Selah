-- Whether an address-change link can still be confirmed, for the page the
-- mail opens (/confirm-email/<token>). The page asks when it loads, so a dead
-- link says so at once instead of after the button is pressed.
--
-- Read-only: it confirms nothing, ends no session and takes no lock, so a
-- mail scanner that opens the link changes nothing. It answers yes or no
-- only, never whose change it is, and gives the same "no" for a link that is
-- unknown, expired, cancelled or already confirmed (the same four cases
-- app_confirm_email_change() refuses). Public; the token is the proof.
CREATE FUNCTION app_email_change_is_open(token_hash text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM email_changes e
    WHERE e.token_hash = app_email_change_is_open.token_hash
      AND e.confirmed_at IS NULL AND e.cancelled_at IS NULL AND e.expires_at > now()
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_email_change_is_open(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_email_change_is_open(text) TO selah_app;
