-- Staffing model (decided 2026-10-20):
--   * only the firm admin adds clients and names each client's lead consultant
--   * the lead adds or removes consultants on that client
--   * consultants see a directory of client names and may ask to join;
--     the admin or the client's lead decides
--   * any firm member may create an internal project and becomes its lead
--   * on internal projects firm staff do the work; nobody reviews their own

CREATE FUNCTION app_is_client_lead(client uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = client AND ca.user_id = app_uid() AND ca.is_lead
  )
$$;
--> statement-breakpoint
CREATE FUNCTION app_is_project_lead(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = pid AND pm.user_id = app_uid() AND pm.is_lead)
$$;
--> statement-breakpoint
CREATE FUNCTION app_project_kind(pid uuid) RETURNS project_kind
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT kind FROM projects WHERE id = pid
$$;
--> statement-breakpoint
CREATE FUNCTION app_is_active_client(oid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM organizations o WHERE o.id = oid AND o.kind = 'client' AND o.status = 'active')
$$;
--> statement-breakpoint
-- The creator of a new internal project may make themselves its first lead.
CREATE FUNCTION app_can_claim_project(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = pid AND p.kind = 'internal' AND p.created_by = app_uid() AND p.firm_org_id = app_org()
      AND NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = pid)
  )
$$;
--> statement-breakpoint
-- Client names only, for firm staff. Consultants use it to ask to join a
-- client; it reveals no projects, people or files.
CREATE FUNCTION app_client_directory()
RETURNS TABLE (id uuid, name text, name_ar text, assigned boolean, is_lead boolean, pending boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.id, o.name, o.name_ar,
    EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = o.id AND ca.user_id = app_uid()),
    EXISTS (SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = o.id AND ca.user_id = app_uid() AND ca.is_lead),
    EXISTS (SELECT 1 FROM join_requests jr WHERE jr.client_org_id = o.id AND jr.user_id = app_uid() AND jr.status = 'pending')
  FROM organizations o
  WHERE o.kind = 'client' AND o.status = 'active' AND app_org_kind() = 'firm' AND app_role() IN ('firm_admin', 'consultant')
  ORDER BY o.name
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_is_client_lead(uuid), app_is_project_lead(uuid), app_project_kind(uuid), app_is_active_client(uuid),
  app_can_claim_project(uuid), app_client_directory() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_is_client_lead(uuid), app_is_project_lead(uuid), app_project_kind(uuid), app_is_active_client(uuid),
  app_can_claim_project(uuid), app_client_directory() TO selah_app;
--> statement-breakpoint

-- ------------------------------------------------- client assignments

DROP POLICY assignment_read ON client_assignments;
--> statement-breakpoint
DROP POLICY assignment_write ON client_assignments;
--> statement-breakpoint
-- The firm admin sees all; a consultant sees the team of clients they are on;
-- client users see who their consultants are.
CREATE POLICY assignment_read ON client_assignments FOR SELECT TO selah_app USING (
  (app_role() = 'firm_admin' AND app_can_see_org(client_org_id))
  OR app_is_assigned_to_client(client_org_id)
  OR (app_org_kind() = 'client' AND client_org_id = app_org())
);
--> statement-breakpoint
-- The admin assigns anyone (lead included); a lead adds non-lead consultants.
CREATE POLICY assignment_insert ON client_assignments FOR INSERT TO selah_app WITH CHECK (
  app_user_org(user_id) = app_org() AND app_is_active_client(client_org_id) AND (
    app_role() = 'firm_admin'
    OR (app_is_client_lead(client_org_id) AND NOT is_lead)
  )
);
--> statement-breakpoint
-- Changing who leads is the admin's call.
CREATE POLICY assignment_update ON client_assignments FOR UPDATE TO selah_app
  USING (app_role() = 'firm_admin' AND app_can_see_org(client_org_id))
  WITH CHECK (app_role() = 'firm_admin' AND app_user_org(user_id) = app_org());
--> statement-breakpoint
-- A lead removes other non-lead consultants, never the lead.
CREATE POLICY assignment_delete ON client_assignments FOR DELETE TO selah_app USING (
  (app_role() = 'firm_admin' AND app_can_see_org(client_org_id))
  OR (app_is_client_lead(client_org_id) AND NOT is_lead AND user_id <> app_uid())
);
--> statement-breakpoint
-- Only consultants are assigned to clients (the admin already sees every client).
CREATE FUNCTION check_assignment_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (SELECT role FROM org_memberships WHERE user_id = NEW.user_id) IS DISTINCT FROM 'consultant' THEN
    RAISE EXCEPTION 'only consultants are assigned to clients' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER assignment_role BEFORE INSERT OR UPDATE ON client_assignments FOR EACH ROW EXECUTE FUNCTION check_assignment_role();
--> statement-breakpoint

-- ------------------------------------------------------- join requests

