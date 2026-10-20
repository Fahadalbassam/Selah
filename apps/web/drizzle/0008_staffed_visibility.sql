CREATE TABLE "watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_org_id" uuid,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watches_one_target" CHECK (("watches"."client_org_id" IS NULL) <> ("watches"."project_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "watches" ADD CONSTRAINT "watches_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watches" ADD CONSTRAINT "watches_client_org_id_organizations_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watches" ADD CONSTRAINT "watches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "watches_client_uq" ON "watches" USING btree ("user_id","client_org_id") WHERE "watches"."client_org_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "watches_project_uq" ON "watches" USING btree ("user_id","project_id") WHERE "watches"."project_id" IS NOT NULL;--> statement-breakpoint
-- Decided 2026-10-20: a consultant sees only the projects they are staffed
-- on. Being on a client's team makes them eligible; the client's lead (or
-- the firm admin) staffs each project. The lead sees all of the client's
-- projects. Firm admins see everything and may co-consult (be staffed) or
-- watch a client or project to get the team's notifications.

CREATE FUNCTION app_project_org(pid uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT org_id FROM projects WHERE id = pid
$$;
--> statement-breakpoint
CREATE FUNCTION app_on_client_team(target uuid, client uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = client AND ca.user_id = target)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_can_see_project(eid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects e
    WHERE e.id = eid AND (
      (app_role() = 'firm_admin' AND e.firm_org_id = app_org())
      OR (app_role() = 'consultant' AND e.firm_org_id = app_org() AND (
            EXISTS (SELECT 1 FROM project_members em WHERE em.project_id = eid AND em.user_id = app_uid())
            OR (e.kind = 'client' AND app_is_client_lead(e.org_id))))
      OR (app_role() = 'client_admin' AND e.kind = 'client' AND e.org_id = app_org())
      OR (app_role() IN ('client_manager', 'action_owner') AND e.kind = 'client' AND e.org_id = app_org()
          AND EXISTS (SELECT 1 FROM project_members em WHERE em.project_id = eid AND em.user_id = app_uid()))
    )
  )
$$;
--> statement-breakpoint
-- Who hears about work on a project: the client's lead, the firm staff on
-- the project (internal projects: its leads), and the admins watching the
-- project or its client. Only for a project the caller can see.
CREATE FUNCTION app_project_audience(pid uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT u FROM (
    SELECT ca.user_id AS u FROM projects p JOIN client_assignments ca ON ca.client_org_id = p.org_id AND ca.is_lead
      WHERE p.id = pid AND p.kind = 'client'
    UNION
    SELECT pm.user_id FROM projects p JOIN project_members pm ON pm.project_id = p.id
      JOIN org_memberships m ON m.user_id = pm.user_id AND m.org_id = p.firm_org_id AND m.active
      WHERE p.id = pid AND (p.kind = 'client' OR pm.is_lead)
    UNION
    SELECT w.user_id FROM projects p JOIN watches w ON w.project_id = p.id OR (p.kind = 'client' AND w.client_org_id = p.org_id)
      WHERE p.id = pid
  ) audience
  WHERE app_can_see_project(pid)
$$;
--> statement-breakpoint
-- Notify that audience about an action. The caller may not be able to see
-- the recipients (a client user cannot see a watching admin), so this runs
-- as the owner, but only for an action of a project the caller can see.
CREATE FUNCTION app_notify_project_team(act uuid, note_kind text, skip uuid[]) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pid uuid; n integer;
BEGIN
  SELECT a.project_id INTO pid FROM actions a WHERE a.id = act;
  IF pid IS NULL OR NOT app_can_see_project(pid) THEN
    RAISE EXCEPTION 'action not visible' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF note_kind NOT LIKE 'action.%' THEN
    RAISE EXCEPTION 'unsupported notification kind' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT u, note_kind, 'action', act FROM app_project_audience(pid) u
    WHERE u <> app_uid() AND NOT (u = ANY (coalesce(skip, '{}')));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_project_org(uuid), app_on_client_team(uuid, uuid), app_project_audience(uuid),
  app_notify_project_team(uuid, text, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_project_org(uuid), app_on_client_team(uuid, uuid), app_notify_project_team(uuid, text, uuid[]) TO selah_app;
--> statement-breakpoint
-- The client's lead staffs its projects from the client team (never as
-- project lead); the firm admin may staff anyone, themselves included.
DROP POLICY member_insert ON project_members;
--> statement-breakpoint
CREATE POLICY member_insert ON project_members FOR INSERT TO selah_app WITH CHECK (
  (app_can_see_project(project_id) AND (
    app_role() = 'firm_admin'
    OR (app_role() = 'client_admin' AND app_user_org(user_id) = app_org() AND NOT is_lead)
    OR (app_is_project_lead(project_id) AND app_user_org(user_id) = app_org())
    OR (app_project_kind(project_id) = 'client' AND app_is_client_lead(app_project_org(project_id)) AND NOT is_lead
        AND app_on_client_team(user_id, app_project_org(project_id)))
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
    OR (app_project_kind(project_id) = 'client' AND app_is_client_lead(app_project_org(project_id))
        AND app_user_org(user_id) = app_org() AND user_id <> app_uid())
  )
);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON watches TO selah_app;
--> statement-breakpoint
ALTER TABLE watches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY watch_read ON watches FOR SELECT TO selah_app USING (user_id = app_uid());
--> statement-breakpoint
CREATE POLICY watch_insert ON watches FOR INSERT TO selah_app WITH CHECK (
  user_id = app_uid() AND app_role() = 'firm_admin'
  AND (app_can_see_project(project_id) OR (client_org_id IS NOT NULL AND client_org_id <> app_org() AND app_can_see_org(client_org_id)))
);
--> statement-breakpoint
CREATE POLICY watch_delete ON watches FOR DELETE TO selah_app USING (user_id = app_uid());
