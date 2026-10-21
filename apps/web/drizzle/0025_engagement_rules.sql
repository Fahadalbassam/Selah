-- Engagement modes and optional departments (2026-10-20, research section 9).
--
-- One platform, three ways a client can take part:
--   full               - the client's people use Selah and record their own work.
--   restricted         - client admins only (firm_settings.restricted_max_admins).
--                        What they upload stays client_private until a client
--                        admin shares it; sharing is one-way and logged.
--   consultant_managed - no client accounts at all. Firm staff record progress
--                        and evidence on the client's behalf, saying how and
--                        when the client told them; reminders go to the lead.
-- Only the firm admin changes a client's mode, every change is audited, and
-- a change never deletes data. A mode can only be entered when the client's
-- active accounts already fit it.
--
-- Departments are optional and off by default. When a client switches them
-- on, an action or document with a department is seen by that department's
-- members, the client's admins and the firm; everyone else on the project
-- gets a 404, as for any other hidden row. Progress, evidence, evidence
-- requests and reviews follow their action. Turned off, nothing is hidden.

UPDATE organizations SET engagement_mode = 'full' WHERE kind = 'client' AND engagement_mode IS NULL;
--> statement-breakpoint
ALTER TABLE organizations ADD CONSTRAINT engagement_mode_clients CHECK ((kind = 'firm') = (engagement_mode IS NULL));
--> statement-breakpoint
ALTER TABLE organizations ADD CONSTRAINT departments_clients CHECK (kind = 'client' OR NOT departments_enabled);
--> statement-breakpoint
ALTER TABLE firm_settings ADD CONSTRAINT restricted_max_admins_range CHECK (restricted_max_admins BETWEEN 1 AND 10);
--> statement-breakpoint

-- --------------------------------------------------------- helpers

CREATE FUNCTION app_engagement_mode(org uuid) RETURNS engagement_mode
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT engagement_mode FROM organizations WHERE id = org
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_engagement_mode(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_engagement_mode(uuid) TO selah_app;
--> statement-breakpoint
-- Selah serves one firm; its setting applies to every restricted client.
CREATE FUNCTION app_restricted_max_admins() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT fs.restricted_max_admins FROM firm_settings fs JOIN organizations o ON o.id = fs.org_id AND o.kind = 'firm' LIMIT 1), 2)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_restricted_max_admins() FROM PUBLIC;
--> statement-breakpoint

-- --------------------------------------------------------- organisations