GRANT SELECT, INSERT, UPDATE ON join_requests TO selah_app;
--> statement-breakpoint
ALTER TABLE join_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY request_read ON join_requests FOR SELECT TO selah_app USING (
  user_id = app_uid()
  OR (app_role() = 'firm_admin' AND app_org_kind() = 'firm')
  OR app_is_client_lead(client_org_id)
);
--> statement-breakpoint
CREATE POLICY request_insert ON join_requests FOR INSERT TO selah_app WITH CHECK (
  user_id = app_uid() AND app_role() = 'consultant' AND status = 'pending' AND decided_by IS NULL
  AND app_is_active_client(client_org_id) AND NOT app_is_assigned_to_client(client_org_id)
);
--> statement-breakpoint
CREATE POLICY request_decide ON join_requests FOR UPDATE TO selah_app
  USING (status = 'pending' AND (app_role() = 'firm_admin' OR app_is_client_lead(client_org_id)))
  -- The role check is repeated here: Postgres accepts an updated row that
  -- passes ANY update policy's WITH CHECK, not only the one whose USING matched.
  WITH CHECK (
    status IN ('approved', 'declined') AND decided_by = app_uid()
    AND (app_role() = 'firm_admin' OR app_is_client_lead(client_org_id))
  );
--> statement-breakpoint
CREATE POLICY request_withdraw ON join_requests FOR UPDATE TO selah_app
  USING (status = 'pending' AND user_id = app_uid())
  WITH CHECK (status = 'withdrawn' AND user_id = app_uid() AND decided_by IS NULL);
--> statement-breakpoint
-- A decision is final, and only the decision fields may change.
CREATE FUNCTION check_join_request_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'this request was already decided' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.client_org_id <> OLD.client_org_id OR NEW.user_id <> OLD.user_id OR NEW.reason <> OLD.reason
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'only the decision can change' USING ERRCODE = 'check_violation';
  END IF;
  NEW.decided_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER join_request_update BEFORE UPDATE ON join_requests FOR EACH ROW EXECUTE FUNCTION check_join_request_update();
--> statement-breakpoint

-- ------------------------------------------------ internal projects

DROP POLICY project_insert ON projects;
--> statement-breakpoint
CREATE POLICY project_insert ON projects FOR INSERT TO selah_app WITH CHECK (
  firm_org_id = app_org() AND (
    app_role() = 'firm_admin'
    OR (app_role() = 'consultant' AND kind = 'internal' AND created_by = app_uid())
  )
);
--> statement-breakpoint
DROP POLICY member_write ON project_members;
--> statement-breakpoint
-- The firm admin adds anyone; a client admin their own org's users; the lead
-- of an internal project adds firm colleagues; a project's creator claims it.
CREATE POLICY member_insert ON project_members FOR INSERT TO selah_app WITH CHECK (
  (app_can_see_project(project_id) AND (
    app_role() = 'firm_admin'
    OR (app_role() = 'client_admin' AND app_user_org(user_id) = app_org() AND NOT is_lead)
    OR (app_is_project_lead(project_id) AND app_user_org(user_id) = app_org())
  ))
  OR (user_id = app_uid() AND is_lead AND app_can_claim_project(project_id))
);
--> statement-breakpoint
CREATE POLICY member_change ON project_members FOR UPDATE TO selah_app
  USING (app_can_see_project(project_id) AND (app_role() = 'firm_admin' OR app_is_project_lead(project_id)))
  WITH CHECK (app_can_see_project(project_id) AND (app_role() = 'firm_admin' OR app_is_project_lead(project_id)));
--> statement-breakpoint
CREATE POLICY member_delete ON project_members FOR DELETE TO selah_app USING (
  app_can_see_project(project_id) AND (
    app_role() = 'firm_admin'
    OR (app_role() = 'client_admin' AND app_user_org(user_id) = app_org())
    OR (app_is_project_lead(project_id) AND user_id <> app_uid())
  )
);
--> statement-breakpoint
-- On internal projects firm staff submit evidence themselves.
DROP POLICY scoped_insert ON evidence_submissions;
--> statement-breakpoint
CREATE POLICY scoped_insert ON evidence_submissions FOR INSERT TO selah_app WITH CHECK (
  app_can_see_project(project_id) AND submitted_by = app_uid()
  AND (app_org_kind() = 'client' OR app_project_kind(project_id) = 'internal')
);
--> statement-breakpoint
-- Firm staff review, and never their own action.
DROP POLICY scoped_insert ON reviews;
--> statement-breakpoint
CREATE POLICY scoped_insert ON reviews FOR INSERT TO selah_app WITH CHECK (
  app_can_see_project(project_id) AND reviewer_id = app_uid()
  AND app_role() IN ('firm_admin', 'consultant')
  AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.id = action_id AND a.owner_user_id = app_uid())
);
