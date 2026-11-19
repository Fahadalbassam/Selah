CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"input" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"result" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ai_jobs_kind" CHECK ("ai_jobs"."kind" IN ('summary', 'translation', 'org_draft')),
	CONSTRAINT "ai_jobs_status" CHECK ("ai_jobs"."status" IN ('queued', 'running', 'done', 'failed', 'refused', 'cancelled', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_jobs_queue_idx" ON "ai_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_jobs_once" ON "ai_jobs" USING btree ("created_by","key") WHERE "ai_jobs"."status" IN ('queued', 'running');--> statement-breakpoint
-- Hand-written from here (migration 0113: slow AI calls as jobs).
--
-- A file summary, a translation or an org chart draft from pasted text used
-- to be made while the request waited. On a processor the local model takes
-- minutes, and Cloudflare's tunnel gives up on a response that has not
-- started within 100 seconds, so these calls failed in production. Now the
-- request checks what it can, files a job here and answers at once; the jobs
-- runner (src/jobs/ai-jobs.ts) does the jobs one at a time, as the person who
-- asked, checking their rights again before and after the model runs.
--
-- 1. Each person reads only their own jobs and files them for themselves.
--    Nobody changes a job but the runner (the schema owner); a person may
--    only cancel their own (app_cancel_ai_job).
GRANT SELECT, INSERT ON ai_jobs TO selah_app;
--> statement-breakpoint
ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY own_read ON ai_jobs FOR SELECT TO selah_app USING (created_by = app_uid());
--> statement-breakpoint
CREATE POLICY own_insert ON ai_jobs FOR INSERT TO selah_app WITH CHECK (created_by = app_uid());
--> statement-breakpoint
-- 2. A new job starts queued, empty of results. The model runs one job at a
--    time for everyone, so one person may not fill the line: as with the
--    assistant's answers (#208, ANSWERS_AT_ONCE), firm staff may have two
--    jobs waiting or running at once, a client person one. Each new job
--    wakes the runner (LISTEN ai_jobs).
CREATE FUNCTION check_ai_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE at_once integer := CASE WHEN app_org_kind() = 'firm' THEN 2 ELSE 1 END;
BEGIN
  -- A definer function: session_user is who connected (the owner's runner and tests skip these checks).
  IF session_user <> 'selah_app' THEN RETURN NEW; END IF;
  -- Filed for someone else: row-level security refuses it.
  IF NEW.created_by IS DISTINCT FROM app_uid() THEN RETURN NEW; END IF;
  NEW.status := 'queued';
  NEW.error := NULL;
  NEW.result := NULL;
  NEW.created_at := now();
  NEW.started_at := NULL;
  NEW.finished_at := NULL;
  PERFORM pg_advisory_xact_lock(hashtext('ai_jobs:' || NEW.created_by::text));
  IF (SELECT count(*) FROM ai_jobs WHERE created_by = NEW.created_by AND status IN ('queued', 'running')) >= at_once THEN
    RAISE EXCEPTION 'too many requests at once, wait for one to finish' USING ERRCODE = 'SL429';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER check_ai_job BEFORE INSERT ON ai_jobs FOR EACH ROW EXECUTE FUNCTION check_ai_job();
--> statement-breakpoint
CREATE FUNCTION notify_ai_job() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('ai_jobs', '');
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER notify_ai_job AFTER INSERT ON ai_jobs FOR EACH STATEMENT EXECUTE FUNCTION notify_ai_job();
--> statement-breakpoint
-- 3. Where a job stands in the line: how many jobs, anyone's, are ahead of it
--    (running, or queued before it). Only for the person's own job; the
--    count says nothing about whose they are.
CREATE FUNCTION app_ai_job_ahead(jid uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (SELECT count(*) FROM ai_jobs o
          WHERE o.status = 'running' OR (o.status = 'queued' AND (o.created_at, o.id) < (j.created_at, j.id)))::integer
  FROM ai_jobs j WHERE j.id = jid AND j.created_by = app_uid() AND j.status = 'queued'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_ai_job_ahead(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_ai_job_ahead(uuid) TO selah_app;
--> statement-breakpoint
-- 4. A person cancels their own job while it waits or runs: the runner drops
--    a running one's answer (it hangs up on the AI service). The pasted text
--    goes at once.
CREATE FUNCTION app_cancel_ai_job(jid uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH c AS (
    UPDATE ai_jobs SET status = 'cancelled', error = 'cancelled', input = NULL, result = NULL, finished_at = now()
    WHERE id = jid AND created_by = app_uid() AND status IN ('queued', 'running')
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM c)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_cancel_ai_job(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_cancel_ai_job(uuid) TO selah_app;
--> statement-breakpoint
-- 5. The runner's side (the schema owner only). It takes the oldest waiting
--    job only while none runs: one model run at a time, whoever asked. The
--    lock makes two runners take turns rather than both start one. Before
--    taking one it ends what is stale: a job that waited 30 minutes (the
--    runner is down; the page has long said so), one that ran over 15 (the
--    model call's own limit is 10: the runner died with it), and removes
--    jobs that ended over an hour ago, with their results.
CREATE FUNCTION app_claim_ai_job() RETURNS SETOF ai_jobs
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ai_jobs:claim'));
  UPDATE ai_jobs SET status = 'expired', error = 'expired', input = NULL, finished_at = now()
    WHERE status = 'queued' AND created_at < now() - interval '30 minutes';
  UPDATE ai_jobs SET status = 'failed', error = 'stopped', input = NULL, finished_at = now()
    WHERE status = 'running' AND started_at < now() - interval '15 minutes';
  DELETE FROM ai_jobs WHERE finished_at < now() - interval '1 hour';
  IF EXISTS (SELECT 1 FROM ai_jobs WHERE status = 'running') THEN RETURN; END IF;
  RETURN QUERY
    WITH taken AS (
      UPDATE ai_jobs SET status = 'running', started_at = now()
      WHERE id = (SELECT id FROM ai_jobs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *)
    SELECT * FROM taken;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_claim_ai_job() FROM PUBLIC;
