ALTER TABLE "ai_messages" ADD COLUMN "progress_draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "drafted_by" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "draft_message_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_drafted_by_user_id_fk" FOREIGN KEY ("drafted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_approver_stamped" CHECK ("reports"."approved_by" IS NULL OR "reports"."approved_at" IS NOT NULL);--> statement-breakpoint
-- Hand-written from here (migration 0110: sending a report to the client).
--
-- A client-facing report goes out only after a firm person other than its
-- writer approved it, and only when someone presses Send in a confirmation
-- dialog (shareReport() takes { confirmed: true }). Nothing sends on its own:
-- no job and no model call shares a report.
--
-- 1. Reports already shared went out before approval existed: they are read
--    as before, stamped approved on the day they were shared, with no
--    approver (the screen says so). Who wrote a report: its maker; for a
--    status pack issued before this migration the issuer is not known (NULL:
--    any approver may approve it). The triggers are off only for these rows.
ALTER TABLE reports DISABLE TRIGGER USER;
--> statement-breakpoint
UPDATE reports SET approved_at = coalesce(shared_at, created_at) WHERE visibility = 'shared';
--> statement-breakpoint
UPDATE reports SET drafted_by = generated_by WHERE kind = 'report';
--> statement-breakpoint
ALTER TABLE reports ENABLE TRIGGER USER;
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_shared_only_approved" CHECK ("reports"."visibility" <> 'shared' OR "reports"."approved_at" IS NOT NULL);
--> statement-breakpoint
-- 2. Who approves: the same people who switch an action's second sign-off on
--    (F22): the firm admin, the client's lead or deputy consultant, or an
--    internal project's lead; never the person who wrote the report
--    (separation of duties, as a firm-recorded response is confirmed by a
--    colleague other than its recorder). When the lead wrote it, the deputy
--    or the firm admin approves.
CREATE FUNCTION app_report_approver(pid uuid, org uuid, writer uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_uid() IS NOT NULL AND app_org_kind() = 'firm' AND app_can_see_project(pid)
    AND (writer IS NULL OR writer <> app_uid())
    AND (
      app_role() = 'firm_admin'
      OR (app_project_kind(pid) = 'client' AND app_is_client_lead(org))
      OR (app_project_kind(pid) <> 'client' AND app_is_project_lead(pid))
    )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_report_approver(uuid, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_report_approver(uuid, uuid, uuid) TO selah_app;
--> statement-breakpoint
-- Whether the caller may approve this report now: issued (numbers frozen), not yet approved, and an approver who did not write it.
CREATE FUNCTION app_can_approve_report(rid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT r.metrics IS NOT NULL AND r.approved_at IS NULL AND app_report_approver(r.project_id, r.org_id, r.drafted_by)
    FROM reports r WHERE r.id = rid), false)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_approve_report(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_approve_report(uuid) TO selah_app;
--> statement-breakpoint
-- 3. The database keeps the writer, the approval and the send in order. The
--    app never sets drafted_by or approved_at itself: it names itself as the
--    approver (approved_by = app_uid()) and the stamp is the database's.
--    Whoever writes and freezes a report's note is its writer (review S1): a
--    report the app makes is made by the caller in their own name with its
--    numbers frozen at once, and a status pack's note is written only as it
--    is issued, by its issuer. Only the app's roles are checked; the schema
--    owner (migrations, the monthly job, the seed, tests) is not (review N6).
--    Fires before report_frozen and status_pack (names sort in that order).
--
-- The caller's own progress-draft answer in the assistant, in a chat on this project (review N1).
CREATE FUNCTION app_own_progress_draft(mid uuid, pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM ai_messages m JOIN ai_conversations c ON c.id = m.conversation_id
    WHERE m.id = mid AND m.user_id = app_uid() AND c.user_id = app_uid() AND m.role = 'assistant'
      AND m.progress_draft AND c.project_id = pid)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_own_progress_draft(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_own_progress_draft(uuid, uuid) TO selah_app;
--> statement-breakpoint
CREATE FUNCTION check_report_approval() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user NOT IN ('selah_app', 'selah_auth') THEN RETURN NEW; END IF;
  IF app_uid() IS NULL THEN
    RAISE EXCEPTION 'a report is written only by a signed-in person' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.generated_by IS DISTINCT FROM app_uid() THEN
      RAISE EXCEPTION 'you write a report only in your own name' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.kind = 'report' AND NEW.metrics IS NULL THEN
      RAISE EXCEPTION 'a report freezes its numbers when it is made' USING ERRCODE = 'check_violation';
    END IF;
    NEW.drafted_by := app_uid();
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    IF NEW.visibility = 'shared' THEN
      RAISE EXCEPTION 'a report is sent to the client only once approved' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.draft_message_id IS NOT NULL AND NOT app_own_progress_draft(NEW.draft_message_id, NEW.project_id) THEN
      RAISE EXCEPTION 'a report starts only from your own progress draft' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- The writer: whoever freezes the note; until then the note changes only as it is frozen.
  IF OLD.metrics IS NULL AND NEW.metrics IS NOT NULL THEN
    NEW.drafted_by := app_uid();
  ELSE
    NEW.drafted_by := OLD.drafted_by;
    IF OLD.metrics IS NULL AND NEW.body_md IS DISTINCT FROM OLD.body_md THEN
      RAISE EXCEPTION 'a status pack''s note is written as it is issued' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- The draft it started from: only while the note is being written, and only the caller's own.
  IF NEW.draft_message_id IS DISTINCT FROM OLD.draft_message_id THEN
    IF OLD.metrics IS NOT NULL OR NEW.metrics IS NULL
      OR (NEW.draft_message_id IS NOT NULL AND NOT app_own_progress_draft(NEW.draft_message_id, OLD.project_id)) THEN
      RAISE EXCEPTION 'a report starts only from your own progress draft' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- Approval: once, in the caller's own name, on an issued report, by an approver who did not write it; stamped here.
  IF NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    IF OLD.approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'this report is already approved' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.approved_by IS DISTINCT FROM app_uid() THEN
      RAISE EXCEPTION 'you approve a report only in your own name' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.metrics IS NULL THEN
      RAISE EXCEPTION 'issue the report before approving it' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.drafted_by = app_uid() THEN
      RAISE EXCEPTION 'someone other than the writer approves a report' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT app_report_approver(OLD.project_id, OLD.org_id, OLD.drafted_by) THEN
      RAISE EXCEPTION 'only the client''s lead or deputy consultant, an internal project''s lead or the firm admin approves a report'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.approved_at := now();
  END IF;
  -- Sending: only an approved report (reports_shared_only_approved says the same of every row).
  IF NEW.visibility = 'shared' AND OLD.visibility IS DISTINCT FROM 'shared' AND NEW.approved_at IS NULL THEN
    RAISE EXCEPTION 'a report is sent to the client only once approved' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER report_approval BEFORE INSERT OR UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION check_report_approval();
--> statement-breakpoint
-- 4. An issued report changes only to be approved and shared (latest: 0000).
CREATE OR REPLACE FUNCTION freeze_report() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.metrics IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - '{visibility,shared_at,approved_by,approved_at}'::text[])
      <> (to_jsonb(OLD) - '{visibility,shared_at,approved_by,approved_at}'::text[]) THEN
    RAISE EXCEPTION 'an issued report cannot change; write a new one' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- 5. A draft status pack changes only its note, numbers and lists, and with
--    them who issued it and the draft its note started from (latest: 0050).
CREATE OR REPLACE FUNCTION check_status_pack() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind = 'status_pack' AND app_uid() IS NOT NULL THEN
      RAISE EXCEPTION 'status packs are drafted by the monthly job' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'a report keeps its kind' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'status_pack' AND OLD.metrics IS NULL THEN
    IF (to_jsonb(NEW) - '{body_md,metrics,pack,drafted_by,draft_message_id}'::text[])
        <> (to_jsonb(OLD) - '{body_md,metrics,pack,drafted_by,draft_message_id}'::text[]) THEN
      RAISE EXCEPTION 'a draft status pack changes only its note until it is issued' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.metrics IS NOT NULL AND NEW.pack IS NULL THEN
      RAISE EXCEPTION 'an issued status pack keeps its lists' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- 6. A client person never reads a report the firm has not approved. The
--    label already keeps them to shared reports, and a shared report is
--    approved (reports_shared_only_approved); the row rule says it again.
CREATE POLICY approved_for_client ON reports AS RESTRICTIVE FOR SELECT TO selah_app
  USING (app_org_kind() = 'firm' OR approved_at IS NOT NULL);
--> statement-breakpoint
-- 7. The app reads the new columns (0074: every column but pack is granted one by one).
GRANT SELECT (drafted_by, approved_by, approved_at, draft_message_id) ON reports TO selah_app;
