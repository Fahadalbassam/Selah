ALTER TABLE "reports" ADD COLUMN "kind" text DEFAULT 'report' NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "pack" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_status_pack_once" ON "reports" USING btree ("project_id","period_start") WHERE "reports"."kind" = 'status_pack';--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_kind" CHECK ("reports"."kind" IN ('report', 'status_pack'));--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_pack_issued_before_shared" CHECK ("reports"."kind" <> 'status_pack' OR "reports"."visibility" = 'firm_private' OR "reports"."metrics" IS NOT NULL);
--> statement-breakpoint
-- ------------------------------------------------ monthly status pack (F19)
-- On the first of each month the job drafts a firm-only status pack for last
-- month on every active client project and tells the client's lead. The
-- firm reviews it, adds a note and issues it, which freezes the numbers and
-- the lists. It is never shared before it is issued, and never by the job.

-- What a pack lists for a period, under the caller's row-level security.
-- Only work the client can be shown: actions under a firm-only
-- recommendation are left out, and each item keeps its department so a
-- client reader sees only their own departments' items.
CREATE FUNCTION app_status_pack(pid uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH a AS (
    SELECT a.*, coalesce(u.name, a.owner_name) AS owner
    FROM actions a
    LEFT JOIN recommendations r ON r.id = a.recommendation_id
    LEFT JOIN "user" u ON u.id = a.owner_user_id
    WHERE a.project_id = pid AND a.status <> 'draft' AND (r.id IS NULL OR r.visibility = 'shared')
  ),
  open AS (SELECT * FROM a WHERE a.status <> 'verified_complete' AND a.closure_outcome IS NULL)
  SELECT jsonb_build_object(
    'overdue', coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'owner', o.owner, 'dueDate', o.due_date,
        'days', p_to - o.due_date, 'departmentId', o.department_id) ORDER BY o.due_date, o.title)
      FROM open o WHERE o.due_date <= p_to), '[]'::jsonb),
    'slipped', coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'owner', o.owner, 'moves', s.extensions,
        'baselineDueDate', o.baseline_due_date, 'dueDate', o.due_date, 'departmentId', o.department_id) ORDER BY s.extensions DESC, o.title)
      FROM open o CROSS JOIN LATERAL (SELECT app_action_extensions(o.id) AS extensions) s WHERE s.extensions >= 2), '[]'::jsonb),
    'riskAccepted', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'acceptedBy', u.name,
        'on', app_firm_date(ra.created_at), 'departmentId', x.department_id) ORDER BY ra.created_at)
      FROM risk_acceptances ra JOIN a x ON x.id = ra.action_id LEFT JOIN "user" u ON u.id = ra.accepted_by
      WHERE app_firm_date(ra.created_at) BETWEEN p_from AND p_to), '[]'::jsonb),
    'verified', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'owner', x.owner, 'on', v.on,
        'departmentId', x.department_id) ORDER BY v.on, x.title)
      FROM a x CROSS JOIN LATERAL (
        SELECT max(app_firm_date(e.created_at)) AS on FROM activity_events e
        WHERE e.entity_type = 'action' AND e.entity_id = x.id AND e.to_state = 'verified_complete') v
      WHERE x.status = 'verified_complete' AND v.on BETWEEN p_from AND p_to), '[]'::jsonb),
    'moved', coalesce((SELECT jsonb_object_agg(m.to_state, m.n) FROM (
        SELECT e.to_state, count(DISTINCT e.entity_id)::int AS n FROM activity_events e JOIN a x ON x.id = e.entity_id
        WHERE e.entity_type = 'action' AND e.to_state IS NOT NULL AND app_firm_date(e.created_at) BETWEEN p_from AND p_to
        GROUP BY e.to_state) m), '{}'::jsonb),
    'decisions', coalesce((SELECT jsonb_agg(d ORDER BY d ->> 'kind', d ->> 'title') FROM (
        SELECT jsonb_build_object('kind', 'response', 'id', r.id, 'title', r.title, 'since', coalesce(s.responded_at, r.released_at, r.created_at), 'departmentId', r.department_id) AS d
        FROM app_recommendation_stances(pid) s JOIN recommendations r ON r.id = s.recommendation_id
        WHERE s.stance = 'awaiting'
        UNION ALL
        SELECT jsonb_build_object('kind', 'deadline', 'id', o.id, 'title', o.title, 'proposedDueDate', q.proposed_due_date,
          'since', q.created_at, 'departmentId', o.department_id)
        FROM deadline_change_requests q JOIN open o ON o.id = q.action_id WHERE q.status = 'pending'
      ) x), '[]'::jsonb)
  )
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_status_pack(uuid, date, date) TO selah_app;
--> statement-breakpoint
-- A pack is drafted only by the job; while a draft, only its note, numbers
-- and lists can change, and issuing (the numbers) brings the lists with it.
-- No report changes kind.
CREATE FUNCTION check_status_pack() RETURNS trigger
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
    IF (to_jsonb(NEW) - '{body_md,metrics,pack}'::text[]) <> (to_jsonb(OLD) - '{body_md,metrics,pack}'::text[]) THEN
      RAISE EXCEPTION 'a draft status pack changes only its note until it is issued' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.metrics IS NOT NULL AND NEW.pack IS NULL THEN
      RAISE EXCEPTION 'an issued status pack keeps its lists' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER status_pack BEFORE INSERT OR UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION check_status_pack();
--> statement-breakpoint
-- The job, as the schema owner, on the first of the month (safe to run
-- again): last month's draft for every active client project with released
-- work, in the name of the client's lead consultant (else the project's
-- creator), who is told. Returns how many it drafted.
CREATE FUNCTION app_draft_status_packs(today date) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n integer; p_from date := (date_trunc('month', today) - interval '1 month')::date; p_to date := (date_trunc('month', today) - interval '1 day')::date;
BEGIN
  WITH drafted AS (
    INSERT INTO reports (project_id, org_id, kind, title, body_md, generated_by, period_start, period_end)
      SELECT p.id, p.org_id, 'status_pack', 'Status pack ' || to_char(p_from, 'YYYY-MM'), '',
        coalesce((SELECT ca.user_id FROM client_assignments ca WHERE ca.client_org_id = p.org_id AND ca.is_lead), p.created_by),
        p_from, p_to
      FROM projects p
      WHERE p.kind = 'client' AND p.state = 'active'
        AND EXISTS (SELECT 1 FROM actions a WHERE a.project_id = p.id AND a.status <> 'draft')
        AND coalesce((SELECT ca.user_id FROM client_assignments ca WHERE ca.client_org_id = p.org_id AND ca.is_lead), p.created_by) IS NOT NULL
    ON CONFLICT (project_id, period_start) WHERE kind = 'status_pack' DO NOTHING
    RETURNING project_id, generated_by
  ),
  told AS (
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT d.generated_by, 'report.pack_drafted', 'project', d.project_id FROM drafted d
    RETURNING 1
  )
  SELECT count(*) INTO n FROM drafted;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_draft_status_packs(date) FROM PUBLIC;
--> statement-breakpoint
-- The summary mail also tells the lead that a status pack is drafted.
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
        WHEN x.entity_type = 'action' AND x.kind = ANY (app_update_mail_kinds()) THEN c.updates <> 'instant' AND app_cadence_due(c.updates, today)
        ELSE false
      END
      AND NOT EXISTS (SELECT 1 FROM mail_mutes m WHERE m.user_id = x.user_id AND m.action_id = x.entity_id)
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
REVOKE ALL ON FUNCTION app_queue_digests(date) FROM PUBLIC;