-- A client starts in full mode unless the firm chose otherwise. Its kind
-- never changes. A client admin may rename the org, set its email domains
-- and switch departments on or off; the mode and status are the firm's.
CREATE FUNCTION check_organization_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  client_cols text[] := ARRAY['name', 'name_ar', 'allowed_email_domains', 'departments_enabled'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind = 'client' THEN
      NEW.engagement_mode := coalesce(NEW.engagement_mode, 'full');
    END IF;
    RETURN NEW;
  END IF;
  IF app_uid() IS NOT NULL THEN
    IF NEW.kind <> OLD.kind THEN
      RAISE EXCEPTION 'an organisation''s kind never changes' USING ERRCODE = 'check_violation';
    END IF;
    IF app_org_kind() IS DISTINCT FROM 'firm' AND (to_jsonb(NEW) - client_cols) <> (to_jsonb(OLD) - client_cols) THEN
      RAISE EXCEPTION 'the firm manages this organisation''s settings' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.engagement_mode IS DISTINCT FROM OLD.engagement_mode AND app_role() IS DISTINCT FROM 'firm_admin' THEN
      RAISE EXCEPTION 'only the firm admin changes how a client takes part' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF NEW.engagement_mode IS DISTINCT FROM OLD.engagement_mode THEN
    IF NEW.engagement_mode = 'consultant_managed' AND EXISTS (
      SELECT 1 FROM org_memberships m WHERE m.org_id = NEW.id AND m.active
    ) THEN
      RAISE EXCEPTION 'switch off the client''s accounts before the firm manages the engagement' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.engagement_mode = 'restricted' THEN
      IF EXISTS (SELECT 1 FROM org_memberships m WHERE m.org_id = NEW.id AND m.active AND m.role <> 'client_admin') THEN
        RAISE EXCEPTION 'a restricted client has admin accounts only: switch off the others first' USING ERRCODE = 'check_violation';
      END IF;
      IF (SELECT count(*) FROM org_memberships m WHERE m.org_id = NEW.id AND m.active) > app_restricted_max_admins() THEN
        RAISE EXCEPTION 'a restricted client has at most % admin accounts', app_restricted_max_admins() USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER organization_change BEFORE INSERT OR UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION check_organization_change();
--> statement-breakpoint
CREATE FUNCTION log_organization_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.engagement_mode IS DISTINCT FROM OLD.engagement_mode THEN
    INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
      VALUES (app_uid(), NEW.id, 'organization.engagement_mode', 'organization', NEW.id, 'allow',
              jsonb_build_object('from', OLD.engagement_mode, 'to', NEW.engagement_mode));
  END IF;
  IF NEW.departments_enabled <> OLD.departments_enabled THEN
    INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
      VALUES (app_uid(), NEW.id, 'organization.departments', 'organization', NEW.id, 'allow',
              jsonb_build_object('enabled', NEW.departments_enabled));
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER organization_log AFTER UPDATE OF engagement_mode, departments_enabled ON organizations
  FOR EACH ROW EXECUTE FUNCTION log_organization_change();
--> statement-breakpoint

-- --------------------------------------------------------- accounts per mode

-- The accounts a client may hold in its mode. Locks the client's row so two
-- admins added at once cannot both pass the count.
CREATE FUNCTION app_check_client_account(org uuid, r role, existing uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE mode engagement_mode;
BEGIN
  SELECT engagement_mode INTO mode FROM organizations WHERE id = org FOR UPDATE;
  IF mode = 'consultant_managed' THEN
    RAISE EXCEPTION 'this client is managed by the firm and has no accounts in Selah' USING ERRCODE = 'check_violation';
  END IF;
  IF mode = 'restricted' THEN
    IF r <> 'client_admin' THEN
      RAISE EXCEPTION 'a restricted client has admin accounts only' USING ERRCODE = 'check_violation';
    END IF;
    IF (SELECT count(*) FROM org_memberships m WHERE m.org_id = org AND m.active AND m.id IS DISTINCT FROM existing)
       >= app_restricted_max_admins() THEN
      RAISE EXCEPTION 'a restricted client has at most % admin accounts', app_restricted_max_admins() USING ERRCODE = 'check_violation';
    END IF;
  END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_check_client_account(uuid, role, uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION check_membership_mode() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.active AND NEW.role IN ('client_admin', 'client_manager', 'action_owner')
     AND (TG_OP = 'INSERT' OR NOT OLD.active OR NEW.role <> OLD.role) THEN
    PERFORM app_check_client_account(NEW.org_id, NEW.role, NEW.id);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER membership_mode BEFORE INSERT OR UPDATE ON org_memberships FOR EACH ROW EXECUTE FUNCTION check_membership_mode();
--> statement-breakpoint
-- Checked again when the invitation is accepted (the membership above), so
-- a mode changed in between still holds.
CREATE FUNCTION check_invitation_mode() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.role IN ('client_admin', 'client_manager', 'action_owner') THEN
    PERFORM app_check_client_account(NEW.org_id, NEW.role, NULL);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invitation_mode BEFORE INSERT ON invitations FOR EACH ROW EXECUTE FUNCTION check_invitation_mode();
--> statement-breakpoint

-- --------------------------------------------------------- who recorded it

-- Set from the author's organisation, never from the request. Firm staff
-- record work on a client project only when the firm manages the
-- engagement, and then say how and when the client told them.
CREATE FUNCTION set_record_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  who uuid := coalesce(to_jsonb(NEW) ->> 'author_id', to_jsonb(NEW) ->> 'submitted_by')::uuid;
  pk project_kind;
  mode engagement_mode;
BEGIN
  SELECT p.kind, o.engagement_mode INTO pk, mode FROM projects p JOIN organizations o ON o.id = p.org_id WHERE p.id = NEW.project_id;
  IF pk = 'internal' THEN
    NEW.source := 'internal';
  ELSIF (SELECT o.kind FROM organizations o WHERE o.id = app_user_org(who)) = 'firm' THEN
    IF mode IS DISTINCT FROM 'consultant_managed' THEN
      RAISE EXCEPTION 'the client records its own progress and evidence in this engagement' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.source := 'consultant_recorded';
    IF NEW.received_on > current_date THEN
      RAISE EXCEPTION 'received_on cannot be in the future' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    NEW.source := 'client_portal';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER record_source BEFORE INSERT ON progress_updates FOR EACH ROW EXECUTE FUNCTION set_record_source();
--> statement-breakpoint
CREATE TRIGGER record_source BEFORE INSERT ON evidence_submissions FOR EACH ROW EXECUTE FUNCTION set_record_source();
--> statement-breakpoint
-- Rows written before sources existed: internal projects were staff's own work.
ALTER TABLE progress_updates DISABLE TRIGGER append_only;
--> statement-breakpoint
UPDATE progress_updates pu SET source = 'internal' FROM projects p WHERE p.id = pu.project_id AND p.kind = 'internal';
--> statement-breakpoint
ALTER TABLE progress_updates ENABLE TRIGGER append_only;
--> statement-breakpoint
ALTER TABLE evidence_submissions DISABLE TRIGGER append_only;
--> statement-breakpoint
UPDATE evidence_submissions es SET source = 'internal' FROM projects p WHERE p.id = es.project_id AND p.kind = 'internal';
--> statement-breakpoint
ALTER TABLE evidence_submissions ENABLE TRIGGER append_only;
--> statement-breakpoint
-- Firm staff submit evidence on internal projects, and for a client whose
-- engagement the firm manages.
DROP POLICY scoped_insert ON evidence_submissions;
--> statement-breakpoint
CREATE POLICY scoped_insert ON evidence_submissions FOR INSERT TO selah_app WITH CHECK (
  app_can_see_project(project_id) AND submitted_by = app_uid()
  AND (app_org_kind() = 'client' OR app_project_kind(project_id) = 'internal'
       OR (app_org_kind() = 'firm' AND app_engagement_mode(org_id) = 'consultant_managed'))
);
--> statement-breakpoint
-- Evidence is for the firm to verify, so it cannot point at a file the firm
-- cannot open. It takes its action's department.
CREATE FUNCTION check_evidence_document() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (SELECT d.visibility FROM documents d WHERE d.id = NEW.document_id) = 'client_private' THEN
    RAISE EXCEPTION 'share the file with the firm before submitting it as evidence' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE documents d SET department_id = a.department_id
    FROM actions a WHERE a.id = NEW.action_id AND d.id = NEW.document_id AND d.department_id IS NULL AND a.department_id IS NOT NULL;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER evidence_document BEFORE INSERT ON evidence_submissions FOR EACH ROW EXECUTE FUNCTION check_evidence_document();
--> statement-breakpoint
-- Separation of duties: whoever submitted evidence, or recorded progress on
-- the client's behalf, since the last review does not review this round.
CREATE OR REPLACE FUNCTION app_submitted_this_round(act uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH since AS (SELECT coalesce((SELECT max(r.created_at) FROM reviews r WHERE r.action_id = act), '-infinity') AS at)
  SELECT EXISTS (
    SELECT 1 FROM evidence_submissions es, since
    WHERE es.action_id = act AND es.submitted_by = app_uid() AND es.created_at > since.at
  ) OR EXISTS (
    SELECT 1 FROM progress_updates pu, since
    WHERE pu.action_id = act AND pu.author_id = app_uid() AND pu.source = 'consultant_recorded' AND pu.created_at > since.at
  )
$$;
--> statement-breakpoint

-- --------------------------------------------------------- client-private files

-- In a restricted engagement, what the client uploads stays private to the
-- client until a client admin shares it (evidence is shared by submitting
-- it, since the firm must see it to verify). A client-private file is only
-- ever shared, by a client admin of its org, and never made private again.
CREATE FUNCTION check_document_label() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.purpose <> 'evidence' AND app_org_kind() = 'client' AND app_engagement_mode(NEW.org_id) = 'restricted' THEN
      NEW.visibility := 'client_private';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.visibility = OLD.visibility THEN
    RETURN NEW;
  END IF;
  IF NEW.visibility = 'client_private' THEN
    RAISE EXCEPTION 'a file seen by the firm cannot be made private again' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.visibility = 'client_private' THEN
    IF NEW.visibility <> 'shared' THEN
      RAISE EXCEPTION 'a client-private file can only be shared' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT coalesce(app_role() = 'client_admin' AND app_org() = NEW.org_id, false) THEN
      RAISE EXCEPTION 'only the client''s admin shares its private files' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, from_state, to_state)
      VALUES (NEW.project_id, NEW.org_id, app_uid(), 'document', NEW.id, 'document_shared', 'client_private', 'shared');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_label BEFORE INSERT OR UPDATE OF visibility ON documents
  FOR EACH ROW EXECUTE FUNCTION check_document_label();
--> statement-breakpoint

-- --------------------------------------------------------- departments

GRANT SELECT, INSERT, UPDATE ON departments TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON department_members TO selah_app;
--> statement-breakpoint
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE department_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The client's people see its department names; the firm sees them for the
-- clients it works with. Admins (client admin, firm admin) manage them.
CREATE POLICY scoped_read ON departments FOR SELECT TO selah_app
  USING (app_firm_works_with(org_id) OR (org_id = app_org() AND app_role() IS NOT NULL));
--> statement-breakpoint
CREATE POLICY admin_write ON departments FOR INSERT TO selah_app WITH CHECK (app_can_admin_org(org_id));
--> statement-breakpoint
CREATE POLICY admin_update ON departments FOR UPDATE TO selah_app
  USING (app_can_admin_org(org_id)) WITH CHECK (app_can_admin_org(org_id));
--> statement-breakpoint
CREATE FUNCTION check_department() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (SELECT o.kind FROM organizations o WHERE o.id = NEW.org_id) <> 'client' THEN
      RAISE EXCEPTION 'departments belong to a client' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_by := app_uid();
  ELSIF NEW.org_id <> OLD.org_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'a department stays with its client' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER department_rules BEFORE INSERT OR UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION check_department();
--> statement-breakpoint
CREATE FUNCTION app_department_org(dept uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT org_id FROM departments WHERE id = dept
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_department_org(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_department_org(uuid) TO selah_app;
--> statement-breakpoint
-- Who is in which department: the firm, the client's admins and managers,
-- and each person for their own.
CREATE POLICY scoped_read ON department_members FOR SELECT TO selah_app USING (
  user_id = app_uid()
  OR app_firm_works_with(app_department_org(department_id))
  OR (app_department_org(department_id) = app_org() AND app_role() IN ('client_admin', 'client_manager'))
);
--> statement-breakpoint
CREATE POLICY admin_write ON department_members FOR ALL TO selah_app
  USING (app_can_admin_org(app_department_org(department_id)))
  WITH CHECK (app_can_admin_org(app_department_org(department_id)));
--> statement-breakpoint
-- Members are the client's own active people.
CREATE FUNCTION check_department_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.department_id <> OLD.department_id OR NEW.user_id <> OLD.user_id) THEN
    RAISE EXCEPTION 'add the person to the other department instead' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM org_memberships m JOIN departments d ON d.org_id = m.org_id
    WHERE d.id = NEW.department_id AND m.user_id = NEW.user_id AND m.active
  ) THEN
    RAISE EXCEPTION 'department members are active people of the client' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.added_by := app_uid();
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER department_member_rules BEFORE INSERT OR UPDATE ON department_members
  FOR EACH ROW EXECUTE FUNCTION check_department_member();
--> statement-breakpoint
-- A row is filed under an active department of its own client (the
-- composite foreign key keeps it in the same org).
CREATE FUNCTION check_row_department() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.department_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.department_id IS DISTINCT FROM OLD.department_id)
     AND NOT EXISTS (SELECT 1 FROM departments d WHERE d.id = NEW.department_id AND d.active) THEN
    RAISE EXCEPTION 'that department is not active' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER row_department BEFORE INSERT OR UPDATE OF department_id ON actions
  FOR EACH ROW EXECUTE FUNCTION check_row_department();
--> statement-breakpoint
CREATE TRIGGER row_department BEFORE INSERT OR UPDATE OF department_id ON documents
  FOR EACH ROW EXECUTE FUNCTION check_row_department();
--> statement-breakpoint
-- The department check. True when the row has no department, the client has
-- departments off, the caller is firm staff (the project checks still
-- apply), the caller is an admin of the client, or the caller is in the
-- department.
CREATE FUNCTION app_dept_ok(dept uuid, row_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT dept IS NULL
    OR NOT coalesce((SELECT o.departments_enabled FROM organizations o WHERE o.id = row_org), false)
    OR app_org_kind() = 'firm' AND app_role() IS NOT NULL
    OR (app_role() = 'client_admin' AND app_org() = row_org)
    OR EXISTS (SELECT 1 FROM department_members dm WHERE dm.department_id = dept AND dm.user_id = app_uid())
$$;
--> statement-breakpoint
-- The same check through an action; its owner always sees it.
CREATE FUNCTION app_action_dept_ok(act uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT app_dept_ok(a.department_id, a.org_id) OR a.owner_user_id = app_uid()
    FROM actions a WHERE a.id = act
  ), true)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_dept_ok(uuid, uuid), app_action_dept_ok(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_dept_ok(uuid, uuid), app_action_dept_ok(uuid) TO selah_app;
--> statement-breakpoint
-- Restrictive: added to every existing policy on these tables, so no
-- read or write path skips it.
CREATE POLICY department ON actions AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_dept_ok(department_id, org_id) OR owner_user_id = app_uid())
  WITH CHECK (app_dept_ok(department_id, org_id) OR owner_user_id = app_uid());
--> statement-breakpoint
CREATE POLICY department ON documents AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_dept_ok(department_id, org_id) OR uploaded_by = app_uid())
  WITH CHECK (app_dept_ok(department_id, org_id) OR uploaded_by = app_uid());
--> statement-breakpoint
CREATE POLICY department ON progress_updates AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_dept_ok(action_id)) WITH CHECK (app_action_dept_ok(action_id));
--> statement-breakpoint
CREATE POLICY department ON evidence_submissions AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_dept_ok(action_id)) WITH CHECK (app_action_dept_ok(action_id));
--> statement-breakpoint
CREATE POLICY department ON evidence_requests AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_dept_ok(action_id)) WITH CHECK (app_action_dept_ok(action_id));
--> statement-breakpoint
CREATE POLICY department ON reviews AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_dept_ok(action_id)) WITH CHECK (app_action_dept_ok(action_id));
--> statement-breakpoint
-- The assistant's index: a chunk carries its source's department, so the
-- vector search filters on it like on the label.
CREATE POLICY department ON ai_chunks AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_dept_ok(department_id, org_id)) WITH CHECK (app_dept_ok(department_id, org_id));
--> statement-breakpoint
CREATE FUNCTION set_chunk_department() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.department_id := CASE NEW.source_type
    WHEN 'document' THEN (SELECT d.department_id FROM documents d WHERE d.id = NEW.source_id)
    WHEN 'action' THEN (SELECT a.department_id FROM actions a WHERE a.id = NEW.source_id)
    WHEN 'progress_update' THEN (SELECT a.department_id FROM progress_updates pu JOIN actions a ON a.id = pu.action_id WHERE pu.id = NEW.source_id)
    WHEN 'review' THEN (SELECT a.department_id FROM reviews r JOIN actions a ON a.id = r.action_id WHERE r.id = NEW.source_id)
    ELSE NULL
  END;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER chunk_department BEFORE INSERT ON ai_chunks FOR EACH ROW EXECUTE FUNCTION set_chunk_department();
