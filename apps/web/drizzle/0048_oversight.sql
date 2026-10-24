CREATE TABLE "action_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"sent_by" uuid NOT NULL,
	"on_day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_reminders" ADD CONSTRAINT "action_reminders_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_reminders" ADD CONSTRAINT "action_reminders_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_reminders" ADD CONSTRAINT "action_reminders_sent_by_user_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_reminders" ADD CONSTRAINT "action_reminders_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_reminders_once_a_day" ON "action_reminders" USING btree ("action_id","on_day");
--> statement-breakpoint
-- ------------------------------------------- oversight across projects (F18)
-- One firm-only page shows every project the caller can see with a health
-- signal, and the exceptions across them. A consultant can ask an action's
-- owner for an update in one click, once a day (action_reminders).

-- lib/health.ts HEALTH_OVERDUE_SHARE, HEALTH_LATE_DAYS, REVIEW_WAIT_DAYS.
CREATE FUNCTION app_health_overdue_share() RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$ SELECT 0.25 $$;
--> statement-breakpoint
CREATE FUNCTION app_health_late_days() RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$ SELECT 60 $$;
--> statement-breakpoint
CREATE FUNCTION app_review_wait_days() RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$ SELECT 7 $$;
--> statement-breakpoint
-- lib/health.ts healthSignal(): counts, never a weighted score.
CREATE FUNCTION app_health_signal(total integer, open integer, overdue integer, late_long integer, cautions integer) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN total = 0 THEN 'no_data'
    WHEN open > 0 AND (overdue >= open * app_health_overdue_share() OR late_long > 0) THEN 'off_track'
    WHEN overdue > 0 OR cautions > 0 THEN 'watch'
    ELSE 'on_track' END
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_health_overdue_share(), app_health_late_days(), app_review_wait_days(),
  app_health_signal(integer, integer, integer, integer, integer) TO selah_app;
