-- ------------------------------------------ org chart, part 5: publishing
-- Approved 17 Nov 2026 (gate A follow-ups, section 3, new feature B), part 5
-- of 5: the publishing screen, the client's view, change requests, the
-- department-head suggestion. Two rules change in the database:
--   - publishing places the people planned for the draft's positions
--     (org_chart_planned_holders, part 4) in those positions from the day the
--     version takes effect, each re-checked first, then clears the plans
--     (review B2 of part 4, and its re-check N-S1: "turn the planned holders
--     into holdings from the effective date, tell the lead once, and clear
--     the plans");
--   - a version takes effect on or after the day the current one did, so the
--     versions stay in order (versionStatus() reads them by number);
-- and a suggestion the firm answers tells the person who made it.
-- Nothing here grants or limits access to any work.

-- 1. What publishing will do with each plan of a draft, on a day: 'place'
--    (the person is placed from that day), 'left' (an account that is no
--    longer one of the client's active people: skipped), or 'holds' (the
--    person already holds that position on that day or later: skipped), or
--    'filled' (a one-person position someone else is already due to take
--    on that day or later: skipped). Placing someone follows changeHolder()
--    (review S1): in a one-person position, whoever holds it with no end
--    date and started before that day leaves it the day before; `leaving`
--    names them, `one_person` says the rule applies. Names included, so for
--    the draft's editors only (the people who read the plans); nothing for
--    anyone else or for a version that is not the draft. The publishing
--    screen lists it before the publisher confirms, and
--    app_publish_org_chart() works it out again inside its lock.
CREATE FUNCTION app_org_chart_plan_outcomes(p_draft uuid, p_effective date)
RETURNS TABLE (plan_id uuid, position_id uuid, lineage_id uuid, code text, user_id uuid, name text, outcome text, one_person boolean, leaving text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT h.id, p.id, p.lineage_id, p.code, h.user_id, coalesce(h.name, u.name),
    CASE
      WHEN h.user_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM org_memberships m WHERE m.user_id = h.user_id AND m.org_id = v.org_id AND m.active) THEN 'left'
      WHEN EXISTS (
        SELECT 1 FROM position_holders x
        WHERE x.position_lineage_id = p.lineage_id
          AND ((h.user_id IS NOT NULL AND x.user_id = h.user_id) OR (h.name IS NOT NULL AND lower(x.name) = lower(h.name)))
          AND (x.to_date IS NULL OR x.to_date >= p_effective)) THEN 'holds'
      WHEN p.planned_count = 1 AND EXISTS (
        SELECT 1 FROM position_holders x
        WHERE x.position_lineage_id = p.lineage_id AND x.to_date IS NULL AND x.from_date >= p_effective) THEN 'filled'
      ELSE 'place'
    END,
    p.planned_count = 1,
    CASE WHEN p.planned_count = 1 THEN ARRAY(
      SELECT coalesce(x.name, xu.name) FROM position_holders x LEFT JOIN "user" xu ON xu.id = x.user_id
      WHERE x.position_lineage_id = p.lineage_id AND x.to_date IS NULL AND x.from_date < p_effective
      ORDER BY x.from_date) ELSE '{}'::text[] END
  FROM org_chart_versions v
    JOIN positions p ON p.version_id = v.id
    JOIN org_chart_planned_holders h ON h.position_id = p.id
    LEFT JOIN "user" u ON u.id = h.user_id
  WHERE v.id = p_draft AND v.state = 'draft' AND p_effective IS NOT NULL AND app_org_chart_editor(v.org_id)
  ORDER BY p.sort_order, p.code, h.sort_order
$$;
--> statement-breakpoint
-- 2. Publishing. Latest definition: 0097_org_chart_editor; unchanged apart
--    from the day it takes effect (on or after the current version's), and
--    the plans: worked out before the draft becomes the published version,
--    then each 'place' becomes a holding from the effective day (through
--    check_position_holder(), like any holding, and notify_position_holder()
--    tells the client's lead and deputy), the others are skipped, and every
--    plan of the published draft is removed before the copy that becomes the
--    next draft is made (so none follows it: carry_plans_to_draft()). The
--    audit row counts placed and skipped plans, never a name.
CREATE OR REPLACE FUNCTION app_publish_org_chart(cid uuid, p_draft uuid, p_effective date, p_resolution uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c org_charts;
  d org_chart_versions;
  prev_names boolean;
  prev_effective date;
  next_number integer;
  fresh uuid;
  plans jsonb;
  r record;
  ended record;
  placed integer := 0;
  skipped integer := 0;
BEGIN
  SELECT * INTO c FROM org_charts WHERE id = cid;
  IF c.id IS NULL OR NOT app_org_chart_publisher(c.org_id) THEN
    RAISE EXCEPTION 'no such structure' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_effective IS NULL THEN
    RAISE EXCEPTION 'give the day the structure takes effect' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('org_chart'), hashtext(cid::text));
  SELECT * INTO d FROM org_chart_versions v WHERE v.chart_id = cid AND v.state = 'draft' FOR UPDATE;
  IF d.id IS DISTINCT FROM p_draft THEN
    RAISE EXCEPTION 'this draft is no longer the current one; reload the page' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM org_units u WHERE u.version_id = d.id) THEN
    RAISE EXCEPTION 'the draft has no units yet' USING ERRCODE = 'check_violation';
  END IF;
  IF p_resolution IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM documents x WHERE x.id = p_resolution AND x.org_id = c.org_id AND x.visibility = 'shared' AND x.state <> 'archived') THEN
    RAISE EXCEPTION 'the resolution must be a file of this client that the client can see' USING ERRCODE = 'check_violation';
  END IF;
  SELECT v.show_names, v.effective_on INTO prev_names, prev_effective FROM org_chart_versions v WHERE v.chart_id = cid AND v.state = 'published';
  -- Never back-dated (review B1): today or later, and on or after the day the current version took effect.
  IF p_effective < greatest(coalesce(prev_effective, app_firm_today()), app_firm_today()) THEN
    RAISE EXCEPTION 'a new version takes effect today or later, and on or after the day the current one did' USING ERRCODE = 'check_violation';
  END IF;
  -- The plans, while the version is still the draft (the list reads drafts only).
  SELECT coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) INTO plans FROM app_org_chart_plan_outcomes(d.id, p_effective) o;
  UPDATE org_chart_versions SET state = 'superseded', superseded_at = now() WHERE chart_id = cid AND state = 'published';
  SELECT coalesce(max(v.number), 0) + 1 INTO next_number FROM org_chart_versions v WHERE v.chart_id = cid;
  -- close_dropped_holdings() runs here, as the draft becomes the published version.
  UPDATE org_chart_versions SET state = 'published', number = next_number, effective_on = p_effective,
      published_by = app_uid(), published_at = now(), resolution_document_id = p_resolution,
      show_names = coalesce(prev_names, false), published_snapshot = app_org_chart_snapshot_of(d.id)
    WHERE id = d.id;
  FOR r IN SELECT * FROM jsonb_to_recordset(plans) AS x(lineage_id uuid, user_id uuid, name text, outcome text, one_person boolean) LOOP
    IF r.outcome = 'place' THEN
      -- A one-person position changes hands as changeHolder() does it (review S1): the holder leaves the day before.
      IF r.one_person THEN
        FOR ended IN
          UPDATE position_holders x SET to_date = p_effective - 1
          WHERE x.position_lineage_id = r.lineage_id AND x.to_date IS NULL AND x.from_date < p_effective
          RETURNING x.id
        LOOP
          INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
            VALUES (app_uid(), coalesce(app_org(), c.org_id), 'org_chart.holder_end', 'org_chart', r.lineage_id, 'allow',
              jsonb_build_object('client', c.org_id, 'holder', ended.id, 'on', p_effective - 1, 'version', d.id));
        END LOOP;
      END IF;
      INSERT INTO position_holders (chart_id, org_id, position_lineage_id, user_id, name, from_date, created_by)
        VALUES (cid, c.org_id, r.lineage_id, r.user_id, CASE WHEN r.user_id IS NULL THEN r.name END, p_effective, app_uid());
      placed := placed + 1;
    ELSE
      skipped := skipped + 1;
    END IF;
  END LOOP;
  DELETE FROM org_chart_planned_holders h USING positions p WHERE h.position_id = p.id AND p.version_id = d.id;
  IF placed + skipped > 0 THEN
    INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
      VALUES (app_uid(), coalesce(app_org(), c.org_id), 'org_chart.plan', 'org_chart', d.id, 'allow',
        jsonb_build_object('client', c.org_id, 'published', true, 'placed', placed, 'skipped', skipped, 'on', p_effective));
  END IF;
  INSERT INTO org_chart_versions (chart_id, org_id, state, based_on_id, created_by)
    VALUES (cid, c.org_id, 'draft', d.id, app_uid()) RETURNING id INTO fresh;
  PERFORM app_org_chart_copy(d.id, fresh);
  RETURN d.id;
