CREATE TYPE "public"."client_role" AS ENUM('sponsor', 'coordinator', 'steering', 'acceptor', 'observer');--> statement-breakpoint
CREATE TABLE "project_client_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"role" "client_role" NOT NULL,
	"user_id" uuid,
	"contact_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_client_role_person" CHECK ((user_id IS NULL) <> (contact_id IS NULL))
);
--> statement-breakpoint
ALTER TABLE "project_client_roles" ADD CONSTRAINT "project_client_roles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_client_roles" ADD CONSTRAINT "project_client_roles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_client_roles" ADD CONSTRAINT "project_client_roles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_client_roles" ADD CONSTRAINT "project_client_roles_contact_id_client_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_client_roles" ADD CONSTRAINT "project_client_roles_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_client_roles_project_idx" ON "project_client_roles" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_client_roles_user_unique" ON "project_client_roles" USING btree ("project_id","role","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_client_roles_contact_unique" ON "project_client_roles" USING btree ("project_id","role","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_client_roles_single" ON "project_client_roles" USING btree ("project_id","role") WHERE role IN ('sponsor', 'coordinator');--> statement-breakpoint
-- ------------------------------------------------------ client roles
-- Who is who on the client's side of a project (wave 1, item 6). A role is
-- held by a client account or, in any mode, by a client contact with no
-- account. The sponsor, coordinator and acceptors with an account are the
-- client's admins or managers; steering and observers may be any account.

