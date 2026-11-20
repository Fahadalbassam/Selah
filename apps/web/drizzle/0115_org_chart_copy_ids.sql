-- ------------------------------------------ org chart: valid ids for copied rows
-- Scenario 20 (20 Nov 2026): after a version was published, the next draft
-- could not be edited (editing a unit, adding one, inviting someone into a
-- vacant position all answered 400 "invalid input") and the people panel of
-- a position stopped loading from version 2 on. app_org_chart_copy (0091)
-- gave each copied unit and position the id md5(draft id || old id)::uuid:
-- unique and repeatable, but not an RFC 4122 UUID (the version and variant
-- digits are whatever the hash gives), so the routes' z.uuid() refused it.
--
-- 1. The copy keeps its repeatable id (publishPreview() finds a draft unit's
--    source by it: copiedId() in src/services/org-chart.ts), with the version
--    digit set to 3 (name-based, MD5) and the variant bits to 10, so it is a
--    valid UUID.
-- 2. The ids already stored are repaired once (app_org_chart_repair_copied_ids
--    below), in this migration's transaction.
-- Nothing here grants or limits access to any work.

-- 1. A copied row's id: the md5 of the draft's id and the source row's id,
--    with the version and variant bits of a UUID. Internal.
CREATE FUNCTION app_org_chart_copied_id(dst uuid, src uuid) RETURNS uuid
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT (substr(h, 1, 12) || '3' || substr(h, 14, 3)
          || substr('89ab', (position(substr(h, 17, 1) IN '0123456789abcdef') - 1) % 4 + 1, 1)
          || substr(h, 18))::uuid
  FROM (SELECT md5(dst::text || src::text) AS h) x
