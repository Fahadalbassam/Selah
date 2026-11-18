CREATE TABLE "deliverable_handovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"version_ids" uuid[] NOT NULL,
	"delivered_by" uuid NOT NULL,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" uuid,
	"received_at" timestamp with time zone,
	"receipt_source" "record_source",
	"received_by_name" text,
	"received_via" "received_via",
	"received_on" date,
	"comment" text,
	"commented_by" uuid,
	"commented_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	CONSTRAINT "deliverable_handover_round" CHECK ("deliverable_handovers"."round" >= 1),
	CONSTRAINT "deliverable_handover_versions" CHECK (cardinality("deliverable_handovers"."version_ids") BETWEEN 1 AND 20),
	CONSTRAINT "deliverable_handover_receipt" CHECK (("deliverable_handovers"."received_at" IS NULL AND "deliverable_handovers"."received_by" IS NULL AND "deliverable_handovers"."receipt_source" IS NULL AND "deliverable_handovers"."received_by_name" IS NULL AND "deliverable_handovers"."received_via" IS NULL AND "deliverable_handovers"."received_on" IS NULL)
        OR ("deliverable_handovers"."received_at" IS NOT NULL AND "deliverable_handovers"."received_by" IS NOT NULL AND "deliverable_handovers"."receipt_source" = 'client_portal'
            AND "deliverable_handovers"."received_by_name" IS NULL AND "deliverable_handovers"."received_via" IS NULL AND "deliverable_handovers"."received_on" IS NULL)
        OR ("deliverable_handovers"."received_at" IS NOT NULL AND "deliverable_handovers"."received_by" IS NOT NULL AND "deliverable_handovers"."receipt_source" = 'consultant_recorded'
            AND char_length(btrim("deliverable_handovers"."received_by_name")) BETWEEN 2 AND 200 AND "deliverable_handovers"."received_via" IS NOT NULL AND "deliverable_handovers"."received_on" IS NOT NULL)),
	CONSTRAINT "deliverable_handover_comment" CHECK (("deliverable_handovers"."comment" IS NULL AND "deliverable_handovers"."commented_by" IS NULL AND "deliverable_handovers"."commented_at" IS NULL)
        OR (char_length(btrim("deliverable_handovers"."comment")) BETWEEN 3 AND 2000 AND "deliverable_handovers"."commented_by" IS NOT NULL AND "deliverable_handovers"."commented_at" IS NOT NULL)),
	CONSTRAINT "deliverable_handover_one_answer" CHECK ("deliverable_handovers"."received_at" IS NULL OR "deliverable_handovers"."commented_at" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "deliverable_handovers" ADD CONSTRAINT "deliverable_handovers_deliverable_id_engagement_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."engagement_deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_handovers" ADD CONSTRAINT "deliverable_handovers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_handovers" ADD CONSTRAINT "deliverable_handovers_delivered_by_user_id_fk" FOREIGN KEY ("delivered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_handovers" ADD CONSTRAINT "deliverable_handovers_received_by_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_handovers" ADD CONSTRAINT "deliverable_handovers_commented_by_user_id_fk" FOREIGN KEY ("commented_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliverable_handovers_round" ON "deliverable_handovers" USING btree ("deliverable_id","round");--> statement-breakpoint
CREATE INDEX "deliverable_handovers_org_idx" ON "deliverable_handovers" USING btree ("org_id");
--> statement-breakpoint
-- ------------------------------------------- deliverable receipts (F21, minimal)
-- Decided 17 Nov 2026 (gate A follow-ups, 4a): the partner firm's process
-- starts the follow-up when the consultant hands the documents over and the
-- client signs that it received them. An engagement's deliverables had a
-- title, acceptance criteria and a due date, and deliverable files had
-- versions, but nothing recorded the hand-over or the receipt.
--
--   * The client's lead, deputy, or a consultant staffed (not as an observer)
--     on one of its projects that is not closed hands a deliverable over with
--     the exact file versions (documents ids), each a deliverable file of that
--     client shared with it. Each hand-over is a round; a new version is a new
--     round, and every round is kept.
--   * The client's acceptors on the projects the deliverable relates to (else
--     its admins, else its sponsor) are told once. Any of them who opens every
--     file confirms receipt or comments, once per round, on the latest round.
--     The client's lead and deputy hear a comment.
--   * For a client the firm runs (no accounts) the consultant records who at
--     the client received it, how and on which day.
--   * A round still waiting after ten Saudi working days gets one reminder,
--     through the summary mail.
--   * "Received" is receipt only: nothing here accepts or judges the work.
--
-- Rows are read through the functions below; nobody writes the table
-- directly (like the export pack's receipt, 0033).

-- 1. Helpers.

-- The client a deliverable is for, through its engagement.
CREATE FUNCTION app_deliverable_client(did uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT g.client_org_id FROM engagement_deliverables d JOIN engagements g ON g.id = d.engagement_id WHERE d.id = did
$$;
--> statement-breakpoint
-- The projects a deliverable relates to: its own, or every project its engagement covers.
CREATE FUNCTION app_deliverable_projects(did uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id FROM engagement_deliverables d JOIN projects p ON p.engagement_id = d.engagement_id
  WHERE d.id = did AND (d.project_id IS NULL OR p.id = d.project_id)
$$;
--> statement-breakpoint
-- Whether a person at the client opens a file: shared with the client, live,
-- on a project of theirs that is past draft, and outside departments, in one
-- of theirs, uploaded by them or shared with them one by one (the documents
-- policies, asked for another person).
CREATE FUNCTION app_user_opens_document(target uuid, doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM documents d
    JOIN projects p ON p.id = d.project_id
    JOIN organizations o ON o.id = d.org_id
    JOIN org_memberships m ON m.user_id = target AND m.active AND m.org_id = d.org_id
    WHERE d.id = doc AND d.visibility = 'shared' AND d.state <> 'archived' AND d.withdrawn_at IS NULL
      AND p.kind = 'client' AND p.state::text <> 'draft' AND app_user_sees_project(target, d.project_id)
      AND (d.department_id IS NULL OR NOT o.departments_enabled OR m.role = 'client_admin' OR d.uploaded_by = target
           OR EXISTS (SELECT 1 FROM department_members dm WHERE dm.department_id = d.department_id AND dm.user_id = target)
           OR EXISTS (SELECT 1 FROM document_shares s WHERE s.document_id = doc AND s.user_id = target))
  )
$$;
--> statement-breakpoint
-- Whether a person answers for the client on a deliverable (confirms receipt
-- or comments): an active admin of the client, or an active admin or manager
-- who is an acceptor or the sponsor on a project it relates to; and in every
-- case someone who opens every file handed over. Action owners never do.
CREATE FUNCTION app_deliverable_receiver_ok(did uuid, target uuid, versions uuid[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_memberships m
    WHERE m.user_id = target AND m.active AND m.org_id = app_deliverable_client(did)
      AND m.role IN ('client_admin', 'client_manager')
      AND (m.role = 'client_admin' OR EXISTS (
        SELECT 1 FROM project_client_roles r
        WHERE r.user_id = target AND r.role IN ('acceptor', 'sponsor') AND r.project_id IN (SELECT app_deliverable_projects(did))))
  ) AND NOT EXISTS (SELECT 1 FROM unnest(versions) v WHERE NOT app_user_opens_document(target, v))
$$;
--> statement-breakpoint
-- Who is asked to confirm: the acceptors on the projects it relates to, else
-- the client's admins, else its sponsor; in each, only people who may answer
-- (above). Empty for a client the firm runs, which has no accounts.
CREATE FUNCTION app_deliverable_receivers(did uuid, versions uuid[]) RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH people AS (
    SELECT r.user_id AS uid, CASE r.role WHEN 'acceptor' THEN 1 ELSE 3 END AS tier
      FROM project_client_roles r
      WHERE r.user_id IS NOT NULL AND r.role IN ('acceptor', 'sponsor') AND r.project_id IN (SELECT app_deliverable_projects(did))
    UNION
    SELECT m.user_id, 2 FROM org_memberships m WHERE m.org_id = app_deliverable_client(did) AND m.active AND m.role = 'client_admin'
  ),
  able AS (SELECT uid, tier FROM people WHERE app_deliverable_receiver_ok(did, uid, versions))
  SELECT DISTINCT uid FROM able WHERE tier = (SELECT min(tier) FROM able)
$$;
--> statement-breakpoint
-- Who reads a hand-over: the firm on that client (the engagement's readers:
-- the firm admin and the client's consultants), and at the client only the
-- people who may answer for it, so never anyone who cannot open its files.
CREATE FUNCTION app_can_read_handover(did uuid, versions uuid[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE app_org_kind()
    WHEN 'firm' THEN coalesce((SELECT app_can_see_engagement(d.engagement_id) FROM engagement_deliverables d WHERE d.id = did), false)
    WHEN 'client' THEN app_deliverable_receiver_ok(did, app_uid(), versions)
    ELSE false
  END
$$;
--> statement-breakpoint
-- A person asked to answer for the client reads that deliverable (its title,
-- how it is accepted and its due date), as the client's admin always did.
CREATE FUNCTION app_answers_for_deliverable(did uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_org_kind() = 'client' AND EXISTS (
    SELECT 1 FROM deliverable_handovers h WHERE h.deliverable_id = did AND app_deliverable_receiver_ok(did, app_uid(), h.version_ids))
$$;
--> statement-breakpoint
-- The client and the firm of the deliverables the caller reads (the same
-- rule as their row-level security below): a person asked to answer for a
-- hand-over does not read its engagement, which only the client's admin does.
CREATE FUNCTION app_deliverable_parties(dids uuid[]) RETURNS TABLE (deliverable_id uuid, client_org_id uuid, firm_org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT d.id, g.client_org_id, g.firm_org_id
  FROM engagement_deliverables d JOIN engagements g ON g.id = d.engagement_id
  WHERE d.id = ANY (dids) AND (app_can_see_engagement(d.engagement_id) OR app_answers_for_deliverable(d.id))
$$;
--> statement-breakpoint
-- Working days after one day up to and including another, in the Saudi week:
-- Sunday to Thursday. Friday and Saturday are off, as the mail rules hold them
-- (app_mail_send_time: never on Friday, Saturday only when asked).
CREATE FUNCTION app_working_days(from_day date, to_day date) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT count(*)::integer FROM generate_series(from_day + 1, to_day, interval '1 day') g WHERE extract(dow FROM g) NOT IN (5, 6)
$$;
--> statement-breakpoint
-- The working days a hand-over waits before its one reminder (lib/deliverables.ts DELIVERABLE_REMINDER_WORKING_DAYS).
CREATE FUNCTION app_deliverable_reminder_days() RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$ SELECT 10 $$;
--> statement-breakpoint
-- 2. The rows: read through the functions above, written only below.
ALTER TABLE deliverable_handovers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON deliverable_handovers TO selah_app;
--> statement-breakpoint
CREATE POLICY handover_read ON deliverable_handovers FOR SELECT TO selah_app USING (app_can_read_handover(deliverable_id, version_ids));
--> statement-breakpoint
-- The deliverables themselves (latest: 0008): the engagement's readers, and
-- the people asked to answer for a hand-over of it.
DROP POLICY deliverable_read ON engagement_deliverables;
--> statement-breakpoint
CREATE POLICY deliverable_read ON engagement_deliverables FOR SELECT TO selah_app
  USING (app_can_see_engagement(engagement_id) OR app_answers_for_deliverable(id));
--> statement-breakpoint
-- A round keeps its files, who handed it over and when; it is answered once
-- (by the functions below), and marked reminded once, by the daily job. It is
-- kept with its deliverable: a deliverable that was handed over can no longer
-- be removed (only the purge job and a discarded prospect delete rounds).
CREATE FUNCTION check_deliverable_handover() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF app_uid() IS NOT NULL AND current_setting('selah.discard', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'a deliverable that was handed over stays on record' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.org_id := app_deliverable_client(NEW.deliverable_id);
    IF NEW.org_id IS NULL OR NEW.received_at IS NOT NULL OR NEW.commented_at IS NOT NULL OR NEW.reminded_at IS NOT NULL THEN
      RAISE EXCEPTION 'a new hand-over is not answered yet' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.deliverable_id, NEW.org_id, NEW.round, NEW.version_ids, NEW.delivered_by, NEW.delivered_at)
     IS DISTINCT FROM (OLD.id, OLD.deliverable_id, OLD.org_id, OLD.round, OLD.version_ids, OLD.delivered_by, OLD.delivered_at) THEN
    RAISE EXCEPTION 'a hand-over keeps its files, who made it and when; hand over a new version instead' USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.received_at IS NOT NULL OR OLD.commented_at IS NOT NULL)
     AND (to_jsonb(NEW) - 'reminded_at') IS DISTINCT FROM (to_jsonb(OLD) - 'reminded_at') THEN
    RAISE EXCEPTION 'this round was already answered' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reminded_at IS DISTINCT FROM OLD.reminded_at AND (OLD.reminded_at IS NOT NULL OR app_uid() IS NOT NULL) THEN
    RAISE EXCEPTION 'the reminder is sent once, by the daily job' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_deliverable_handover() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER deliverable_handover_rules BEFORE INSERT OR UPDATE OR DELETE ON deliverable_handovers
  FOR EACH ROW EXECUTE FUNCTION check_deliverable_handover();
--> statement-breakpoint
-- An archived client's hand-overs freeze with its other client-level records
-- (lib/offboarding.ts CLIENT_FROZEN_TABLES).
CREATE TRIGGER client_open BEFORE INSERT OR UPDATE OR DELETE ON deliverable_handovers FOR EACH ROW EXECUTE FUNCTION check_client_open();
--> statement-breakpoint
-- 3. The latest round of a deliverable, if the caller saw that one and it
--    still waits for an answer, on a project that is not closed.
CREATE FUNCTION app_open_handover(did uuid, p_round integer) RETURNS deliverable_handovers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE h deliverable_handovers;
BEGIN
  SELECT * INTO h FROM deliverable_handovers WHERE deliverable_id = did ORDER BY round DESC LIMIT 1 FOR UPDATE;
  IF h.id IS NULL THEN
    RAISE EXCEPTION 'this deliverable has not been handed over' USING ERRCODE = 'check_violation';
  END IF;
  IF h.round IS DISTINCT FROM p_round THEN
    RAISE EXCEPTION 'a newer version was handed over since; look at it again' USING ERRCODE = 'check_violation';
  END IF;
  IF h.received_at IS NOT NULL OR h.commented_at IS NOT NULL THEN
    RAISE EXCEPTION 'this round was already answered' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM engagement_deliverables d JOIN projects p ON p.id = d.project_id WHERE d.id = did AND p.state = 'closed') THEN
    RAISE EXCEPTION 'a closed project''s deliverables stay as they are' USING ERRCODE = 'check_violation';
  END IF;
  RETURN h;
END $$;
--> statement-breakpoint
-- Who hands a deliverable over for the firm (and records the receipt of a
-- client it runs): the client's lead or deputy, or a consultant staffed, not
-- as an observer, on a project of the deliverable's engagement that is not
-- closed. Staffing under another engagement of the same client does not count.
CREATE FUNCTION app_firm_hands_over(did uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_role() = 'consultant' AND EXISTS (
    SELECT 1 FROM engagement_deliverables d JOIN engagements g ON g.id = d.engagement_id
    WHERE d.id = did AND app_firm_works_with(g.client_org_id) AND (
      app_is_client_lead(g.client_org_id)
      OR EXISTS (
        SELECT 1 FROM project_members pm JOIN projects p ON p.id = pm.project_id
        WHERE pm.user_id = app_uid() AND NOT pm.observer AND p.engagement_id = g.id AND p.state <> 'closed')))
$$;
--> statement-breakpoint
-- 4. Hand a deliverable over: the files' exact versions, and the next round.
CREATE FUNCTION app_hand_over_deliverable(did uuid, versions uuid[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d engagement_deliverables;
  client uuid := app_deliverable_client(did);
  n integer := coalesce(cardinality(versions), 0);
  hid uuid;
BEGIN
  SELECT * INTO d FROM engagement_deliverables WHERE id = did;
  IF d.id IS NULL OR NOT app_firm_hands_over(did) THEN
    RAISE EXCEPTION 'the client''s lead, deputy or a consultant staffed on its projects hands a deliverable over' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF d.project_id IS NOT NULL AND (SELECT p.state FROM projects p WHERE p.id = d.project_id) = 'closed' THEN
    RAISE EXCEPTION 'a closed project''s deliverables stay as they are' USING ERRCODE = 'check_violation';
  END IF;
  IF n NOT BETWEEN 1 AND 20 OR (SELECT count(DISTINCT v) FROM unnest(versions) v) <> n THEN
    RAISE EXCEPTION 'hand over between 1 and 20 different files' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(versions) v
    WHERE NOT EXISTS (
      SELECT 1 FROM documents x JOIN projects p ON p.id = x.project_id
      WHERE x.id = v AND x.purpose = 'deliverable' AND x.org_id = client AND x.visibility = 'shared'
        AND x.state <> 'archived' AND x.withdrawn_at IS NULL AND x.scan_status IN ('clean', 'skipped')
        AND p.state::text <> 'draft' AND app_can_see_project(p.id))
  ) THEN
    RAISE EXCEPTION 'hand over this client''s deliverable files, shared with it and cleared by the scan' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(versions) v JOIN documents x ON x.id = v JOIN projects p ON p.id = x.project_id
    WHERE p.engagement_id IS DISTINCT FROM d.engagement_id
  ) THEN
    RAISE EXCEPTION 'hand over files of the engagement''s projects' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO deliverable_handovers (deliverable_id, org_id, round, version_ids, delivered_by)
    VALUES (did, client, coalesce((SELECT max(h.round) FROM deliverable_handovers h WHERE h.deliverable_id = did), 0) + 1, versions, app_uid())
    RETURNING id INTO hid;
  -- The client's receivers are told once, in Selah and by work mail (held for their sending hours).
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT r.user_id, 'deliverable.handed_over', 'deliverable', did FROM app_deliverable_receivers(did, versions) r;
  INSERT INTO outbound_emails (to_email, kind, link)
    SELECT u.email, 'deliverable.handed_over', '/' FROM app_deliverable_receivers(did, versions) r JOIN "user" u ON u.id = r.user_id
    WHERE app_can_reset_password(r.user_id);
  RETURN hid;
END $$;
--> statement-breakpoint
-- 4b. Before a hand-over, the firm sees who will be asked for these files
--     (the first group of app_deliverable_receivers, with its group: 1
--     acceptor, 2 admin, 3 sponsor) and which acceptors are skipped because
--     they cannot open every file. Only for someone who may hand it over.
CREATE FUNCTION app_hand_over_preview(did uuid, versions uuid[]) RETURNS TABLE (user_id uuid, tier integer, asked boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app_firm_hands_over(did) THEN
    RAISE EXCEPTION 'the client''s lead, deputy or a consultant staffed on its projects hands a deliverable over' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    WITH people AS (
      SELECT r.user_id AS uid, CASE r.role WHEN 'acceptor' THEN 1 ELSE 3 END AS t
        FROM project_client_roles r
        WHERE r.user_id IS NOT NULL AND r.role IN ('acceptor', 'sponsor') AND r.project_id IN (SELECT app_deliverable_projects(did))
          AND EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = r.user_id AND m.active AND m.role IN ('client_admin', 'client_manager'))
      UNION
      SELECT m.user_id, 2 FROM org_memberships m WHERE m.org_id = app_deliverable_client(did) AND m.active AND m.role = 'client_admin'
    ),
    graded AS (SELECT p.uid, p.t, app_deliverable_receiver_ok(did, p.uid, versions) AS able FROM people p),
    first AS (SELECT min(g.t) AS t FROM graded g WHERE g.able)
    SELECT g.uid, g.t, g.able AND g.t = (SELECT f.t FROM first f)
    FROM graded g
    WHERE (g.able AND g.t = (SELECT f.t FROM first f)) OR (g.t = 1 AND NOT g.able);
END $$;
--> statement-breakpoint
-- 5. The client confirms receipt: who, when, and the round's files as they were.
CREATE FUNCTION app_confirm_deliverable_receipt(did uuid, p_round integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE h deliverable_handovers;
BEGIN
  SELECT * INTO h FROM deliverable_handovers WHERE deliverable_id = did ORDER BY round DESC LIMIT 1;
  IF h.id IS NULL OR app_org_kind() IS DISTINCT FROM 'client' OR NOT app_deliverable_receiver_ok(did, app_uid(), h.version_ids) THEN
    RAISE EXCEPTION 'only the client''s acceptor, admin or sponsor confirms receiving a deliverable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  h := app_open_handover(did, p_round);
  UPDATE deliverable_handovers SET received_by = app_uid(), received_at = now(), receipt_source = 'client_portal' WHERE id = h.id;
END $$;
--> statement-breakpoint
-- 6. Or comments, with a required text; the client's lead and deputy hear it
--    (the firm's admins when the client has neither), in Selah and by work mail.
CREATE FUNCTION app_comment_on_deliverable(did uuid, p_round integer, p_comment text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  h deliverable_handovers;
  g engagements;
BEGIN
  SELECT * INTO h FROM deliverable_handovers WHERE deliverable_id = did ORDER BY round DESC LIMIT 1;
  IF h.id IS NULL OR app_org_kind() IS DISTINCT FROM 'client' OR NOT app_deliverable_receiver_ok(did, app_uid(), h.version_ids) THEN
    RAISE EXCEPTION 'only the client''s acceptor, admin or sponsor comments on a deliverable handed over' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF char_length(btrim(coalesce(p_comment, ''))) NOT BETWEEN 3 AND 2000 THEN
    RAISE EXCEPTION 'write the comment (3 to 2000 characters)' USING ERRCODE = 'check_violation';
  END IF;
  h := app_open_handover(did, p_round);
  UPDATE deliverable_handovers SET comment = btrim(p_comment), commented_by = app_uid(), commented_at = now() WHERE id = h.id;
  SELECT x.* INTO g FROM engagements x JOIN engagement_deliverables d ON d.engagement_id = x.id WHERE d.id = did;
  WITH leads AS (
    SELECT ca.user_id FROM client_assignments ca
    JOIN org_memberships m ON m.user_id = ca.user_id AND m.org_id = g.firm_org_id AND m.active
    WHERE ca.client_org_id = g.client_org_id AND (ca.is_lead OR ca.is_deputy)
  ),
  told AS (
    SELECT user_id FROM leads
    UNION
    SELECT m.user_id FROM org_memberships m
    WHERE m.org_id = g.firm_org_id AND m.active AND m.role = 'firm_admin' AND NOT EXISTS (SELECT 1 FROM leads)
  ),
  noticed AS (
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT t.user_id, 'deliverable.commented', 'deliverable', did FROM told t RETURNING user_id
  )
  INSERT INTO outbound_emails (to_email, kind, link)
    SELECT u.email, 'deliverable.commented', '/engagements/' || g.id FROM noticed n JOIN "user" u ON u.id = n.user_id
    WHERE app_can_reset_password(n.user_id);
END $$;
--> statement-breakpoint
-- 7. For a client the firm runs, the consultant records the receipt: who at
--    the client received it, how, and the day (not before the hand-over, not
--    in the future), like the progress the firm records for it.
CREATE FUNCTION app_record_deliverable_receipt(did uuid, p_round integer, p_name text, p_via received_via, p_on date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  h deliverable_handovers;
  client uuid := app_deliverable_client(did);
BEGIN
  IF client IS NULL OR NOT app_firm_hands_over(did) THEN
    RAISE EXCEPTION 'the client''s lead, deputy or a consultant staffed on its projects records the receipt' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT o.engagement_mode FROM organizations o WHERE o.id = client) IS DISTINCT FROM 'consultant_managed' THEN
    RAISE EXCEPTION 'the client confirms receipt itself in Selah; the firm records it only for a client it runs' USING ERRCODE = 'insufficient_privilege';
  END IF;
  h := app_open_handover(did, p_round);
  IF char_length(btrim(coalesce(p_name, ''))) NOT BETWEEN 2 AND 200 OR p_via IS NULL OR p_on IS NULL THEN
    RAISE EXCEPTION 'say who at the client received it, how and on which day' USING ERRCODE = 'check_violation';
  END IF;
  IF p_on > app_firm_today() OR p_on < app_firm_date(h.delivered_at) THEN
    RAISE EXCEPTION 'the day it was received is between the hand-over and today' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE deliverable_handovers SET received_by = app_uid(), received_at = now(), receipt_source = 'consultant_recorded',
    received_by_name = btrim(p_name), received_via = p_via, received_on = p_on
  WHERE id = h.id;
END $$;
--> statement-breakpoint
-- 8. The one reminder: a round still waiting after ten working days tells its
--    receivers once, with their other reminders (app_queue_digests below). Run
--    by the daily job as the schema owner. Returns how many rounds were reminded.
CREATE FUNCTION app_remind_deliverables(today date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n integer := 0;
  h record;
BEGIN
  IF app_uid() IS NOT NULL THEN
    RAISE EXCEPTION 'reminders are sent by the daily job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR h IN
    SELECT x.id, x.deliverable_id, x.version_ids FROM deliverable_handovers x
    JOIN organizations o ON o.id = x.org_id
    JOIN engagement_deliverables d ON d.id = x.deliverable_id
    LEFT JOIN projects p ON p.id = d.project_id
    WHERE x.received_at IS NULL AND x.commented_at IS NULL AND x.reminded_at IS NULL
      AND o.status = 'active' AND o.engagement_mode IS DISTINCT FROM 'consultant_managed'
      AND (p.id IS NULL OR p.state <> 'closed')
      AND NOT EXISTS (SELECT 1 FROM deliverable_handovers y WHERE y.deliverable_id = x.deliverable_id AND y.round > x.round)
      AND app_working_days(app_firm_date(x.delivered_at), today) >= app_deliverable_reminder_days()
    FOR UPDATE OF x SKIP LOCKED
  LOOP
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT r.user_id, 'deliverable.reminder', 'deliverable', h.deliverable_id FROM app_deliverable_receivers(h.deliverable_id, h.version_ids) r;
    UPDATE deliverable_handovers SET reminded_at = now() WHERE id = h.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
--> statement-breakpoint
-- The summary mail (latest: 0090_indicator_moved_away, every line of it
-- kept), now with the deliverable reminder, by the reader's reminders
-- cadence, and only while its round still waits and the reader still answers
-- for it (so never to someone who can no longer open its files).
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
-- 9. The two new mails are work mail: they wait for the reader's sending hours.
--    Both lists start from 0091_org_chart's (every org chart kind kept).
ALTER TABLE outbound_emails DROP CONSTRAINT outbound_kind;
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_kind CHECK (kind IN (
  'invitation', 'email_change.confirm', 'email_change.notice', 'access_review.due',
  'meeting.invite', 'meeting.cancel', 'password_reset', 'password_reset.notice', 'two_factor.reset',
  'inquiry.new', 'inquiry.received', 'inquiry.declined', 'action.assigned', 'action.revision_requested',
  'action.verified_complete', 'evidence.requested', 'action.commented', 'action.mentioned', 'follow_up.digest', 'client.archived',
  'pulse.requested', 'sign_in_link', 'info_request.upload_link', 'support.requested',
  'org_chart.holder_changed', 'org_chart.change_requested',
  'deliverable.handed_over', 'deliverable.commented'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_work_mail_kinds() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT app_update_mail_kinds() || ARRAY['follow_up.digest', 'access_review.due', 'inquiry.new', 'pulse.requested', 'support.requested',
    'org_chart.holder_changed', 'org_chart.change_requested', 'deliverable.handed_over', 'deliverable.commented']
$$;
--> statement-breakpoint
-- 10. A file handed over is relied on (latest: 0063): its uploader can no
--     longer withdraw it, so a receipt never points at a file that is gone.
CREATE OR REPLACE FUNCTION app_document_settled(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
      SELECT 1 FROM info_request_files f JOIN info_requests r ON r.id = f.request_id
      WHERE f.document_id = doc AND r.status = 'reviewed')
    OR EXISTS (
      SELECT 1 FROM assessment_evidence e JOIN assessment_answers a ON a.id = e.answer_id JOIN assessments s ON s.id = a.assessment_id
      WHERE e.document_id = doc AND s.status <> 'draft')
    OR EXISTS (SELECT 1 FROM deliverable_handovers h WHERE doc = ANY (h.version_ids))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_firm_hands_over(uuid), app_hand_over_preview(uuid, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_hand_over_preview(uuid, uuid[]) TO selah_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_deliverable_client(uuid), app_deliverable_projects(uuid), app_user_opens_document(uuid, uuid),
  app_deliverable_receiver_ok(uuid, uuid, uuid[]), app_deliverable_receivers(uuid, uuid[]), app_can_read_handover(uuid, uuid[]),
  app_answers_for_deliverable(uuid), app_deliverable_parties(uuid[]), app_working_days(date, date), app_deliverable_reminder_days(), app_open_handover(uuid, integer),
  app_hand_over_deliverable(uuid, uuid[]), app_confirm_deliverable_receipt(uuid, integer), app_comment_on_deliverable(uuid, integer, text),
  app_record_deliverable_receipt(uuid, integer, text, received_via, date), app_remind_deliverables(date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_read_handover(uuid, uuid[]), app_answers_for_deliverable(uuid), app_deliverable_parties(uuid[]), app_working_days(date, date),
  app_deliverable_reminder_days(), app_hand_over_deliverable(uuid, uuid[]), app_confirm_deliverable_receipt(uuid, integer),
  app_comment_on_deliverable(uuid, integer, text), app_record_deliverable_receipt(uuid, integer, text, received_via, date) TO selah_app;
