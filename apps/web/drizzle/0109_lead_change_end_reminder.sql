CREATE TABLE "client_lead_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_org_id" uuid NOT NULL,
	"firm_org_id" uuid NOT NULL,
	"from_user_id" uuid,
	"to_user_id" uuid,
	"changed_by" uuid,
	"handover_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_lead_change_note" CHECK ("client_lead_changes"."handover_note" IS NULL OR char_length("client_lead_changes"."handover_note") BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE TABLE "engagement_reminders" (
	"engagement_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ends_on" date NOT NULL,
	"recipients" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagement_reminders_engagement_id_kind_ends_on_pk" PRIMARY KEY("engagement_id","kind","ends_on"),
	CONSTRAINT "engagement_reminder_kind" CHECK ("engagement_reminders"."kind" IN ('ending', 'ended'))
);
--> statement-breakpoint
ALTER TABLE "client_lead_changes" ADD CONSTRAINT "client_lead_changes_client_org_id_organizations_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_lead_changes" ADD CONSTRAINT "client_lead_changes_firm_org_id_organizations_id_fk" FOREIGN KEY ("firm_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_lead_changes" ADD CONSTRAINT "client_lead_changes_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_lead_changes" ADD CONSTRAINT "client_lead_changes_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_lead_changes" ADD CONSTRAINT "client_lead_changes_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_reminders" ADD CONSTRAINT "engagement_reminders_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_lead_changes_client_idx" ON "client_lead_changes" USING btree ("client_org_id","created_at");--> statement-breakpoint
-- ------------------------------------------------ a change of lead (Gate B, item 6.2)
-- 1. The record of each change, with the handover note the person making it
--    may write for the new lead. Firm only: the firm admin, the person who
--    led before, the one who leads now, and the client's current lead and
--    deputy read it; the client never does. Written by the firm admin
--    (setLead) and by the departure handover (app_hand_over, below); never
--    changed or removed through the app.
ALTER TABLE client_lead_changes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON client_lead_changes TO selah_app;
--> statement-breakpoint
CREATE POLICY lead_change_read ON client_lead_changes FOR SELECT TO selah_app USING (
  app_org_kind() = 'firm' AND firm_org_id = app_org() AND (
    (app_role() = 'firm_admin' AND app_can_see_org(client_org_id))
    OR app_uid() = from_user_id
    OR app_uid() = to_user_id
    OR app_is_client_lead(client_org_id)
  )
);
--> statement-breakpoint
-- Only the firm admin records one, for a lead that is the client's lead now,
-- from someone of the same firm, in their own name.
CREATE POLICY lead_change_insert ON client_lead_changes FOR INSERT TO selah_app WITH CHECK (
  app_role() = 'firm_admin' AND firm_org_id = app_org() AND app_can_see_org(client_org_id)
  AND changed_by = app_uid()
  AND (from_user_id IS NULL OR app_user_org(from_user_id) = app_org())
  AND EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = client_lead_changes.client_org_id AND ca.user_id = client_lead_changes.to_user_id AND ca.is_lead)
);
--> statement-breakpoint
-- 2. Telling people. The client's active admins read who their new lead
--    consultant is (client.lead_changed); the person who led before reads
--    that the client was handed to the new lead (client.handed_over). Nothing
--    else: no reason, nothing about anyone's work. The new lead is told by
--    setLead (client.lead, as before). Mail by each reader's choice for
--    updates: right away (work mail, so it waits for their sending hours), in
--    their daily or weekly summary (app_queue_digests below), or not at all.
--    The mail is a line and a link; the name is read in Selah.
CREATE FUNCTION tell_lead_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.to_user_id IS NULL OR NEW.from_user_id IS NOT DISTINCT FROM NEW.to_user_id THEN
    RETURN NULL;
  END IF;
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT m.user_id, 'client.lead_changed', 'lead_change', NEW.id
    FROM org_memberships m
    WHERE m.org_id = NEW.client_org_id AND m.role = 'client_admin' AND m.active
    UNION
    SELECT m.user_id, 'client.handed_over', 'lead_change', NEW.id
    FROM org_memberships m
    WHERE m.user_id = NEW.from_user_id AND m.org_id = NEW.firm_org_id AND m.active;
  -- Right away for those who want updates so (the notice's insert trigger
  -- clears mailed_at, so it is set here); the rest wait for the summary.
  WITH now_mail AS (
    UPDATE notifications x SET mailed_at = now()
    WHERE x.entity_type = 'lead_change' AND x.entity_id = NEW.id AND x.mailed_at IS NULL
      AND app_can_reset_password(x.user_id)
      AND (SELECT c.updates FROM app_mail_choice(x.user_id) c) = 'instant'
    RETURNING x.user_id, x.kind
  )
  INSERT INTO outbound_emails (to_email, kind, link)
    SELECT u.email, t.kind, CASE t.kind WHEN 'client.lead_changed' THEN '/help' ELSE '/clients/' || NEW.client_org_id END
    FROM now_mail t JOIN "user" u ON u.id = t.user_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tell_lead_change() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER tell_lead_change AFTER INSERT ON client_lead_changes FOR EACH ROW EXECUTE FUNCTION tell_lead_change();
--> statement-breakpoint
-- 3. What a notice about a change says, for its own reader only: the client's
--    name and the new lead's name. Nothing from the note.
CREATE FUNCTION app_lead_change_notices(ids uuid[])
RETURNS TABLE (id uuid, client_org_id uuid, client_name text, client_name_ar text, lead_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.client_org_id, o.name, o.name_ar, u.name
  FROM client_lead_changes c
  JOIN organizations o ON o.id = c.client_org_id
  LEFT JOIN "user" u ON u.id = c.to_user_id
  WHERE c.id = ANY (ids)
    AND EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = app_uid() AND n.entity_type = 'lead_change' AND n.entity_id = c.id)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_lead_change_notices(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_lead_change_notices(uuid[]) TO selah_app;
--> statement-breakpoint
-- 4. The departure handover records the change too. Latest definition:
--    0034_observers; only the client_lead block gains the insert.
CREATE OR REPLACE FUNCTION app_hand_over(from_uid uuid, to_uid uuid, kinds text[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  org uuid;
  moved integer := 0;
  k integer;
  counts jsonb := '{}'::jsonb;
  r record;
BEGIN
  IF NOT app_can_manage_person(from_uid) THEN
    RAISE EXCEPTION 'not visible' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF from_uid = to_uid THEN
    RAISE EXCEPTION 'hand over to someone else' USING ERRCODE = 'check_violation';
  END IF;
  SELECT m.org_id INTO org FROM org_memberships m WHERE m.user_id = from_uid;
  IF NOT EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = to_uid AND m.org_id = org AND m.active) THEN
    RAISE EXCEPTION 'hand over to an active member of the same organisation' USING ERRCODE = 'check_violation';
  END IF;
  IF kinds <@ ARRAY['action', 'client_lead', 'project_lead', 'review', 'client_role'] IS NOT TRUE THEN
    RAISE EXCEPTION 'unknown kind of work' USING ERRCODE = 'check_violation';
  END IF;

  IF 'action' = ANY (kinds) THEN
    INSERT INTO project_members (project_id, user_id, added_by)
      SELECT DISTINCT h.project_id, to_uid, app_uid() FROM app_person_holdings_of(from_uid) h WHERE h.kind = 'action'
      ON CONFLICT DO NOTHING;
    WITH handed AS (
      UPDATE actions a SET owner_user_id = to_uid
        FROM app_person_holdings_of(from_uid) h WHERE h.kind = 'action' AND a.id = h.entity_id
        RETURNING a.id, a.status
    ), told AS (
      -- released work tells its new owner (and mails them, by their choices)
      INSERT INTO notifications (user_id, kind, entity_type, entity_id)
        SELECT to_uid, 'action.assigned', 'action', x.id FROM handed x WHERE app_action_open(x.status)
        RETURNING 1
    )
    SELECT count(*) INTO k FROM handed;
    moved := moved + k;
    counts := counts || jsonb_build_object('action', k);
  END IF;

  -- before the leads move: a new lead would no longer see these as sole reviews
  IF 'review' = ANY (kinds) THEN
    INSERT INTO project_members (project_id, user_id, added_by)
      SELECT DISTINCT h.project_id, to_uid, app_uid() FROM app_person_holdings_of(from_uid) h WHERE h.kind = 'review'
      ON CONFLICT (project_id, user_id) DO UPDATE SET observer = false;
    GET DIAGNOSTICS k = ROW_COUNT;
    moved := moved + k;
    counts := counts || jsonb_build_object('review', k);
  END IF;

  IF 'client_lead' = ANY (kinds) THEN
    k := 0;
    FOR r IN SELECT h.entity_id FROM app_person_holdings_of(from_uid) h WHERE h.kind = 'client_lead' LOOP
      UPDATE client_assignments SET is_lead = false WHERE client_org_id = r.entity_id AND user_id = from_uid;
      INSERT INTO client_assignments (client_org_id, user_id, is_lead, assigned_by) VALUES (r.entity_id, to_uid, true, app_uid())
        ON CONFLICT (client_org_id, user_id) DO UPDATE SET is_lead = true;
      -- Recorded as a change of lead, which tells the client's admins and the person leaving (0109).
      INSERT INTO client_lead_changes (client_org_id, firm_org_id, from_user_id, to_user_id, changed_by)
        VALUES (r.entity_id, org, from_uid, to_uid, app_uid());
      k := k + 1;
    END LOOP;
    moved := moved + k;
    counts := counts || jsonb_build_object('client_lead', k);
  END IF;

  IF 'project_lead' = ANY (kinds) THEN
    k := 0;
    FOR r IN SELECT h.entity_id FROM app_person_holdings_of(from_uid) h WHERE h.kind = 'project_lead' LOOP
      UPDATE project_members SET is_lead = false WHERE project_id = r.entity_id AND user_id = from_uid;
      INSERT INTO project_members (project_id, user_id, is_lead, added_by) VALUES (r.entity_id, to_uid, true, app_uid())
        ON CONFLICT (project_id, user_id) DO UPDATE SET is_lead = true, observer = false;
      k := k + 1;
    END LOOP;
    moved := moved + k;
    counts := counts || jsonb_build_object('project_lead', k);
  END IF;

  IF 'client_role' = ANY (kinds) THEN
    k := 0;
    FOR r IN SELECT x.* FROM project_client_roles x JOIN app_person_holdings_of(from_uid) h ON h.kind = 'client_role' AND h.entity_id = x.id LOOP
      DELETE FROM project_client_roles WHERE id = r.id;
      IF NOT EXISTS (SELECT 1 FROM project_client_roles x WHERE x.project_id = r.project_id AND x.role = r.role AND x.user_id = to_uid) THEN
        INSERT INTO project_client_roles (project_id, org_id, role, user_id, created_by) VALUES (r.project_id, r.org_id, r.role, to_uid, app_uid());
      END IF;
      k := k + 1;
    END LOOP;
    moved := moved + k;
    counts := counts || jsonb_build_object('client_role', k);
  END IF;

  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
    VALUES (app_uid(), org, 'membership.hand_over', 'user', from_uid, 'allow', counts || jsonb_build_object('to', to_uid));
  RETURN moved;
END $$;
--> statement-breakpoint
-- ------------------------------------------------ an engagement about to end (Gate B, item 6.1)
-- 5. The daily job tells the client's lead and deputy and the firm's admins,
--    once, when an open engagement is 30 days or less from its end date
--    (engagement.ending), and once more when the end date has passed and it
--    is still open (engagement.ended). Open: a project it covers is not
--    closed, or it covers none yet. Only active clients. Never anyone at the
--    client. A new end date sends them again (ends_on is part of the key).
--    Only the job reads or writes the log.
ALTER TABLE engagement_reminders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION app_engagement_reminder_days() RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$ SELECT 30 $$;
--> statement-breakpoint
CREATE FUNCTION app_engagement_open(eid uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM projects p WHERE p.engagement_id = eid)
    OR EXISTS (SELECT 1 FROM projects p WHERE p.engagement_id = eid AND p.state <> 'closed')
$$;
--> statement-breakpoint
-- Firm people only: the client's lead and deputy and the firm's admins, each active.
CREATE FUNCTION app_engagement_reminder_audience(eid uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT ca.user_id FROM engagements g
    JOIN client_assignments ca ON ca.client_org_id = g.client_org_id AND (ca.is_lead OR ca.is_deputy)
    JOIN org_memberships m ON m.user_id = ca.user_id AND m.org_id = g.firm_org_id AND m.active
  WHERE g.id = eid
  UNION
  SELECT m.user_id FROM engagements g
    JOIN org_memberships m ON m.org_id = g.firm_org_id AND m.role = 'firm_admin' AND m.active
  WHERE g.id = eid
$$;
--> statement-breakpoint
CREATE FUNCTION app_remind_engagements(today date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF app_uid() IS NOT NULL THEN
    RAISE EXCEPTION 'reminders are sent by the daily job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  WITH due AS (
    SELECT g.id, g.ends_on, CASE WHEN g.ends_on < today THEN 'ended' ELSE 'ending' END AS kind,
      ARRAY(SELECT app_engagement_reminder_audience(g.id)) AS recipients
    FROM engagements g JOIN organizations o ON o.id = g.client_org_id AND o.status = 'active'
    WHERE g.ends_on IS NOT NULL AND today >= g.ends_on - app_engagement_reminder_days()
      AND app_engagement_open(g.id)
  ),
  logged AS (
    INSERT INTO engagement_reminders (engagement_id, kind, ends_on, recipients)
      SELECT d.id, d.kind, d.ends_on, d.recipients FROM due d WHERE cardinality(d.recipients) > 0
      ON CONFLICT DO NOTHING
      RETURNING engagement_id, kind, recipients
  ),
  sent AS (
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT r, 'engagement.' || l.kind, 'engagement', l.engagement_id FROM logged l, unnest(l.recipients) r
      RETURNING 1
  )
  SELECT count(*) INTO n FROM sent;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_engagement_reminder_days(), app_engagement_open(uuid), app_engagement_reminder_audience(uuid),
  app_remind_engagements(date) FROM PUBLIC;
--> statement-breakpoint
-- ------------------------------------------------ mail
-- 6. The summary mail (latest: 0092_deliverable_receipts, every line of it
--    kept), now with the engagement reminders by the reader's reminders
--    cadence, and the change-of-lead notices by their updates cadence when
--    that is a summary (right away is mailed by tell_lead_change).
CREATE OR REPLACE FUNCTION app_queue_digests(today date) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  WITH due AS (
    SELECT x.id FROM notifications x
    CROSS JOIN LATERAL app_mail_choice(x.user_id) c
    WHERE x.mailed_at IS NULL AND x.read_at IS NULL
      AND x.created_at > now() - interval '8 days'
      AND CASE
        WHEN x.entity_type = 'action' AND x.kind LIKE 'follow_up.%' THEN app_cadence_due(c.reminders, today)
        -- information requests waiting on the client (migration 0017), one per project
        WHEN x.entity_type = 'project' AND x.kind IN ('info_request.due_soon', 'info_request.overdue') THEN app_cadence_due(c.reminders, today)
        -- a client quiet for two weeks (F18)
        WHEN x.entity_type = 'project' AND x.kind = 'project.client_quiet' THEN app_cadence_due(c.reminders, today)
        WHEN x.entity_type = 'project' AND x.kind = 'report.pack_drafted' THEN app_cadence_due(c.reminders, today)
        -- an indicator whose latest value moved away (0090)
        WHEN x.entity_type = 'kpi_value' AND x.kind = 'indicator.moved_away' THEN app_cadence_due(c.reminders, today)
        -- a deliverable handed over and still waiting after ten working days (F21, 0092)
        WHEN x.entity_type = 'deliverable' AND x.kind = 'deliverable.reminder' THEN app_cadence_due(c.reminders, today)
        -- an engagement about to end, or past its end and still open (0109)
        WHEN x.entity_type = 'engagement' AND x.kind IN ('engagement.ending', 'engagement.ended') THEN app_cadence_due(c.reminders, today)
        -- a change of the client's lead consultant, for a reader who batches updates (0109)
        WHEN x.entity_type = 'lead_change' AND x.kind IN ('client.lead_changed', 'client.handed_over') THEN c.updates <> 'instant' AND app_cadence_due(c.updates, today)
        WHEN x.entity_type = 'action' AND x.kind = ANY (app_update_mail_kinds()) THEN c.updates <> 'instant' AND app_cadence_due(c.updates, today)
        ELSE false
      END
      AND NOT EXISTS (SELECT 1 FROM mail_mutes m WHERE m.user_id = x.user_id AND m.action_id = x.entity_id)
      AND NOT (x.entity_type = 'kpi_value' AND EXISTS (
        SELECT 1 FROM client_kpi_values v JOIN mail_kpi_mutes km ON km.kpi_id = v.kpi_id
        WHERE v.id = x.entity_id AND km.user_id = x.user_id))
      AND NOT (x.entity_type = 'kpi_value' AND NOT EXISTS (
        SELECT 1 FROM client_kpi_values v CROSS JOIN LATERAL app_kpi_moved_away_audience(v.kpi_id) a
        WHERE v.id = x.entity_id AND a.user_id = x.user_id))
      -- Nor one whose figure a correction has since brought back.
      AND NOT (x.entity_type = 'kpi_value' AND app_kpi_notice_fixed(x.entity_id, x.created_at))
      -- A deliverable's reminder: its latest round still waits, and the reader still answers for it.
      AND NOT (x.entity_type = 'deliverable' AND NOT EXISTS (
        SELECT 1 FROM deliverable_handovers h
        WHERE h.deliverable_id = x.entity_id AND h.received_at IS NULL AND h.commented_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM deliverable_handovers l WHERE l.deliverable_id = h.deliverable_id AND l.round > h.round)
          AND app_deliverable_receiver_ok(h.deliverable_id, x.user_id, h.version_ids)))
      -- Never a notice its reader may not see (D6): about a draft, or written before its release.
      AND NOT (x.entity_type = 'action' AND app_action_notice_hidden(x.user_id, x.entity_id, x.created_at))
      -- Nor one about an action an owner does not own (1b).
      AND NOT (x.entity_type = 'action' AND NOT app_action_owner_ok(x.user_id, x.entity_id))
    FOR UPDATE OF x SKIP LOCKED
  ),
  marked AS (
    UPDATE notifications x SET mailed_at = now() FROM due WHERE x.id = due.id RETURNING x.user_id
  ),
  mailed AS (
    INSERT INTO outbound_emails (to_email, kind, link)
    SELECT u.email, 'follow_up.digest', '/notifications'
    FROM (SELECT DISTINCT user_id FROM marked) m
    JOIN "user" u ON u.id = m.user_id
    WHERE app_can_reset_password(m.user_id)
      AND NOT EXISTS (
        SELECT 1 FROM outbound_emails o
        WHERE o.kind = 'follow_up.digest' AND lower(o.to_email) = lower(u.email) AND app_firm_date(o.created_at) = app_firm_today()
      )
    RETURNING 1
  )
  SELECT count(*) INTO n FROM mailed;
  RETURN n;
END $$;
--> statement-breakpoint
-- 7. The two new mails (latest list: 0095_audience_rules, every kind kept), both work mail
--    (latest: 0092_deliverable_receipts), so they wait for the reader's sending hours.
ALTER TABLE outbound_emails DROP CONSTRAINT outbound_kind;
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_kind CHECK (kind IN (
  'invitation', 'email_change.confirm', 'email_change.notice', 'access_review.due',
  'meeting.invite', 'meeting.cancel', 'meeting.removed', 'password_reset', 'password_reset.notice', 'two_factor.reset',
  'inquiry.new', 'inquiry.received', 'inquiry.declined', 'action.assigned', 'action.revision_requested',
  'action.verified_complete', 'evidence.requested', 'action.commented', 'action.mentioned', 'follow_up.digest', 'client.archived',
  'pulse.requested', 'sign_in_link', 'info_request.upload_link', 'support.requested',
  'org_chart.holder_changed', 'org_chart.change_requested',
  'deliverable.handed_over', 'deliverable.commented',
  'client.lead_changed', 'client.handed_over'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_work_mail_kinds() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT app_update_mail_kinds() || ARRAY['follow_up.digest', 'access_review.due', 'inquiry.new', 'pulse.requested', 'support.requested',
    'org_chart.holder_changed', 'org_chart.change_requested', 'deliverable.handed_over', 'deliverable.commented',
    'client.lead_changed', 'client.handed_over']
$$;
