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
-- Whether a figure of an indicator counts as moved away, judged on a day: on
-- the other side of the baseline from the chosen direction, or, once the
-- target date has passed, short of the target.
CREATE FUNCTION app_kpi_moved(kid uuid, v numeric, on_day date) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT app_kpi_wrong_side(k.direction, k.baseline, v)
      OR (coalesce(k.target_date < on_day, false) AND app_kpi_wrong_side(k.direction, k.target, v))
    FROM client_kpis k WHERE k.id = kid), false)
$$;
--> statement-breakpoint
-- A period's current value: the latest one nobody has replaced.
CREATE FUNCTION app_kpi_current_value(kid uuid, p date) RETURNS client_kpi_values
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT v.* FROM client_kpi_values v
  WHERE v.kpi_id = kid AND v.period = p AND NOT EXISTS (SELECT 1 FROM client_kpi_values c WHERE c.supersedes_id = v.id)
  ORDER BY v.entered_at DESC, v.id DESC LIMIT 1
$$;
--> statement-breakpoint
-- Judge one ended period of an indicator, on its current value, once
-- (kpi_moved_away_log). When it moved away the people told get the notice,
-- about that value. Whoever typed the figure or brought the file in has seen
-- it and is not told; a sheet read or a system push tells everyone, since no
-- one looked. Returns whether anyone was told.
CREATE FUNCTION app_kpi_judge(kid uuid, p date, on_day date) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  cur client_kpi_values;
  logged integer;
BEGIN
  cur := app_kpi_current_value(kid, p);
  IF cur.id IS NULL OR NOT app_kpi_moved(kid, cur.value, on_day) THEN
    RETURN false;
  END IF;
  INSERT INTO kpi_moved_away_log (kpi_id, period, org_id, value_id) VALUES (kid, p, cur.org_id, cur.id)
    ON CONFLICT (kpi_id, period) DO NOTHING;
  GET DIAGNOSTICS logged = ROW_COUNT;
  IF logged = 0 THEN
    RETURN false;
  END IF;
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT a.user_id, 'indicator.moved_away', 'kpi_value', cur.id FROM app_kpi_moved_away_audience(kid) a
    WHERE cur.channel IN ('sheet', 'api') OR a.user_id IS DISTINCT FROM cur.entered_by;
  RETURN true;
END $$;
--> statement-breakpoint
-- After a value is stored. A period is judged only once it has ended: a
-- month-to-date figure is never compared with a whole month's baseline, and
-- a value for the running period waits for the monthly job
-- (app_judge_kpi_periods). A value for a period that has ended (a late
-- figure, an import of past months, a correction) is judged now, when it is
-- the latest ended period with a value: one filled in or corrected behind a
-- later ended one says nothing about where the indicator is now. Once per
-- indicator and period: a later correction tells no one again.
CREATE FUNCTION notify_kpi_moved_away() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  step interval;
BEGIN
  step := make_interval(months => app_kpi_months((SELECT k.frequency FROM client_kpis k WHERE k.id = NEW.kpi_id)));
  IF (NEW.period + step)::date > app_firm_today() THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM client_kpi_values v
             WHERE v.kpi_id = NEW.kpi_id AND v.period > NEW.period AND (v.period + step)::date <= app_firm_today()) THEN
    RETURN NULL;
  END IF;
  PERFORM app_kpi_judge(NEW.kpi_id, NEW.period, app_firm_today());
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER client_kpi_value_moved_away AFTER INSERT ON client_kpi_values FOR EACH ROW EXECUTE FUNCTION notify_kpi_moved_away();
--> statement-breakpoint
-- The monthly job, after app_remind_kpis: each active indicator of an
-- active client has its latest ended period with a value judged, if it was
-- not already told; a value saved while that period ran is judged here once
-- the period has ended. Safe to run again. As the schema owner; returns how
-- many periods told someone.
CREATE FUNCTION app_judge_kpi_periods(today date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  IF app_uid() IS NOT NULL THEN
    RAISE EXCEPTION 'periods are judged by the monthly job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR r IN
    SELECT k.id, last.period FROM client_kpis k
      JOIN organizations o ON o.id = k.org_id AND o.status = 'active'
      CROSS JOIN LATERAL (
        SELECT max(v.period) AS period FROM client_kpi_values v
        WHERE v.kpi_id = k.id AND (v.period + make_interval(months => app_kpi_months(k.frequency)))::date <= today
      ) last
    WHERE k.active AND last.period IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM kpi_moved_away_log l WHERE l.kpi_id = k.id AND l.period = last.period)
  LOOP
    IF app_kpi_judge(r.id, r.period, today) THEN
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;
--> statement-breakpoint
-- A notice whose figure a correction has since brought back (the period's
-- current value, judged as of the notice's day, no longer moved away): it no
-- longer states a true figure, so its readers do not see it and it is never
-- mailed. It is kept, not deleted. Only a correction does this (the current
-- value must be another one). For the app, only about an indicator the
-- caller reads; the summary job (no user) asks about any.
CREATE FUNCTION app_kpi_notice_fixed(vid uuid, at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT cur.id IS DISTINCT FROM v.id AND NOT app_kpi_moved(v.kpi_id, cur.value, app_firm_date(at))
    FROM client_kpi_values v CROSS JOIN LATERAL app_kpi_current_value(v.kpi_id, v.period) cur
    WHERE v.id = vid AND (app_uid() IS NULL OR app_kpi_id_readable(v.kpi_id))
  ), false)
$$;
--> statement-breakpoint
CREATE POLICY fixed ON notifications AS RESTRICTIVE FOR SELECT TO selah_app
  USING (entity_type <> 'kpi_value' OR NOT app_kpi_notice_fixed(entity_id, created_at));
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
        -- an indicator whose latest value moved away (0090)
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
      -- Nor one whose figure a correction has since brought back.
      AND NOT (x.entity_type = 'kpi_value' AND app_kpi_notice_fixed(x.entity_id, x.created_at))
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
REVOKE ALL ON FUNCTION app_queue_digests(date), app_kpi_moved_away_audience(uuid), app_kpi_tells_me(uuid), app_kpi_wrong_side(kpi_direction, numeric, numeric),
  app_kpi_moved(uuid, numeric, date), app_kpi_current_value(uuid, date), app_kpi_judge(uuid, date, date), app_judge_kpi_periods(date),
  app_kpi_notice_fixed(uuid, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_kpi_tells_me(uuid), app_kpi_notice_fixed(uuid, timestamptz) TO selah_app;