$$;
--> statement-breakpoint
-- Latest definition: 0091_org_chart. Unchanged apart from the id.
CREATE OR REPLACE FUNCTION app_org_chart_copy(src uuid, dst uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO org_units (id, version_id, org_id, parent_id, kind, code, name_ar, name_en, level, sort_order, advisory, department_id)
    SELECT app_org_chart_copied_id(dst, u.id), dst, u.org_id, NULL, u.kind, u.code, u.name_ar, u.name_en, u.level, u.sort_order, u.advisory,
      CASE WHEN d.active THEN u.department_id END
    FROM org_units u LEFT JOIN departments d ON d.id = u.department_id WHERE u.version_id = src;
  UPDATE org_units n SET parent_id = app_org_chart_copied_id(dst, u.parent_id)
    FROM org_units u WHERE u.version_id = src AND u.parent_id IS NOT NULL AND n.id = app_org_chart_copied_id(dst, u.id);
  INSERT INTO positions (id, version_id, org_id, unit_id, lineage_id, code, title_ar, title_en, reports_to_id, is_head, specialties, planned_count, sort_order)
    SELECT app_org_chart_copied_id(dst, p.id), dst, p.org_id, app_org_chart_copied_id(dst, p.unit_id), p.lineage_id, p.code, p.title_ar, p.title_en,
      NULL, p.is_head, p.specialties, p.planned_count, p.sort_order
    FROM positions p WHERE p.version_id = src;
  UPDATE positions n SET reports_to_id = app_org_chart_copied_id(dst, p.reports_to_id)
    FROM positions p WHERE p.version_id = src AND p.reports_to_id IS NOT NULL AND n.id = app_org_chart_copied_id(dst, p.id);
END $$;
--> statement-breakpoint
-- 2. The repair. Every unit and position a copy made (its id is the old or
--    the new copy id of a row of the version it was based on: publishing and
--    "start again" both copy the current version into the draft) gets
--    app_org_chart_copied_id(its version, its source's repaired id), worked
--    out oldest version first, so a copy of a copy follows its source and
--    publishPreview() still pairs a draft's units with the current version's.
--    Any other id that is not a valid UUID gets a fresh one. A position that
--    starts a lineage (lineage_id = id) keeps its id: holdings and
--    invitations point at it, and no copy ever starts one. Every reference
--    moves with it in the same transaction: a unit's parent, a position's
--    unit and reporting line, the plans of the draft's positions, and the ids
--    inside each published version's frozen snapshot. The audit log is
--    append-only and keeps the ids as they were; so the repair writes one
--    system row per client it changed (org_chart.id_repair, no actor) with
--    how many units and positions it re-ided and every old -> new id, which
--    connects an earlier audit row to today's unit or position.
--
--    The four foreign keys between these rows are dropped and added again
--    (re-checked) around the change, and the tables' own rules (triggers)
--    are off meanwhile: they forbid changing a published version, which is
--    exactly what the repair must do. So the repair holds ACCESS EXCLUSIVE
--    locks on org_units, positions and org_chart_planned_holders, and a
--    SHARE ROW EXCLUSIVE lock on org_chart_versions, until the transaction
--    ends: the org chart is unavailable for that moment (the tables are
--    small: one structure per client). It waits at most 10 seconds for each
--    lock (lock_timeout), so a busy app makes the migration fail fast rather
--    than queue every org chart request behind it: run it with the app
--    stopped (docs/operations.md, Upgrading). A second run would change
--    nothing, but it never runs again: the function is dropped below once it
--    has run. Returns how many ids changed. The schema owner only.
CREATE FUNCTION app_org_chart_repair_copied_ids() RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  ver record;
  m record;
  changed integer;
  prev_timeout text := current_setting('lock_timeout');
  valid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
BEGIN
  -- A working table, dropped before the end (the schema owner may not create temporary tables).
  CREATE TABLE org_chart_id_fix (kind text, version_id uuid, old_id uuid, src_old uuid, keep boolean, new_id uuid, PRIMARY KEY (kind, old_id));
  INSERT INTO org_chart_id_fix (kind, version_id, old_id, src_old, keep)
    SELECT 'unit', u.version_id, u.id,
      (SELECT s.id FROM org_units s
       WHERE s.version_id = v.based_on_id
         AND u.id IN (md5(u.version_id::text || s.id::text)::uuid, app_org_chart_copied_id(u.version_id, s.id))
       LIMIT 1),
      false
    FROM org_units u JOIN org_chart_versions v ON v.id = u.version_id;
  INSERT INTO org_chart_id_fix (kind, version_id, old_id, src_old, keep)
    SELECT 'position', p.version_id, p.id,
      (SELECT s.id FROM positions s
       WHERE s.version_id = v.based_on_id AND p.lineage_id <> p.id
         AND p.id IN (md5(p.version_id::text || s.id::text)::uuid, app_org_chart_copied_id(p.version_id, s.id))
       LIMIT 1),
      p.lineage_id = p.id
    FROM positions p JOIN org_chart_versions v ON v.id = p.version_id;
  -- A copy's source is a published (numbered) version, so numbered versions first, in order, then the drafts.
  FOR ver IN SELECT x.id FROM org_chart_versions x ORDER BY x.number NULLS LAST, x.created_at, x.id LOOP
    UPDATE org_chart_id_fix f SET new_id = CASE
        WHEN f.keep THEN f.old_id
        WHEN f.src_old IS NOT NULL THEN app_org_chart_copied_id(f.version_id,
          (SELECT g.new_id FROM org_chart_id_fix g WHERE g.kind = f.kind AND g.old_id = f.src_old))
        WHEN f.old_id::text !~ valid THEN gen_random_uuid()
        ELSE f.old_id END
      WHERE f.version_id = ver.id;
  END LOOP;
  IF EXISTS (SELECT 1 FROM org_chart_id_fix WHERE new_id IS NULL) THEN
    RAISE EXCEPTION 'org chart id repair: a copied row whose source was not repaired first';
  END IF;
  IF EXISTS (SELECT 1 FROM org_chart_id_fix WHERE keep AND old_id::text !~ valid) THEN
    RAISE WARNING 'org chart id repair: a position that starts a lineage keeps an id that is not a valid UUID';
  END IF;
  DELETE FROM org_chart_id_fix WHERE new_id = old_id;
  SELECT count(*) INTO changed FROM org_chart_id_fix;
  IF changed = 0 THEN
    DROP TABLE org_chart_id_fix;
    RETURN 0;
  END IF;

  PERFORM set_config('lock_timeout', '10s', true);
  ALTER TABLE org_units DISABLE TRIGGER USER;
  ALTER TABLE positions DISABLE TRIGGER USER;
  ALTER TABLE org_chart_planned_holders DISABLE TRIGGER USER;
  ALTER TABLE org_chart_versions DISABLE TRIGGER USER;
  ALTER TABLE org_units DROP CONSTRAINT org_units_parent_id_org_units_id_fk;
  ALTER TABLE positions DROP CONSTRAINT positions_unit_id_org_units_id_fk;
  ALTER TABLE positions DROP CONSTRAINT positions_reports_to_id_positions_id_fk;
  ALTER TABLE org_chart_planned_holders DROP CONSTRAINT org_chart_planned_holders_position_id_positions_id_fk;

  UPDATE org_units u SET id = f.new_id FROM org_chart_id_fix f WHERE f.kind = 'unit' AND u.id = f.old_id;
  UPDATE org_units u SET parent_id = f.new_id FROM org_chart_id_fix f WHERE f.kind = 'unit' AND u.parent_id = f.old_id;
  UPDATE positions p SET id = f.new_id FROM org_chart_id_fix f WHERE f.kind = 'position' AND p.id = f.old_id;
  UPDATE positions p SET unit_id = f.new_id FROM org_chart_id_fix f WHERE f.kind = 'unit' AND p.unit_id = f.old_id;
  UPDATE positions p SET reports_to_id = f.new_id FROM org_chart_id_fix f WHERE f.kind = 'position' AND p.reports_to_id = f.old_id;
  UPDATE org_chart_planned_holders h SET position_id = f.new_id FROM org_chart_id_fix f WHERE f.kind = 'position' AND h.position_id = f.old_id;
  -- A snapshot holds its own version's ids only (app_org_chart_snapshot_of).
  FOR m IN SELECT f.version_id, f.old_id, f.new_id FROM org_chart_id_fix f LOOP
    UPDATE org_chart_versions x SET published_snapshot = replace(x.published_snapshot::text, m.old_id::text, m.new_id::text)::jsonb
      WHERE x.id = m.version_id AND x.published_snapshot IS NOT NULL;
  END LOOP;

  ALTER TABLE org_units ADD CONSTRAINT org_units_parent_id_org_units_id_fk
    FOREIGN KEY (parent_id) REFERENCES org_units(id) ON DELETE no action ON UPDATE no action;
  ALTER TABLE positions ADD CONSTRAINT positions_unit_id_org_units_id_fk
    FOREIGN KEY (unit_id) REFERENCES org_units(id) ON DELETE cascade ON UPDATE no action;
  ALTER TABLE positions ADD CONSTRAINT positions_reports_to_id_positions_id_fk
    FOREIGN KEY (reports_to_id) REFERENCES positions(id) ON DELETE no action ON UPDATE no action;
  ALTER TABLE org_chart_planned_holders ADD CONSTRAINT org_chart_planned_holders_position_id_positions_id_fk
    FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE cascade ON UPDATE no action;
  ALTER TABLE org_units ENABLE TRIGGER USER;
  ALTER TABLE positions ENABLE TRIGGER USER;
  ALTER TABLE org_chart_planned_holders ENABLE TRIGGER USER;
  ALTER TABLE org_chart_versions ENABLE TRIGGER USER;
  PERFORM set_config('lock_timeout', prev_timeout, true);
  -- One system row per client: the counts and the old -> new ids (a structure is small: one client's units and positions).
  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
    SELECT NULL, c.org_id, 'org_chart.id_repair', 'org_chart', c.id, 'allow',
      jsonb_build_object('client', c.org_id, 'migration', '0115',
        'units', count(*) FILTER (WHERE f.kind = 'unit'), 'positions', count(*) FILTER (WHERE f.kind = 'position'),
        'ids', jsonb_agg(jsonb_build_object('kind', f.kind, 'old', f.old_id, 'new', f.new_id, 'version', f.version_id) ORDER BY f.kind, f.old_id))
    FROM org_chart_id_fix f JOIN org_chart_versions v ON v.id = f.version_id JOIN org_charts c ON c.id = v.chart_id
    GROUP BY c.org_id, c.id;
  DROP TABLE org_chart_id_fix;
  RETURN changed;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_org_chart_copied_id(uuid, uuid), app_org_chart_repair_copied_ids() FROM PUBLIC;
--> statement-breakpoint
SELECT app_org_chart_repair_copied_ids();
--> statement-breakpoint
-- Once only: never run again on later data.
DROP FUNCTION app_org_chart_repair_copied_ids();
