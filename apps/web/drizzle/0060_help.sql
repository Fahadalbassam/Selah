CREATE TABLE "support_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_org_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"handled_at" timestamp with time zone,
	"handled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_body" CHECK (length(btrim(body)) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_firm_org_id_organizations_id_fk" FOREIGN KEY ("firm_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_handled_by_user_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_requests_user_idx" ON "support_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "support_requests_firm_idx" ON "support_requests" USING btree ("firm_org_id","created_at");--> statement-breakpoint
-- Hand-written (wave 3, F13): help for client people. Two doors: questions
-- about the work go in the action's thread (F11), and a technical problem
-- goes to the firm's admins as a support request. The help page also names
-- the client's consultants, with their work address.
--
-- 1. Who the caller's consultants are: the client's lead and deputy (project
--    null), and the firm people staffed on each project the caller can open
--    (observers are not listed). Only active firm accounts, only the
--    caller's own client. Name and work address, nothing else: the same a
--    client person can already read under app_can_see_user().
CREATE FUNCTION app_my_consultants()
RETURNS TABLE (project_id uuid, user_id uuid, name text, email text, is_lead boolean, is_deputy boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NULL::uuid, u.id, u.name, u.email, ca.is_lead, ca.is_deputy
  FROM client_assignments ca
    JOIN org_memberships m ON m.user_id = ca.user_id AND m.active AND m.role IN ('firm_admin', 'consultant')
    JOIN "user" u ON u.id = ca.user_id
  WHERE app_org_kind() = 'client' AND ca.client_org_id = app_org() AND (ca.is_lead OR ca.is_deputy)
  UNION ALL
  SELECT p.id, u.id, u.name, u.email, coalesce(ca.is_lead, false), coalesce(ca.is_deputy, false)
  FROM projects p
    JOIN project_members pm ON pm.project_id = p.id AND NOT pm.observer
    JOIN org_memberships m ON m.user_id = pm.user_id AND m.active AND m.role IN ('firm_admin', 'consultant')
    JOIN "user" u ON u.id = pm.user_id
    LEFT JOIN client_assignments ca ON ca.client_org_id = p.org_id AND ca.user_id = pm.user_id
  WHERE app_org_kind() = 'client' AND p.kind = 'client' AND p.org_id = app_org() AND app_can_see_project(p.id)
$$;
--> statement-breakpoint
-- 2. Support requests. At most five a day per person (lib/help.ts).
CREATE FUNCTION app_support_per_day() RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$ SELECT 5 $$;
--> statement-breakpoint
-- A client person (any client role, also while an archived client is in its
-- grace period: a problem with the export pack is still a problem) reports
-- one. It reaches the active admins of the firm that serves the client, in
-- Selah and by mail; neither carries the text, which is read in Selah.
CREATE FUNCTION app_report_problem(p_body text) RETURNS uuid
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
    SELECT u.email, 'support.requested', '/notifications#support' FROM org_memberships m JOIN "user" u ON u.id = m.user_id
    WHERE m.org_id = firm AND m.active AND m.role = 'firm_admin' AND app_can_reset_password(m.user_id);
  RETURN row_id;
END $$;
--> statement-breakpoint
-- A firm admin marks one handled; the person who reported it is told in Selah.
CREATE FUNCTION app_handle_support_request(rid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r support_requests;
BEGIN
  SELECT * INTO r FROM support_requests WHERE id = rid;
  IF r.id IS NULL OR app_role() IS DISTINCT FROM 'firm_admin' OR r.firm_org_id IS DISTINCT FROM app_org() THEN
    RAISE EXCEPTION 'no such request' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF r.handled_at IS NOT NULL THEN
    RAISE EXCEPTION 'this request was already handled' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE support_requests SET handled_at = now(), handled_by = app_uid() WHERE id = rid;
  INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES (r.user_id, 'support.handled', 'support_request', rid);
END $$;
--> statement-breakpoint
ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON support_requests TO selah_app;
--> statement-breakpoint
-- The person reads their own; the firm's admins read every one sent to their firm.
CREATE POLICY support_read ON support_requests FOR SELECT TO selah_app
  USING (user_id = app_uid() OR (app_role() = 'firm_admin' AND firm_org_id = app_org()));
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_my_consultants(), app_support_per_day(), app_report_problem(text), app_handle_support_request(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_my_consultants(), app_support_per_day(), app_report_problem(text), app_handle_support_request(uuid) TO selah_app;
--> statement-breakpoint
-- The mail to the firm's admins is work mail: it waits for their sending hours.
ALTER TABLE outbound_emails DROP CONSTRAINT outbound_kind;
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_kind CHECK (kind IN (
  'invitation', 'email_change.confirm', 'email_change.notice', 'access_review.due',
  'meeting.invite', 'meeting.cancel', 'password_reset', 'password_reset.notice', 'two_factor.reset',
  'inquiry.new', 'inquiry.received', 'inquiry.declined', 'action.assigned', 'action.revision_requested',
  'action.verified_complete', 'evidence.requested', 'action.commented', 'action.mentioned', 'follow_up.digest', 'client.archived',
  'pulse.requested', 'sign_in_link', 'info_request.upload_link', 'support.requested'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_work_mail_kinds() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT app_update_mail_kinds() || ARRAY['follow_up.digest', 'access_review.due', 'inquiry.new', 'pulse.requested', 'support.requested']
$$;