-- Hand-written: a client's message to the firm's management is read on the
-- firm admin's home now (page audit 4.2, batch 2; the Notifications page is
-- the list alone). The mail to the admins links there. Only the link
-- changes; the rest is the text of 0060_help.sql.
CREATE OR REPLACE FUNCTION app_report_problem(p_body text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  client uuid := app_org();
  firm uuid;
  text_in text := btrim(coalesce(p_body, ''));
  row_id uuid;
BEGIN
  IF client IS NULL OR app_org_kind() <> 'client' THEN
    RAISE EXCEPTION 'only client people report problems here' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(text_in) = 0 OR length(text_in) > 2000 THEN
    RAISE EXCEPTION 'describe the problem in up to 2000 characters' USING ERRCODE = 'check_violation';
  END IF;
  -- One at a time per person, so the count below holds.
  PERFORM pg_advisory_xact_lock(hashtext('support_request'), hashtext(app_uid()::text));
  IF (SELECT count(*) FROM support_requests s WHERE s.user_id = app_uid() AND s.created_at > now() - interval '1 day') >= app_support_per_day() THEN
    RAISE EXCEPTION 'too many problem reports today' USING ERRCODE = 'SL429';
  END IF;
  -- The firm that runs the client's projects; Selah serves one firm.
  firm := coalesce(
    (SELECT p.firm_org_id FROM projects p WHERE p.org_id = client AND p.kind = 'client' ORDER BY p.created_at LIMIT 1),
    (SELECT o.id FROM organizations o WHERE o.kind = 'firm' ORDER BY o.created_at LIMIT 1));
  INSERT INTO support_requests (firm_org_id, org_id, user_id, body) VALUES (firm, client, app_uid(), text_in) RETURNING id INTO row_id;
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT m.user_id, 'support.requested', 'support_request', row_id FROM org_memberships m
    WHERE m.org_id = firm AND m.active AND m.role = 'firm_admin';
  INSERT INTO outbound_emails (to_email, kind, link)
    SELECT u.email, 'support.requested', '/#problems' FROM org_memberships m JOIN "user" u ON u.id = m.user_id
    WHERE m.org_id = firm AND m.active AND m.role = 'firm_admin' AND app_can_reset_password(m.user_id);
  RETURN row_id;
END $$;