--> statement-breakpoint
-- When someone at the client last did anything on the project the caller can see.
CREATE FUNCTION app_client_last_active(pid uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT max(e.created_at) FROM activity_events e
    JOIN projects p ON p.id = e.project_id
    JOIN org_memberships m ON m.user_id = e.actor_id AND m.org_id = p.org_id
  WHERE e.project_id = pid AND p.kind = 'client' AND app_org_kind() = 'firm' AND app_can_see_project(pid)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_client_last_active(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_client_last_active(uuid) TO selah_app;
--> statement-breakpoint
-- The lead of a project the caller can see: the client's lead consultant, or the internal project's lead.
CREATE FUNCTION app_project_lead(pid uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE p.kind
    WHEN 'client' THEN (SELECT ca.user_id FROM client_assignments ca WHERE ca.client_org_id = p.org_id AND ca.is_lead)
    ELSE (SELECT pm.user_id FROM project_members pm WHERE pm.project_id = p.id AND pm.is_lead LIMIT 1) END
  FROM projects p WHERE p.id = pid AND app_org_kind() = 'firm' AND app_can_see_project(pid)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_project_lead(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_project_lead(uuid) TO selah_app;
--> statement-breakpoint
-- Every planned, active or closing project the firm caller can see, with its
-- counts and signal. Drafts (pitches) and closed projects are left out.
CREATE FUNCTION app_portfolio(today date DEFAULT app_firm_today())
RETURNS TABLE (
  project_id uuid, org_id uuid, kind text, state text, total integer, open integer, overdue integer,
  late_d1_30 integer, late_d31_60 integer, late_d61_90 integer, late_d90_plus integer, late_long integer,
  extended_twice integer, blocked integer, awaiting_review integer, review_waiting integer, oldest_review_days integer,
  stale integer, orphaned integer, disputed integer, risk_accepted integer, lead_id uuid, client_last_active timestamptz, signal text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH p AS (
    SELECT p.id, p.org_id, p.kind::text AS kind, p.state::text AS state FROM projects p
    WHERE app_org_kind() = 'firm' AND p.state::text IN ('planned', 'active', 'closing')
  ),
  x AS (
    SELECT p.*, g.*,
      (SELECT count(*) FROM app_action_slips(p.id, today) s WHERE s.days_late > app_health_late_days())::int AS late_long,
      (SELECT count(*) FROM actions a WHERE a.project_id = p.id AND a.status = 'blocked' AND a.closure_outcome IS NULL)::int AS blocked,
      (SELECT count(*) FROM actions a WHERE a.project_id = p.id AND a.status = 'awaiting_review')::int AS awaiting_review,
      (SELECT count(*) FROM actions a WHERE a.project_id = p.id AND a.status = 'awaiting_review'
         AND today - app_firm_date(a.updated_at) > app_review_wait_days())::int AS review_waiting,
      (SELECT max(today - app_firm_date(a.updated_at)) FROM actions a WHERE a.project_id = p.id AND a.status = 'awaiting_review')::int AS oldest_review_days,
      (SELECT count(DISTINCT d.entity_id) FROM v_deviations d WHERE d.project_id = p.id AND d.rule = 'stale')::int AS stale,
      (SELECT count(DISTINCT d.entity_id) FROM v_deviations d WHERE d.project_id = p.id AND d.rule = 'orphaned')::int AS orphaned,
      (SELECT count(DISTINCT d.entity_id) FROM v_deviations d WHERE d.project_id = p.id AND d.rule = 'disputed')::int AS disputed
    FROM p, app_project_progress(p.id, today) g
  )
  SELECT x.id, x.org_id, x.kind, x.state, x.total, x.open, x.overdue,
    x.late_d1_30, x.late_d31_60, x.late_d61_90, x.late_d90_plus, x.late_long,
    x.extended_twice, x.blocked, x.awaiting_review, x.review_waiting, x.oldest_review_days,
    x.stale, x.orphaned, x.disputed, x.risk_accepted, app_project_lead(x.id), app_client_last_active(x.id),
    app_health_signal(x.total, x.open, x.overdue, x.late_long,
      x.blocked + x.extended_twice + x.orphaned + x.stale + x.review_waiting + x.disputed)
  FROM x
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_portfolio(date) TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON action_reminders TO selah_app;
--> statement-breakpoint
ALTER TABLE action_reminders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The firm's record of chasing: firm staff on the project read it.
CREATE POLICY firm_read ON action_reminders FOR SELECT TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id));
--> statement-breakpoint
CREATE POLICY firm_insert ON action_reminders FOR INSERT TO selah_app
  WITH CHECK (app_org_kind() = 'firm' AND sent_by = app_uid() AND app_can_see_project(project_id));
--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON action_reminders FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
-- A reminder is for a released, open action with an active owner who isn't
-- the sender, at most once a firm day. The owner hears about it with their
-- other reminders (follow_up.reminder, mailed in the summary).
CREATE FUNCTION check_action_reminder() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record;
BEGIN
  SELECT x.project_id, x.org_id, x.owner_user_id, x.status, x.closure_outcome INTO a FROM actions x WHERE x.id = NEW.action_id;
  IF NOT FOUND OR a.project_id <> NEW.project_id OR a.org_id <> NEW.org_id OR NOT app_can_see_action(NEW.action_id) THEN
    RAISE EXCEPTION 'reminders are for actions of the project' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF a.status IN ('draft', 'verified_complete') OR a.closure_outcome IS NOT NULL THEN
    RAISE EXCEPTION 'only an open action can be chased' USING ERRCODE = 'check_violation';
  END IF;
  IF a.owner_user_id IS NULL OR a.owner_user_id = app_uid() OR NOT app_member_active(a.owner_user_id, a.org_id) THEN
    RAISE EXCEPTION 'the action has no other active owner to remind' USING ERRCODE = 'check_violation';
  END IF;
  NEW.owner_id := a.owner_user_id;
  NEW.on_day := app_firm_today();
  IF EXISTS (SELECT 1 FROM action_reminders r WHERE r.action_id = NEW.action_id AND r.on_day = NEW.on_day) THEN
    RAISE EXCEPTION 'the owner was already reminded today' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES (a.owner_user_id, 'follow_up.reminder', 'action', NEW.action_id);
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_action_reminder() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER action_reminder BEFORE INSERT ON action_reminders FOR EACH ROW EXECUTE FUNCTION check_action_reminder();
--> statement-breakpoint
-- A closed project is not chased (lib/closure.ts FROZEN_TABLES), and an observer (N6) doesn't chase.
CREATE TRIGGER project_open BEFORE INSERT OR UPDATE OR DELETE ON action_reminders FOR EACH ROW EXECUTE FUNCTION check_project_open();
--> statement-breakpoint
CREATE TRIGGER project_observer BEFORE INSERT OR UPDATE OR DELETE ON action_reminders FOR EACH ROW EXECUTE FUNCTION check_not_observer();