GRANT SELECT, INSERT, DELETE ON project_client_roles TO selah_app;
--> statement-breakpoint
ALTER TABLE project_client_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Who names the client's roles: the firm admin, the client's lead
-- consultant, and the client's own admin (accounts only: contacts are the
-- firm's records).
CREATE FUNCTION app_can_manage_client_roles(pid uuid, by_contact boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = pid AND p.kind = 'client' AND app_can_see_project(p.id) AND (
      (app_org_kind() = 'firm' AND p.firm_org_id = app_org() AND (app_role() = 'firm_admin' OR app_is_client_lead(p.org_id)))
      OR (NOT by_contact AND app_role() = 'client_admin' AND p.org_id = app_org())
    )
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_manage_client_roles(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_manage_client_roles(uuid, boolean) TO selah_app;
--> statement-breakpoint
CREATE POLICY client_role_read ON project_client_roles FOR SELECT TO selah_app USING (app_can_see_project(project_id));
--> statement-breakpoint
CREATE POLICY client_role_insert ON project_client_roles FOR INSERT TO selah_app
  WITH CHECK (app_can_manage_client_roles(project_id, contact_id IS NOT NULL) AND created_by = app_uid());
--> statement-breakpoint
CREATE POLICY client_role_delete ON project_client_roles FOR DELETE TO selah_app
  USING (app_can_manage_client_roles(project_id, contact_id IS NOT NULL));
--> statement-breakpoint
-- The role's person belongs to the project's client; an account holding
-- the sponsor, coordinator or acceptor role is an active admin or manager.
CREATE FUNCTION check_client_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  client uuid;
  member_role role;
BEGIN
  SELECT p.org_id INTO client FROM projects p WHERE p.id = NEW.project_id AND p.kind = 'client';
  IF client IS NULL THEN
    RAISE EXCEPTION 'client roles are for client projects' USING ERRCODE = 'check_violation';
  END IF;
  NEW.org_id := client;
  IF NEW.contact_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM client_contacts c WHERE c.id = NEW.contact_id AND c.org_id = client) THEN
      RAISE EXCEPTION 'the contact belongs to the project''s client' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT m.role INTO member_role FROM org_memberships m WHERE m.user_id = NEW.user_id AND m.org_id = client AND m.active;
  IF member_role IS NULL THEN
    RAISE EXCEPTION 'the person needs an active account at the project''s client' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.role IN ('sponsor', 'coordinator', 'acceptor') AND member_role NOT IN ('client_admin', 'client_manager') THEN
    RAISE EXCEPTION 'the sponsor, coordinator and acceptors are the client''s admins or managers' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER client_role_rules BEFORE INSERT ON project_client_roles FOR EACH ROW EXECUTE FUNCTION check_client_role();
--> statement-breakpoint
-- Roles are named or removed, never edited in place.
CREATE TRIGGER client_role_fixed BEFORE UPDATE ON project_client_roles FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
-- The roles of a project with each person's name and whether their account
-- is still on. Contacts are the firm's records, so the names come through
-- here for the client's own people too; nothing else about the contact does.
CREATE FUNCTION app_project_client_roles(pid uuid)
RETURNS TABLE (id uuid, role client_role, user_id uuid, contact_id uuid, name text, title text, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id, r.role, r.user_id, r.contact_id, coalesce(u.name, c.name), c.title,
    CASE WHEN r.user_id IS NULL THEN true
      ELSE EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = r.user_id AND m.org_id = r.org_id AND m.active) END
  FROM project_client_roles r
  LEFT JOIN "user" u ON u.id = r.user_id
  LEFT JOIN client_contacts c ON c.id = r.contact_id
  WHERE r.project_id = pid AND app_can_see_project(pid)
  ORDER BY array_position(ARRAY['sponsor', 'coordinator', 'steering', 'acceptor', 'observer']::client_role[], r.role), coalesce(u.name, c.name)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_project_client_roles(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_project_client_roles(uuid) TO selah_app;
--> statement-breakpoint
-- The sponsor moves from the project row to the roles.
INSERT INTO project_client_roles (project_id, org_id, role, user_id, created_by)
SELECT p.id, p.org_id, 'sponsor', p.client_sponsor_user_id, p.created_by
FROM projects p
WHERE p.client_sponsor_user_id IS NOT NULL AND p.kind = 'client'
  AND EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = p.client_sponsor_user_id AND m.org_id = p.org_id AND m.active
    AND m.role IN ('client_admin', 'client_manager'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_follow_ups_due(today date)
RETURNS TABLE (action_id uuid, project_id uuid, kind follow_up_kind, level integer, due_date date, recipients uuid[])
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH open_actions AS (
    SELECT a.id, a.project_id, a.org_id, a.owner_user_id, a.due_date, a.department_id, p.kind AS project_kind, p.firm_org_id,
           EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = a.owner_user_id AND m.org_id = a.org_id AND m.active) AS owner_active,
           (p.kind = 'client' AND o.engagement_mode = 'consultant_managed') AS firm_managed,
           o.departments_enabled,
           p.remind_days_before, p.escalate_level2_days, p.escalate_level3_days,
           today - a.due_date AS days_over
    FROM actions a JOIN projects p ON p.id = a.project_id JOIN organizations o ON o.id = a.org_id
    WHERE a.due_date IS NOT NULL AND app_owner_holds(a.status) AND p.state = 'active'
      AND (a.owner_user_id IS NOT NULL OR (p.kind = 'client' AND o.engagement_mode = 'consultant_managed'))
  ),
  ladder AS (
    SELECT o.*, 'due_soon'::follow_up_kind AS kind, 0 AS step FROM open_actions o
      WHERE o.days_over BETWEEN -o.remind_days_before AND 0
    UNION ALL
    SELECT o.*, 'overdue'::follow_up_kind,
      CASE WHEN o.days_over >= o.escalate_level3_days THEN 3 WHEN o.days_over >= o.escalate_level2_days THEN 2 ELSE 1 END
    FROM open_actions o WHERE o.days_over > 0
  ),
  -- An owner who has left cannot be reminded: go straight to level 2. A
  -- firm-managed client has no owners in Selah; its lead is reminded instead.
  steps AS (
    SELECT l.*, CASE WHEN l.owner_active OR l.firm_managed THEN l.step ELSE greatest(l.step, 2) END AS level FROM ladder l
  ),
  people AS (
    SELECT s.id, s.kind, s.level, s.owner_user_id AS u FROM steps s WHERE s.owner_active
    UNION
    -- firm-managed: the client's lead consultant chases the client
    SELECT s.id, s.kind, s.level, ca.user_id FROM steps s
      JOIN client_assignments ca ON ca.client_org_id = s.org_id AND ca.is_lead
      JOIN org_memberships m ON m.user_id = ca.user_id AND m.org_id = s.firm_org_id AND m.active
      WHERE s.firm_managed
    UNION
    -- level 2+: client managers staffed on the project, and the firm's lead
    SELECT s.id, s.kind, s.level, pm.user_id FROM steps s
      JOIN project_members pm ON pm.project_id = s.project_id
      JOIN org_memberships m ON m.user_id = pm.user_id AND m.org_id = s.org_id AND m.active AND m.role = 'client_manager'
      WHERE s.level >= 2 AND s.project_kind = 'client'
    UNION
    -- level 2+: the head of the action's department
    SELECT s.id, s.kind, s.level, dm.user_id FROM steps s
      JOIN department_members dm ON dm.department_id = s.department_id AND dm.is_head
      JOIN org_memberships m ON m.user_id = dm.user_id AND m.org_id = s.org_id AND m.active
      WHERE s.level >= 2 AND s.project_kind = 'client' AND s.departments_enabled
    UNION
    SELECT s.id, s.kind, s.level, ca.user_id FROM steps s
      JOIN client_assignments ca ON ca.client_org_id = s.org_id AND ca.is_lead
      JOIN org_memberships m ON m.user_id = ca.user_id AND m.org_id = s.firm_org_id AND m.active
      WHERE s.level >= 2 AND s.project_kind = 'client'
    UNION
    SELECT s.id, s.kind, s.level, pm.user_id FROM steps s
      JOIN project_members pm ON pm.project_id = s.project_id AND pm.is_lead
      JOIN org_memberships m ON m.user_id = pm.user_id AND m.org_id = s.firm_org_id AND m.active
      WHERE s.level >= 2 AND s.project_kind = 'internal'
    UNION
    -- level 3: the client's sponsor, when the sponsor has an account that is
    -- still active (a sponsor named as a contact is not mailed)
    SELECT s.id, s.kind, s.level, r.user_id FROM steps s
      JOIN project_client_roles r ON r.project_id = s.project_id AND r.role = 'sponsor'
      JOIN org_memberships m ON m.user_id = r.user_id AND m.org_id = s.org_id AND m.active
        AND m.role IN ('client_admin', 'client_manager')
      WHERE s.level >= 3 AND s.project_kind = 'client'
    UNION
    -- level 3: the client's admins and the watching firm admins
    SELECT s.id, s.kind, s.level, m.user_id FROM steps s
      JOIN org_memberships m ON m.org_id = s.org_id AND m.active AND m.role = 'client_admin'
      WHERE s.level >= 3 AND s.project_kind = 'client'
    UNION
    SELECT s.id, s.kind, s.level, w.user_id FROM steps s
      JOIN watches w ON w.project_id = s.project_id OR (s.project_kind = 'client' AND w.client_org_id = s.org_id)
      JOIN org_memberships m ON m.user_id = w.user_id AND m.org_id = s.firm_org_id AND m.active AND m.role = 'firm_admin'
      WHERE s.level >= 3
  )
  SELECT s.id, s.project_id, s.kind, s.level, s.due_date,
         coalesce((SELECT array_agg(DISTINCT p.u ORDER BY p.u) FROM people p WHERE p.id = s.id AND p.kind = s.kind AND p.level = s.level), '{}')
  FROM steps s
  WHERE NOT EXISTS (
    SELECT 1 FROM follow_up_log l
    WHERE l.action_id = s.id AND l.kind = s.kind AND l.level = s.level AND l.due_date = s.due_date
  )
$$;
--> statement-breakpoint
DROP TRIGGER project_sponsor ON projects;
--> statement-breakpoint
DROP FUNCTION check_project_sponsor();
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_client_sponsor_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "client_sponsor_user_id";
