-- Plans follow the draft (org chart, part 4; the coordinator's decision of
-- 19 Nov 2026 after the privacy recheck, N-S1): until part 5 builds
-- publishing that places planned people, publishing never leaves a plan on
-- the published version. The copy that becomes the next draft takes the
-- plans of the positions it carries on (same lineage), so nothing is lost
-- and no client reader ever reads one. Minimal records counts plans on the
-- draft only.
--
-- 1. A plan is replaced, never changed, except to follow its position into
--    the next draft: the same position (lineage), on a draft. Latest
--    definition: 0098_org_chart_planned_holders; unchanged otherwise.
CREATE OR REPLACE FUNCTION check_planned_holder() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  st org_chart_state;
  vorg uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'position_id') <> (to_jsonb(OLD) - 'position_id') OR NOT EXISTS (
      SELECT 1 FROM positions n JOIN positions o ON o.lineage_id = n.lineage_id
      JOIN org_chart_versions v ON v.id = n.version_id
      WHERE n.id = NEW.position_id AND o.id = OLD.position_id AND v.state = 'draft') THEN
      RAISE EXCEPTION 'a planned holder is replaced, never changed' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT v.state, v.org_id INTO st, vorg
  FROM positions p JOIN org_chart_versions v ON v.id = p.version_id
  WHERE p.id = NEW.position_id
  FOR SHARE OF v;
  IF st IS NULL THEN
    RAISE EXCEPTION 'no such position' USING ERRCODE = 'check_violation';
  END IF;
  IF st <> 'draft' THEN
    RAISE EXCEPTION 'people are planned only for positions of the draft' USING ERRCODE = 'check_violation';
  END IF;
  NEW.org_id := vorg;
  IF coalesce((SELECT o.minimal_records FROM organizations o WHERE o.id = vorg), false) THEN
    RAISE EXCEPTION 'this client keeps minimal records: its structure has titles only, no names' USING ERRCODE = 'check_violation';
  END IF;
  NEW.name := nullif(btrim(NEW.name), '');
  IF NEW.user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM org_memberships m WHERE m.user_id = NEW.user_id AND m.org_id = vorg AND m.active) THEN
    RAISE EXCEPTION 'a planned holder is one of the client''s own active people, or a typed name' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('planned_holder'), hashtext(NEW.position_id::text));
  IF EXISTS (
    SELECT 1 FROM org_chart_planned_holders h
    WHERE h.position_id = NEW.position_id AND (h.user_id = NEW.user_id OR lower(h.name) = lower(NEW.name))) THEN
    RAISE EXCEPTION 'this person is already planned for the position' USING ERRCODE = 'check_violation';
  END IF;
  NEW.created_by := coalesce(app_uid(), NEW.created_by);
  NEW.created_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
-- 2. A position copied into a new draft (publishing, app_org_chart_copy)
--    takes the plans of the same position on the versions before it.
CREATE FUNCTION carry_plans_to_draft() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (SELECT v.state FROM org_chart_versions v WHERE v.id = NEW.version_id) IS DISTINCT FROM 'draft' THEN
    RETURN NULL;
  END IF;
  UPDATE org_chart_planned_holders h SET position_id = NEW.id
  FROM positions o JOIN org_chart_versions v ON v.id = o.version_id
  WHERE h.position_id = o.id AND o.lineage_id = NEW.lineage_id AND o.id <> NEW.id AND v.state <> 'draft';
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER planned_holders_follow AFTER INSERT ON positions FOR EACH ROW EXECUTE FUNCTION carry_plans_to_draft();
--> statement-breakpoint
-- Plans left on a published or past version before this migration move to the draft's position of the same lineage, or go.
UPDATE org_chart_planned_holders h SET position_id = d.id
FROM positions o JOIN org_chart_versions ov ON ov.id = o.version_id,
     positions d JOIN org_chart_versions dv ON dv.id = d.version_id
WHERE h.position_id = o.id AND ov.state <> 'draft' AND dv.state = 'draft' AND d.lineage_id = o.lineage_id AND dv.chart_id = ov.chart_id;
--> statement-breakpoint
DELETE FROM org_chart_planned_holders h USING positions o, org_chart_versions v
WHERE h.position_id = o.id AND v.id = o.version_id AND v.state <> 'draft';
--> statement-breakpoint
-- 3. Minimal records (latest definition: 0098_org_chart_planned_holders):
--    plans count on the draft only (the only place a plan now lives).
CREATE OR REPLACE FUNCTION check_minimal_records() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE switched boolean := CASE WHEN TG_OP = 'INSERT' THEN NEW.minimal_records OR NEW.display_alias IS NOT NULL
  ELSE NEW.minimal_records IS DISTINCT FROM OLD.minimal_records OR NEW.display_alias IS DISTINCT FROM OLD.display_alias END;
BEGIN
  IF switched AND app_uid() IS NOT NULL AND app_role() IS DISTINCT FROM 'firm_admin' THEN
    RAISE EXCEPTION 'only the firm admin sets minimal records' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT NEW.minimal_records THEN
    RETURN NEW;
  END IF;
  IF NEW.engagement_mode IS DISTINCT FROM 'consultant_managed' THEN
    RAISE EXCEPTION 'minimal records are for clients the firm manages' USING ERRCODE = 'check_violation';
  END IF;
  IF nullif(trim(NEW.display_alias), '') IS NULL THEN
    RAISE EXCEPTION 'give the client an alias' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' OR NOT OLD.minimal_records THEN
    IF EXISTS (SELECT 1 FROM client_contacts c WHERE c.org_id = NEW.id) OR EXISTS (SELECT 1 FROM documents d WHERE d.org_id = NEW.id) THEN
      RAISE EXCEPTION 'remove the client''s contacts and files before switching to minimal records' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM position_holders h WHERE h.org_id = NEW.id)
       OR EXISTS (
         SELECT 1 FROM org_chart_planned_holders h JOIN positions p ON p.id = h.position_id
         JOIN org_chart_versions v ON v.id = p.version_id
         WHERE h.org_id = NEW.id AND v.state = 'draft') THEN
      RAISE EXCEPTION 'remove the names of people from the client''s structure before switching to minimal records' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.display_alias := trim(NEW.display_alias);
  NEW.name := NEW.display_alias;
  NEW.name_ar := NEW.display_alias;
  RETURN NEW;
END $$;
