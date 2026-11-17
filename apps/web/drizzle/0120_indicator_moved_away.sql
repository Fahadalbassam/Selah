CREATE TABLE "kpi_moved_away_log" (
	"kpi_id" uuid NOT NULL,
	"period" date NOT NULL,
	"org_id" uuid NOT NULL,
	"value_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_moved_away_log_kpi_id_period_pk" PRIMARY KEY("kpi_id","period")
);
--> statement-breakpoint
CREATE TABLE "mail_kpi_mutes" (
	"user_id" uuid NOT NULL,
	"kpi_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_kpi_mutes_user_id_kpi_id_pk" PRIMARY KEY("user_id","kpi_id")
);
--> statement-breakpoint
ALTER TABLE "kpi_moved_away_log" ADD CONSTRAINT "kpi_moved_away_log_kpi_id_client_kpis_id_fk" FOREIGN KEY ("kpi_id") REFERENCES "public"."client_kpis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_moved_away_log" ADD CONSTRAINT "kpi_moved_away_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_moved_away_log" ADD CONSTRAINT "kpi_moved_away_log_value_id_client_kpi_values_id_fk" FOREIGN KEY ("value_id") REFERENCES "public"."client_kpi_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_kpi_mutes" ADD CONSTRAINT "mail_kpi_mutes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_kpi_mutes" ADD CONSTRAINT "mail_kpi_mutes_kpi_id_client_kpis_id_fk" FOREIGN KEY ("kpi_id") REFERENCES "public"."client_kpis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- ------------------------------------------ an indicator that moved away
-- Decision 4b, 17 Nov 2026. The firm asks "how do we tell leadership when an
-- indicator moves away from its target?". Selah already tells when a value
-- is missing (indicator.due) and when a feed fails; now, when a value is
-- saved on the other side of the baseline from the direction the client
-- chose, or the target date has passed and the latest value has not reached
-- the target, the client's lead and deputy and the client's admins get one
-- notice, indicator.moved_away. It states the figures only (the value, its
-- period, the baseline and the chosen direction); it never judges, scores or
-- predicts.
--
-- The check runs here, after a value is stored, so every way a value
-- arrives is covered: typed in, a file import, a sheet read, a system push
-- (all four insert into client_kpi_values, and nothing else does).

-- Whether a figure is on the other side of a reference (the baseline, or
-- the target) from the chosen direction. Equal is not.
CREATE FUNCTION app_kpi_wrong_side(d kpi_direction, ref numeric, v numeric) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT coalesce(CASE d WHEN 'higher_better' THEN v < ref ELSE v > ref END, false)
$$;
--> statement-breakpoint
-- Who is told about an indicator: the client's lead and deputy, while active
-- at the firm, and the client's active admins. Every one of them reads every
-- indicator of the client (app_kpi_readable: the firm people assigned to the
-- client, and client admins in every department), so no one is told about an
-- indicator they cannot open. No manager, no action owner, no one at another
-- client, no other consultant.
CREATE FUNCTION app_kpi_moved_away_audience(kid uuid) RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT ca.user_id FROM client_kpis k
    JOIN client_assignments ca ON ca.client_org_id = k.org_id AND (ca.is_lead OR ca.is_deputy)
    JOIN org_memberships m ON m.user_id = ca.user_id AND m.active
    JOIN organizations f ON f.id = m.org_id AND f.kind = 'firm'
  WHERE k.id = kid
  UNION
  SELECT m.user_id FROM client_kpis k
    JOIN org_memberships m ON m.org_id = k.org_id AND m.active AND m.role = 'client_admin'
  WHERE k.id = kid
$$;
--> statement-breakpoint
-- Whether the caller is told about this indicator: the indicator page offers
-- them the mute.
CREATE FUNCTION app_kpi_tells_me(kid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_kpi_id_readable(kid) AND EXISTS (SELECT 1 FROM app_kpi_moved_away_audience(kid) a WHERE a.user_id = app_uid())
$$;
--> statement-breakpoint
-- After a value is stored. Only the indicator's latest figure counts: a
-- period filled in or corrected behind a later one says nothing about where
-- the indicator is now. Once per indicator and period: a later correction,
-- either way, tells no one again, and one that brings the figure back to the
-- right side was never a notice. Whoever typed the figure or brought the
-- file in has just seen it and is not told; a sheet read or a system push
-- tells everyone, since no one looked.
CREATE FUNCTION notify_kpi_moved_away() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  k client_kpis;
  past_baseline boolean;
  short_of_target boolean;
  logged integer;
BEGIN
  IF EXISTS (SELECT 1 FROM client_kpi_values v WHERE v.kpi_id = NEW.kpi_id AND v.period > NEW.period) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO k FROM client_kpis WHERE id = NEW.kpi_id;
  past_baseline := app_kpi_wrong_side(k.direction, k.baseline, NEW.value);
  short_of_target := coalesce(k.target_date < app_firm_today(), false) AND app_kpi_wrong_side(k.direction, k.target, NEW.value);
  IF NOT (past_baseline OR short_of_target) THEN
    RETURN NULL;
  END IF;
  INSERT INTO kpi_moved_away_log (kpi_id, period, org_id, value_id) VALUES (NEW.kpi_id, NEW.period, NEW.org_id, NEW.id)
    ON CONFLICT (kpi_id, period) DO NOTHING;
  GET DIAGNOSTICS logged = ROW_COUNT;
  IF logged = 0 THEN
    RETURN NULL;
  END IF;
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT a.user_id, 'indicator.moved_away', 'kpi_value', NEW.id FROM app_kpi_moved_away_audience(NEW.kpi_id) a
    WHERE NEW.channel IN ('sheet', 'api') OR a.user_id IS DISTINCT FROM NEW.entered_by;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER client_kpi_value_moved_away AFTER INSERT ON client_kpi_values FOR EACH ROW EXECUTE FUNCTION notify_kpi_moved_away();
--> statement-breakpoint
-- The log is the database's own bookkeeping, like follow_up_log: no grant to the app.
ALTER TABLE kpi_moved_away_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Muting one indicator, beside muting one action (0019): each person mutes
-- only an indicator they can read, and sees only their own mutes.
ALTER TABLE mail_kpi_mutes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY own ON mail_kpi_mutes TO selah_app USING (user_id = app_uid())
  WITH CHECK (user_id = app_uid() AND app_kpi_id_readable(kpi_id));
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON mail_kpi_mutes TO selah_app;
--> statement-breakpoint
-- The summary mail (latest definition: 0081_owner_actions). The notice goes
-- with the person's reminders, like a quiet client or a drafted status pack,
-- never when they muted the indicator, and only while they are still among
-- the people told about it (so never to someone who can no longer open it).
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
        -- an indicator whose latest value moved away (0120)
        WHEN x.entity_type = 'kpi_value' AND x.kind = 'indicator.moved_away' THEN app_cadence_due(c.reminders, today)
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
REVOKE ALL ON FUNCTION app_queue_digests(date), app_kpi_moved_away_audience(uuid), app_kpi_tells_me(uuid), app_kpi_wrong_side(kpi_direction, numeric, numeric) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_kpi_tells_me(uuid) TO selah_app;