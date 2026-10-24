ALTER TABLE "projects" ADD COLUMN "sequence" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "planned_working_days" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "follows_project_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_follows_project_id_projects_id_fk" FOREIGN KEY ("follows_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_sequence_range" CHECK ("projects"."sequence" BETWEEN 1 AND 99);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_planned_days_range" CHECK ("projects"."planned_working_days" BETWEEN 1 AND 1000);--> statement-breakpoint
-- Client people on projects and several projects per client (wave 1, items
-- 1 and 2 of the full picture, 2026-10-24).
--
-- 1. Client managers and action owners see only the projects they are on,
--    but nothing in the app could put them there. The firm admin and the
--    client's own admin already may (member_insert); the client's lead
--    consultant now may too, for that client's own people, because the lead
--    runs the engagement. Removing someone who still owns open actions on
--    the project is refused, so an action never loses its owner silently.
DROP POLICY member_insert ON project_members;
--> statement-breakpoint
CREATE POLICY member_insert ON project_members FOR INSERT TO selah_app WITH CHECK (
  (app_can_see_project(project_id) AND (
    (app_role() = 'firm_admin' AND (
      app_project_kind(project_id) = 'internal'
      OR user_id = app_uid()
      OR app_user_org(user_id) = app_project_org(project_id)
      OR app_on_client_team(user_id, app_project_org(project_id))))
    OR (app_role() = 'client_admin' AND app_user_org(user_id) = app_org() AND NOT is_lead)
    OR (app_is_project_lead(project_id) AND app_user_org(user_id) = app_org())
    OR (app_project_kind(project_id) = 'client' AND app_is_client_lead(app_project_org(project_id)) AND NOT is_lead
        AND (app_on_client_team(user_id, app_project_org(project_id)) OR app_user_org(user_id) = app_project_org(project_id)))
  ))
  OR (user_id = app_uid() AND is_lead AND app_can_claim_project(project_id))
);
--> statement-breakpoint
DROP POLICY member_delete ON project_members;
--> statement-breakpoint
CREATE POLICY member_delete ON project_members FOR DELETE TO selah_app USING (
  app_can_see_project(project_id) AND (
    app_role() = 'firm_admin'
    OR (app_role() = 'client_admin' AND app_user_org(user_id) = app_org())
    OR (app_is_project_lead(project_id) AND user_id <> app_uid())
    OR (app_project_kind(project_id) = 'client' AND app_is_client_lead(app_project_org(project_id)) AND user_id <> app_uid()
        AND (app_user_org(user_id) = app_org() OR app_user_org(user_id) = app_project_org(project_id)))
  )
);
--> statement-breakpoint
CREATE FUNCTION check_member_removal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Jobs, seeds and cascades from a deleted project are trusted.
  IF app_uid() IS NULL OR NOT EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id) THEN
    RETURN OLD;
  END IF;
  IF EXISTS (
    SELECT 1 FROM actions a
    WHERE a.project_id = OLD.project_id AND a.owner_user_id = OLD.user_id
      AND app_action_open(a.status)
  ) THEN
    RAISE EXCEPTION 'this person still owns open actions on the project: reassign them first' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_member_removal() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER member_removal BEFORE DELETE ON project_members FOR EACH ROW EXECUTE FUNCTION check_member_removal();
--> statement-breakpoint
-- 2. A client has many projects (option B): one per phase or separately
--    agreed scope. The firm admin creates them, and so does the client's
--    lead consultant, for that client only.
DROP POLICY project_insert ON projects;
--> statement-breakpoint
CREATE POLICY project_insert ON projects FOR INSERT TO selah_app WITH CHECK (
  firm_org_id = app_org() AND (
    app_role() = 'firm_admin'
    OR (app_role() = 'consultant' AND kind = 'internal' AND created_by = app_uid())
    OR (app_role() = 'consultant' AND kind = 'client' AND created_by = app_uid() AND app_is_client_lead(org_id))
  )
);
--> statement-breakpoint
-- A project continues an earlier project of the same client, never itself
-- or one that (through others) continues it.
CREATE FUNCTION check_project_follows() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.follows_project_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.kind <> 'client' OR NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.id = NEW.follows_project_id AND p.org_id = NEW.org_id AND p.kind = 'client'
  ) THEN
    RAISE EXCEPTION 'a project can only follow another project of the same client' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    WITH RECURSIVE chain(id) AS (
      SELECT NEW.follows_project_id
      UNION
      SELECT p.follows_project_id FROM projects p JOIN chain c ON p.id = c.id WHERE p.follows_project_id IS NOT NULL
    )
    SELECT 1 FROM chain WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'a project cannot follow itself or a project that follows it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_project_follows() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER project_follows BEFORE INSERT OR UPDATE OF follows_project_id, org_id ON projects
  FOR EACH ROW EXECUTE FUNCTION check_project_follows();
