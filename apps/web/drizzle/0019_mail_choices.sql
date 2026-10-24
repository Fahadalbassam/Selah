CREATE TYPE "public"."mail_cadence" AS ENUM('instant', 'daily', 'weekly', 'off');--> statement-breakpoint
CREATE TABLE "mail_mutes" (
	"user_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_mutes_user_id_action_id_pk" PRIMARY KEY("user_id","action_id")
);
--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "ramadan_starts" date;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "ramadan_ends" date;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "ramadan_mail_from" time DEFAULT '10:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "ramadan_mail_to" time DEFAULT '15:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_preferences" ADD COLUMN "updates" "mail_cadence" DEFAULT 'instant' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_preferences" ADD COLUMN "reminders" "mail_cadence" DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_preferences" ADD COLUMN "quiet_from" time DEFAULT '20:00';--> statement-breakpoint
ALTER TABLE "mail_preferences" ADD COLUMN "quiet_to" time DEFAULT '07:00';--> statement-breakpoint
ALTER TABLE "mail_preferences" ADD COLUMN "saturday" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_preferences" ADD COLUMN "ramadan" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_mutes" ADD CONSTRAINT "mail_mutes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_mutes" ADD CONSTRAINT "mail_mutes_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Hand-written (wave 1, item 12): mail choices that respect the Saudi week.
--
-- 1. The old on/off switch for the reminder summary becomes the reminders
--    cadence. Work mail is held through each person's quiet hours, all of
--    Friday, Saturday unless they ask for it, and, with the Ramadan profile
--    on, outside the firm's Ramadan hours during the firm's Ramadan dates.
UPDATE mail_preferences SET reminders = 'off' WHERE NOT follow_up_digest;
--> statement-breakpoint
ALTER TABLE mail_preferences DROP COLUMN follow_up_digest;
--> statement-breakpoint
-- Reminders come from the daily job, so there is no "instant" for them.
ALTER TABLE mail_preferences ADD CONSTRAINT mail_reminders_cadence CHECK (reminders <> 'instant');
--> statement-breakpoint
ALTER TABLE mail_preferences ADD CONSTRAINT mail_quiet_hours CHECK (
  (quiet_from IS NULL AND quiet_to IS NULL) OR (quiet_from IS NOT NULL AND quiet_to IS NOT NULL AND quiet_from <> quiet_to));
--> statement-breakpoint
GRANT DELETE ON mail_preferences TO selah_app;
--> statement-breakpoint
ALTER TABLE firm_settings ADD CONSTRAINT ramadan_dates CHECK (
  (ramadan_starts IS NULL AND ramadan_ends IS NULL)
  OR (ramadan_starts IS NOT NULL AND ramadan_ends IS NOT NULL AND ramadan_ends - ramadan_starts BETWEEN 28 AND 29));
--> statement-breakpoint
ALTER TABLE firm_settings ADD CONSTRAINT ramadan_mail_hours CHECK (ramadan_mail_from < ramadan_mail_to);
--> statement-breakpoint
-- 2. Muting one action: each person mutes only what they can see, and sees
--    only their own mutes.
ALTER TABLE mail_mutes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY own ON mail_mutes TO selah_app USING (user_id = app_uid())
  WITH CHECK (user_id = app_uid() AND EXISTS (SELECT 1 FROM actions a WHERE a.id = action_id));
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON mail_mutes TO selah_app;
--> statement-breakpoint
-- 3. A person's choices, with the defaults for someone who never saved any.
CREATE FUNCTION app_mail_choice(uid uuid)
RETURNS TABLE (updates mail_cadence, reminders mail_cadence, quiet_from time, quiet_to time, saturday boolean, ramadan boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(p.updates, 'instant'), coalesce(p.reminders, 'daily'),
         CASE WHEN p.user_id IS NULL THEN '20:00'::time ELSE p.quiet_from END,
         CASE WHEN p.user_id IS NULL THEN '07:00'::time ELSE p.quiet_to END,
         coalesce(p.saturday, false), coalesce(p.ramadan, true)
  FROM (SELECT uid AS id) x LEFT JOIN mail_preferences p ON p.user_id = x.id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_mail_choice(uuid) FROM PUBLIC;
--> statement-breakpoint
-- 4. The earliest moment at or after `at` that work mail may go out, in the
--    firm's time. Friday never; Saturday only if asked; in Ramadan (when the
--    profile is on) only in the Ramadan hours; otherwise outside quiet hours,
--    which may run over midnight (20:00 to 07:00) or not (13:00 to 16:00).
CREATE FUNCTION app_mail_send_time(
  at timestamptz, quiet_from time, quiet_to time, saturday boolean,
  ramadan_starts date, ramadan_ends date, ramadan_from time, ramadan_to time
) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  here timestamp := at AT TIME ZONE app_firm_tz();
  d date;
  dow int;
  win time[];
  i int;
  starts timestamp;
  ends timestamp;
