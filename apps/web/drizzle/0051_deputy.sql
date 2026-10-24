ALTER TABLE "client_assignments" ADD COLUMN "is_deputy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "client_assignments_one_deputy" ON "client_assignments" USING btree ("client_org_id") WHERE "client_assignments"."is_deputy";--> statement-breakpoint
ALTER TABLE "client_assignments" ADD CONSTRAINT "client_assignment_lead_or_deputy" CHECK (NOT ("client_assignments"."is_lead" AND "client_assignments"."is_deputy"));--> statement-breakpoint
-- ------------------------------------------------ deputy consultant (F18)
-- A client may have one deputy consultant, named by the firm admin: a full
-- backup for the lead. The deputy can do what the lead can (every lead check
-- goes through app_is_client_lead) and gets the lead's alerts. The lead stays
-- the one accountable name; only the admin names or removes either.
CREATE OR REPLACE FUNCTION app_is_client_lead(client uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = client AND ca.user_id = app_uid() AND (ca.is_lead OR ca.is_deputy)
  )
$$;
--> statement-breakpoint
-- A lead (or the deputy) adds consultants, never a lead or a deputy.
DROP POLICY assignment_insert ON client_assignments;
--> statement-breakpoint
CREATE POLICY assignment_insert ON client_assignments FOR INSERT TO selah_app WITH CHECK (
  app_user_org(user_id) = app_org() AND app_is_active_client(client_org_id) AND (
    app_role() = 'firm_admin'
    OR (app_is_client_lead(client_org_id) AND NOT is_lead AND NOT is_deputy)
  )
);
--> statement-breakpoint
-- A lead (or the deputy) removes other consultants, never the lead or the deputy.
DROP POLICY assignment_delete ON client_assignments;
--> statement-breakpoint
CREATE POLICY assignment_delete ON client_assignments FOR DELETE TO selah_app USING (
  (app_role() = 'firm_admin' AND app_can_see_org(client_org_id))
  OR (app_is_client_lead(client_org_id) AND NOT is_lead AND NOT is_deputy AND user_id <> app_uid())
);
--> statement-breakpoint
-- The deputy who becomes the lead (by the admin or a handover) stops being the deputy.
CREATE FUNCTION lead_is_not_deputy() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.is_lead THEN
    NEW.is_deputy := false;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER lead_is_not_deputy BEFORE INSERT OR UPDATE OF is_lead ON client_assignments
  FOR EACH ROW EXECUTE FUNCTION lead_is_not_deputy();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_project_observer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT NEW.observer THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM projects p JOIN org_memberships m ON m.org_id = p.firm_org_id AND m.user_id = NEW.user_id AND m.active AND m.role = 'consultant'
    WHERE p.id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'an observer is a consultant of the firm' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM projects p JOIN client_assignments ca ON ca.client_org_id = p.org_id AND ca.user_id = NEW.user_id AND (ca.is_lead OR ca.is_deputy)
    WHERE p.id = NEW.project_id AND p.kind = 'client'
  ) THEN
    RAISE EXCEPTION 'the client''s lead or deputy consultant works on its projects, not as an observer' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM actions a WHERE a.project_id = NEW.project_id AND a.owner_user_id = NEW.user_id AND app_action_open(a.status)
  ) THEN
    RAISE EXCEPTION 'hand over their open actions here before making them an observer' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Becoming the client's lead or deputy ends observing its projects.
CREATE OR REPLACE FUNCTION end_observing_as_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.is_lead OR NEW.is_deputy THEN
    UPDATE project_members pm SET observer = false FROM projects p
      WHERE p.id = pm.project_id AND p.org_id = NEW.client_org_id AND pm.user_id = NEW.user_id AND pm.observer;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER client_lead_not_observer ON client_assignments;
--> statement-breakpoint
CREATE TRIGGER client_lead_not_observer AFTER INSERT OR UPDATE OF is_lead, is_deputy ON client_assignments
  FOR EACH ROW EXECUTE FUNCTION end_observing_as_lead();
--> statement-breakpoint
-- The alerts the lead gets for being the lead (follow-up and request
-- reminders and escalations, a quiet client, a drafted status pack) go to
-- the client's active deputy too, once.
CREATE FUNCTION app_lead_alert_kind(k text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT k LIKE 'follow\_up.%' OR k LIKE 'info\_request.%' OR k IN ('project.client_quiet', 'report.pack_drafted')
$$;
--> statement-breakpoint
CREATE FUNCTION copy_lead_alert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE client uuid;
BEGIN
  IF NOT app_lead_alert_kind(NEW.kind) THEN
    RETURN NULL;
  END IF;
  client := CASE NEW.entity_type
    WHEN 'action' THEN (SELECT p.org_id FROM actions a JOIN projects p ON p.id = a.project_id WHERE a.id = NEW.entity_id AND p.kind = 'client')
    WHEN 'recommendation' THEN (SELECT p.org_id FROM recommendations r JOIN projects p ON p.id = r.project_id WHERE r.id = NEW.entity_id AND p.kind = 'client')
    WHEN 'project' THEN (SELECT p.org_id FROM projects p WHERE p.id = NEW.entity_id AND p.kind = 'client')
  END;
  IF client IS NULL OR NOT EXISTS (
    SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = client AND ca.user_id = NEW.user_id AND ca.is_lead
  ) THEN
    RETURN NULL;
  END IF;
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT d.user_id, NEW.kind, NEW.entity_type, NEW.entity_id
    FROM client_assignments d JOIN org_memberships m ON m.user_id = d.user_id AND m.active
    WHERE d.client_org_id = client AND d.is_deputy
      AND NOT EXISTS (
        SELECT 1 FROM notifications x WHERE x.user_id = d.user_id AND x.kind = NEW.kind
          AND x.entity_id = NEW.entity_id AND x.created_at = NEW.created_at);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER copy_lead_alert AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION copy_lead_alert();