END $$;
--> statement-breakpoint
-- 2b. The positions a new version drops (latest definition:
--     0097_org_chart_editor). Defence in depth beside the rule above (the
--     lead's decision on review B1): publishing never deletes a holding that
--     has started. One that started by the day before the new version takes
--     effect ends that day, as before; one that started after it but by
--     today (only possible when the version takes effect today) ends on the
--     day it started; only a holding that has not started yet, after both,
--     is removed (it never took effect), counted without names.
CREATE OR REPLACE FUNCTION close_dropped_holdings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  h record;
  n integer;
  e date := NEW.effective_on - 1;
  started date := greatest(NEW.effective_on - 1, app_firm_today());
  changed boolean := false;
BEGIN
  PERFORM set_config('selah.publishing', NEW.chart_id::text, true);
  FOR h IN
    UPDATE position_holders x SET to_date = greatest(x.from_date, e)
    WHERE x.chart_id = NEW.chart_id AND x.from_date <= started AND (x.to_date IS NULL OR x.to_date > greatest(x.from_date, e))
      AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.version_id = NEW.id AND p.lineage_id = x.position_lineage_id)
    RETURNING x.id, x.org_id, x.position_lineage_id, x.to_date
  LOOP
    changed := true;
    INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
      VALUES (app_uid(), coalesce(app_org(), NEW.org_id), 'org_chart.holder_end', 'org_chart', h.position_lineage_id, 'allow',
        jsonb_build_object('client', h.org_id, 'holder', h.id, 'on', h.to_date, 'version', NEW.id));
  END LOOP;
  PERFORM set_config('selah.publishing', '', true);
  WITH gone AS (
    DELETE FROM position_holders x
    WHERE x.chart_id = NEW.chart_id AND x.from_date > started
      AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.version_id = NEW.id AND p.lineage_id = x.position_lineage_id)
    RETURNING 1
  ) SELECT count(*) INTO n FROM gone;
  IF n > 0 THEN
    changed := true;
    INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
      VALUES (app_uid(), coalesce(app_org(), NEW.org_id), 'org_chart.holder_cancel', 'org_chart', NEW.org_id, 'allow',
        jsonb_build_object('client', NEW.org_id, 'count', n, 'version', NEW.id));
  END IF;
  IF changed THEN
    PERFORM app_org_chart_tell_lead(NEW.org_id, app_uid());
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- 3. A suggestion the firm answers (done or declined) tells the client's
--    person who made it, in Selah, while they are still one of its people:
--    a plain notice, without the text (read on the Structure tab).
CREATE FUNCTION notify_org_chart_request_answered() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT NEW.created_by, 'org_chart.request_' || NEW.status::text, 'organization', NEW.org_id
    WHERE EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = NEW.created_by AND m.org_id = NEW.org_id AND m.active);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER org_chart_change_request_answered AFTER UPDATE OF status ON org_chart_change_requests
  FOR EACH ROW WHEN (OLD.status = 'open' AND NEW.status <> 'open') EXECUTE FUNCTION notify_org_chart_request_answered();
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_org_chart_plan_outcomes(uuid, date), notify_org_chart_request_answered() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_org_chart_plan_outcomes(uuid, date) TO selah_app;