BEGIN
  FOR k IN 0..13 LOOP
    d := here::date + k;
    dow := extract(dow FROM d);
    CONTINUE WHEN dow = 5 OR (dow = 6 AND NOT saturday);
    IF ramadan_starts IS NOT NULL AND d BETWEEN ramadan_starts AND ramadan_ends THEN
      win := ARRAY[ramadan_from, ramadan_to];
    ELSIF quiet_from IS NULL THEN
      win := ARRAY['00:00'::time, '24:00'::time];
    ELSIF quiet_from > quiet_to THEN
      win := ARRAY[quiet_to, quiet_from];
    ELSE
      win := ARRAY['00:00'::time, quiet_from, quiet_to, '24:00'::time];
    END IF;
    i := 1;
    WHILE i < array_length(win, 1) LOOP
      starts := greatest(d + win[i], here);
      ends := d + win[i + 1];
      IF starts < ends THEN
        RETURN starts AT TIME ZONE app_firm_tz();
      END IF;
      i := i + 2;
    END LOOP;
  END LOOP;
  RETURN at;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_mail_send_time(timestamptz, time, time, boolean, date, date, time, time) TO selah_app;
--> statement-breakpoint
-- The same for one person, with their choices and the firm's Ramadan.
CREATE FUNCTION app_mail_send_at(uid uuid, at timestamptz) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_mail_send_time(at, c.quiet_from, c.quiet_to, c.saturday,
    CASE WHEN c.ramadan THEN fs.ramadan_starts END, CASE WHEN c.ramadan THEN fs.ramadan_ends END,
    coalesce(fs.ramadan_mail_from, '10:00'), coalesce(fs.ramadan_mail_to, '15:00'))
  FROM app_mail_choice(uid) c
  LEFT JOIN (SELECT s.* FROM firm_settings s JOIN organizations o ON o.id = s.org_id AND o.kind = 'firm' LIMIT 1) fs ON true
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_mail_send_at(uuid, timestamptz) FROM PUBLIC;
--> statement-breakpoint
-- What the caller's choices would do to a mail queued now (the preferences page).
CREATE FUNCTION app_my_next_mail_at() RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_mail_send_at(app_uid(), now()) WHERE app_uid() IS NOT NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_my_next_mail_at() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_my_next_mail_at() TO selah_app;
--> statement-breakpoint
-- 5. Which mails are work mail. Account and security mail (invitations,
--    resets, address changes), meeting invites and mail to inquirers always
--    go at once.
CREATE FUNCTION app_update_mail_kinds() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT ARRAY['action.assigned', 'action.revision_requested', 'action.verified_complete', 'evidence.requested']
$$;
--> statement-breakpoint
CREATE FUNCTION app_work_mail_kinds() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT app_update_mail_kinds() || ARRAY['follow_up.digest', 'access_review.due', 'inquiry.new']
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_update_mail_kinds(), app_work_mail_kinds() TO selah_app;
--> statement-breakpoint
-- Work mail to someone with an account waits for their next sending time.
-- The sender already skips rows whose next attempt is still to come.
CREATE FUNCTION hold_work_mail() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid uuid; at timestamptz;
BEGIN
  IF NEW.kind = ANY (app_work_mail_kinds()) THEN
    SELECT u.id INTO uid FROM "user" u WHERE lower(u.email) = lower(NEW.to_email) LIMIT 1;
    IF uid IS NOT NULL THEN
      at := app_mail_send_at(uid, now());
      IF at > now() THEN
        NEW.next_attempt_at := greatest(coalesce(NEW.next_attempt_at, at), at);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER hold_work_mail BEFORE INSERT ON outbound_emails
  FOR EACH ROW EXECUTE FUNCTION hold_work_mail();