--> statement-breakpoint
-- Refiling a document or an action under another department takes its
-- chunks out of the index; the indexer adds them back with the new one.
CREATE FUNCTION drop_department_chunks() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    IF TG_TABLE_NAME = 'documents' THEN
      DELETE FROM ai_chunks WHERE source_type = 'document' AND source_id = NEW.id;
    ELSE
      DELETE FROM ai_chunks WHERE (source_type = 'action' AND source_id = NEW.id)
        OR (source_type = 'progress_update' AND source_id IN (SELECT pu.id FROM progress_updates pu WHERE pu.action_id = NEW.id))
        OR (source_type = 'review' AND source_id IN (SELECT r.id FROM reviews r WHERE r.action_id = NEW.id));
    END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER department_chunks AFTER UPDATE OF department_id ON documents
  FOR EACH ROW EXECUTE FUNCTION drop_department_chunks();
--> statement-breakpoint
CREATE TRIGGER department_chunks AFTER UPDATE OF department_id ON actions
  FOR EACH ROW EXECUTE FUNCTION drop_department_chunks();
--> statement-breakpoint

-- --------------------------------------------------------- reminders

-- As in 0015, plus:
--   * consultant-managed clients: an action with no account owner (the
--     client person is owner_name) is chased by the client's lead
--     consultant at every level; the ladder still climbs to the watching
--     firm admins.
--   * departments (when the client has them on): level 2 adds the head of
--     the action's department.
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
    -- level 3: the client's sponsor (if still an active admin or manager)
    SELECT s.id, s.kind, s.level, p.client_sponsor_user_id FROM steps s
      JOIN projects p ON p.id = s.project_id
      JOIN org_memberships m ON m.user_id = p.client_sponsor_user_id AND m.org_id = s.org_id AND m.active
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
REVOKE ALL ON FUNCTION app_follow_ups_due(date) FROM PUBLIC;