--> statement-breakpoint
-- 6. Mail about an owner's own action goes at once only for people who chose
--    "instant" and haven't muted the action. Otherwise the notification stays
--    unmailed for the daily or weekly summary (app_queue_digests).
CREATE OR REPLACE FUNCTION mail_action_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; addr text; matches boolean;
BEGIN
  NEW.mailed_at := NULL;
  IF NEW.entity_type <> 'action' OR NEW.kind <> ALL (app_update_mail_kinds()) THEN
    RETURN NEW;
  END IF;
  SELECT x.owner_user_id, x.status INTO a FROM actions x WHERE x.id = NEW.entity_id;
  IF NOT FOUND OR a.owner_user_id IS DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;
  matches := CASE NEW.kind
    -- Released to them, or handed to them while it's under way.
    WHEN 'action.assigned' THEN app_action_open(a.status)
    WHEN 'action.revision_requested' THEN a.status = 'revision_requested'
    WHEN 'action.verified_complete' THEN a.status = 'verified_complete'
    ELSE app_action_open(a.status)
      AND EXISTS (SELECT 1 FROM evidence_requests r WHERE r.action_id = NEW.entity_id AND r.status = 'open')
  END;
  IF NOT matches THEN
    RETURN NEW;
  END IF;
  IF NOT app_can_reset_password(NEW.user_id) THEN
    RETURN NEW; -- switched off or erased: no mail
  END IF;
  IF (SELECT c.updates FROM app_mail_choice(NEW.user_id) c) <> 'instant'
     OR EXISTS (SELECT 1 FROM mail_mutes m WHERE m.user_id = NEW.user_id AND m.action_id = NEW.entity_id) THEN
    RETURN NEW; -- batched into their summary, switched off, or muted
  END IF;
  IF EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.user_id = NEW.user_id AND n.kind = NEW.kind AND n.entity_id = NEW.entity_id
      AND n.mailed_at > now() - interval '1 hour'
  ) THEN
    RETURN NEW;
  END IF;
  SELECT u.email INTO addr FROM "user" u WHERE u.id = NEW.user_id;
  IF addr IS NOT NULL THEN
    INSERT INTO outbound_emails (to_email, kind, link) VALUES (addr, NEW.kind, '/actions/' || NEW.entity_id);
    NEW.mailed_at := now();
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- 7. The summary mail, run by the daily job after the reminders. Daily
--    people get it every day there is something new for them, weekly people
--    on Sunday, the first day of the Saudi week. It covers reminders (actions
--    and information requests) and, for people who batch them, updates about
--    their own actions, never a muted
--    action, and it says only that there is something (a line and a link).
--    Each notification is summarised once; one summary a day at most.
CREATE FUNCTION app_cadence_due(cadence mail_cadence, day date) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT cadence = 'daily' OR (cadence = 'weekly' AND extract(dow FROM day) = 0)
$$;
--> statement-breakpoint
CREATE FUNCTION app_queue_digests(today date) RETURNS integer
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
--> statement-breakpoint
-- 8. Whether the caller can see an action: the same three checks as its
--    row-level security (project, recommendation label, department).
CREATE FUNCTION app_can_see_action(aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT app_can_see_project(a.project_id) AND app_recommendation_label_ok(a.recommendation_id) AND app_action_dept_ok(a.id)
    FROM actions a WHERE a.id = aid
  ), false)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_see_action(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_see_action(uuid) TO selah_app;
--> statement-breakpoint
-- 9. The reminder ladder of one action, for anyone who can see it: each
--    step, the day it fires for the current due date, who it reaches (as
--    roles, the same people app_follow_ups_due() picks) and when it was
--    sent. `running` is false while the action waits on the firm, is
--    finished, or its project is not active.
CREATE FUNCTION app_action_ladder(aid uuid)
RETURNS TABLE (kind follow_up_kind, level integer, on_date date, audience text[], sent_at timestamptz, running boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH a AS (
    SELECT x.id, x.due_date, x.department_id, p.kind AS project_kind,
           p.remind_days_before, p.escalate_level2_days, p.escalate_level3_days,
           (p.kind = 'client' AND o.engagement_mode = 'consultant_managed') AS firm_managed,
           o.departments_enabled AND x.department_id IS NOT NULL AS has_dept,
           x.owner_user_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = x.owner_user_id AND m.org_id = x.org_id AND m.active) AS owner_active,
           app_owner_holds(x.status) AND p.state = 'active' AS running
    FROM actions x JOIN projects p ON p.id = x.project_id JOIN organizations o ON o.id = x.org_id
    WHERE x.id = aid AND x.due_date IS NOT NULL AND app_can_see_action(aid)
      AND (x.owner_user_id IS NOT NULL OR (p.kind = 'client' AND o.engagement_mode = 'consultant_managed'))
  ),
  steps AS (
    SELECT a.*, s.kind, s.level, s.on_date FROM a, LATERAL (VALUES
      ('due_soon'::follow_up_kind, 0, a.due_date - a.remind_days_before),
      ('overdue'::follow_up_kind, 1, a.due_date + 1),
      ('overdue'::follow_up_kind, 2, a.due_date + a.escalate_level2_days),
      ('overdue'::follow_up_kind, 3, a.due_date + a.escalate_level3_days)
    ) s(kind, level, on_date)
  )
  SELECT s.kind, s.level, s.on_date,
    array_remove(ARRAY[
      CASE WHEN s.owner_active THEN 'owner' END,
      CASE WHEN s.level >= 2 AND s.project_kind = 'client' THEN 'client_managers' END,
      CASE WHEN s.level >= 2 AND s.project_kind = 'client' AND s.has_dept THEN 'department_head' END,
      -- a firm-managed client's lead chases the client from the first step
      CASE WHEN s.firm_managed OR (s.level >= 2 AND s.project_kind = 'client') THEN 'client_lead' END,
      CASE WHEN s.level >= 2 AND s.project_kind = 'internal' THEN 'project_lead' END,
      CASE WHEN s.level >= 3 AND s.project_kind = 'client' THEN 'sponsor' END,
      CASE WHEN s.level >= 3 AND s.project_kind = 'client' THEN 'client_admins' END,
      CASE WHEN s.level >= 3 THEN 'watching_firm_admins' END
    ], NULL),
    (SELECT l.created_at FROM follow_up_log l WHERE l.action_id = s.id AND l.kind = s.kind AND l.level = s.level AND l.due_date = s.due_date),
    s.running
  FROM steps s
  -- An owner who has left is not reminded: the ladder starts at level 2.
  WHERE s.level >= 2 OR s.owner_active OR s.firm_managed
  ORDER BY s.level
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_action_ladder(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_action_ladder(uuid) TO selah_app;
--> statement-breakpoint
-- 10. Mail that isn't getting through, for firm staff: the person's latest
--     finished mail failed for good, or a mail to them has failed three
--     tries and is still being retried. Never the error itself.
CREATE FUNCTION app_mail_failing(uids uuid[]) RETURNS TABLE (user_id uuid, since timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, coalesce(f.failed_at, r.since)
  FROM "user" u
  LEFT JOIN LATERAL (
    SELECT o.failed_at FROM outbound_emails o
    WHERE lower(o.to_email) = lower(u.email) AND (o.sent_at IS NOT NULL OR o.failed_at IS NOT NULL)
    ORDER BY coalesce(o.sent_at, o.failed_at) DESC LIMIT 1
  ) f ON true
  LEFT JOIN LATERAL (
    SELECT min(o.created_at) AS since FROM outbound_emails o
    WHERE lower(o.to_email) = lower(u.email) AND o.sent_at IS NULL AND o.failed_at IS NULL
      AND o.attempts >= 3 AND o.last_error IS NOT NULL
  ) r ON true
  WHERE u.id = ANY (uids) AND app_org_kind() = 'firm' AND app_can_see_user(u.id)
    AND (f.failed_at IS NOT NULL OR r.since IS NOT NULL)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_mail_failing(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_mail_failing(uuid[]) TO selah_app;
--> statement-breakpoint
-- The firm's Ramadan dates and hours, for everyone's preferences page (the
-- rest of the firm's settings stay firm-only).
CREATE FUNCTION app_firm_ramadan() RETURNS TABLE (starts date, ends date, mail_from time, mail_to time)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.ramadan_starts, s.ramadan_ends, s.ramadan_mail_from, s.ramadan_mail_to
  FROM firm_settings s JOIN organizations o ON o.id = s.org_id AND o.kind = 'firm'
  WHERE app_uid() IS NOT NULL
  LIMIT 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_firm_ramadan() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_firm_ramadan() TO selah_app;
