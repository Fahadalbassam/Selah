-- Selah database security layer: grants, row-level security, append-only
-- history and workflow guards.
--
-- This is the BACKSTOP, not the main check. The main check is authorize() in
-- src/authz. RLS guarantees tenant, engagement and visibility-label isolation
-- even if app code forgets a check. Finer rules (action owners see only their
-- actions, per-user document shares, which role may move which status) live in
-- authorize().
--
-- Roles (created by db/init/01-roles.sh as superuser):
--   selah_owner  owns the schema, runs migrations. Never used by the app.
--   selah_app    the web app's runtime role. Subject to every policy below.
--   selah_auth   Better Auth's role. Only the auth tables.
--
-- The app sets the caller per transaction with
--   SELECT set_config('selah.user_id', '<uuid>', true)
-- and everything else (org, role, engagements) is derived here from tables,
-- so a request can never claim a role it does not have.

-- ------------------------------------------------------------ helpers

CREATE FUNCTION app_uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('selah.user_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE FUNCTION app_org() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.org_id FROM org_memberships m
  JOIN organizations o ON o.id = m.org_id
  WHERE m.user_id = app_uid() AND m.active AND o.status = 'active'
$$;
--> statement-breakpoint
CREATE FUNCTION app_role() RETURNS role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.role FROM org_memberships m
  JOIN organizations o ON o.id = m.org_id
  WHERE m.user_id = app_uid() AND m.active AND o.status = 'active'
$$;
--> statement-breakpoint
CREATE FUNCTION app_org_kind() RETURNS org_kind
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.kind FROM org_memberships m
  JOIN organizations o ON o.id = m.org_id
  WHERE m.user_id = app_uid() AND m.active AND o.status = 'active'
$$;
--> statement-breakpoint
CREATE FUNCTION app_user_org(target uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT org_id FROM org_memberships WHERE user_id = target
$$;
--> statement-breakpoint
-- The engagement check from the spec: organization + role + membership.
CREATE FUNCTION app_can_see_engagement(eid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM engagements e
    WHERE e.id = eid AND (
      (app_role() = 'maayish_lead' AND e.maayish_org_id = app_org())
      OR (app_role() = 'consultant' AND e.maayish_org_id = app_org()
          AND EXISTS (SELECT 1 FROM engagement_members em WHERE em.engagement_id = eid AND em.user_id = app_uid()))
      OR (app_role() = 'client_admin' AND e.client_org_id = app_org())
      OR (app_role() IN ('client_manager', 'action_owner') AND e.client_org_id = app_org()
          AND EXISTS (SELECT 1 FROM engagement_members em WHERE em.engagement_id = eid AND em.user_id = app_uid()))
    )
  )
$$;
--> statement-breakpoint
CREATE FUNCTION app_can_see_org(oid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT oid = app_org()
    OR (app_role() = 'maayish_lead' AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = oid AND o.kind = 'client'))
    OR EXISTS (
      SELECT 1 FROM engagements e
      WHERE (e.client_org_id = oid OR e.maayish_org_id = oid) AND app_can_see_engagement(e.id)
    )
$$;
--> statement-breakpoint
CREATE FUNCTION app_can_see_user(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT target = app_uid()
    OR (app_role() <> 'action_owner' AND app_user_org(target) = app_org())
    OR EXISTS (
      SELECT 1 FROM engagement_members em
      WHERE em.user_id = target AND app_can_see_engagement(em.engagement_id)
    )
    OR (app_org_kind() = 'maayish' AND app_can_see_org(app_user_org(target)))
$$;
--> statement-breakpoint
-- Visibility labels. owner is the row's creator (used for user_private).
CREATE FUNCTION app_label_ok(vis visibility, client_org uuid, owner uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE vis
    WHEN 'shared' THEN true
    WHEN 'maayish_private' THEN app_org_kind() = 'maayish'
    WHEN 'client_private' THEN app_org_kind() = 'client' AND client_org = app_org()
    WHEN 'user_private' THEN owner IS NOT NULL AND owner = app_uid()
    ELSE false
  END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_org(), app_role(), app_org_kind(), app_user_org(uuid), app_can_see_engagement(uuid),
  app_can_see_org(uuid), app_can_see_user(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_uid(), app_org(), app_role(), app_org_kind(), app_user_org(uuid),
  app_can_see_engagement(uuid), app_can_see_org(uuid), app_can_see_user(uuid),
  app_label_ok(visibility, uuid, uuid) TO selah_app;
--> statement-breakpoint

-- ------------------------------------------------------------- grants
-- Deny by default: a table added later has no grants and no policies until a
-- migration adds them, so the app role cannot read it.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO selah_app, selah_auth;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "user", session, account, verification, two_factor TO selah_auth;
--> statement-breakpoint
GRANT SELECT (id, name, email, image) ON "user" TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON
  organizations, org_memberships, engagements, engagement_members, findings, recommendations, actions,
  deadline_change_requests, documents, document_shares, meeting_notes, follow_ups, reports, notifications,
  ai_chunks, ai_conversations, ai_messages
TO selah_app;
--> statement-breakpoint
-- History tables: insert and read only.
GRANT SELECT, INSERT ON progress_updates, evidence_submissions, reviews, activity_events TO selah_app;
--> statement-breakpoint
-- Security log: write only. Nobody reads it through the app.
GRANT INSERT ON audit_log TO selah_app;
--> statement-breakpoint

-- --------------------------------------------------------- enable RLS

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user', 'session', 'account', 'verification', 'two_factor',
    'organizations', 'org_memberships', 'engagements', 'engagement_members', 'findings', 'recommendations',
    'actions', 'progress_updates', 'deadline_change_requests', 'documents', 'document_shares',
    'evidence_submissions', 'reviews', 'meeting_notes', 'follow_ups', 'reports', 'activity_events',
    'audit_log', 'notifications', 'ai_chunks', 'ai_conversations', 'ai_messages'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- ------------------------------------------------------ auth policies

CREATE POLICY auth_all ON "user" TO selah_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY auth_all ON session TO selah_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY auth_all ON account TO selah_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY auth_all ON verification TO selah_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY auth_all ON two_factor TO selah_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY app_read ON "user" FOR SELECT TO selah_app USING (app_can_see_user(id));
--> statement-breakpoint

-- ------------------------------------------------------------ tenancy

CREATE POLICY org_read ON organizations FOR SELECT TO selah_app USING (app_can_see_org(id));
--> statement-breakpoint
CREATE POLICY org_insert ON organizations FOR INSERT TO selah_app
  WITH CHECK (app_role() = 'maayish_lead' AND kind = 'client');
--> statement-breakpoint
CREATE POLICY org_update ON organizations FOR UPDATE TO selah_app
  USING ((app_role() = 'maayish_lead' AND kind = 'client') OR (id = app_org() AND app_role() IN ('maayish_lead', 'client_admin')))
  WITH CHECK ((app_role() = 'maayish_lead' AND kind = 'client') OR (id = app_org() AND app_role() IN ('maayish_lead', 'client_admin')));
--> statement-breakpoint
-- Action owners see only their own membership; everyone else sees their org.
CREATE POLICY membership_read ON org_memberships FOR SELECT TO selah_app USING (
  user_id = app_uid()
  OR (org_id = app_org() AND app_role() <> 'action_owner')
  OR (app_org_kind() = 'maayish' AND app_can_see_org(org_id))
);
--> statement-breakpoint
CREATE POLICY membership_write ON org_memberships FOR ALL TO selah_app
  USING (
    (app_role() = 'client_admin' AND org_id = app_org())
    OR (app_role() = 'maayish_lead' AND app_can_see_org(org_id))
  )
  WITH CHECK (
    (app_role() = 'client_admin' AND org_id = app_org() AND role IN ('client_admin', 'client_manager', 'action_owner'))
    OR (app_role() = 'maayish_lead' AND app_can_see_org(org_id))
  );
--> statement-breakpoint
CREATE POLICY engagement_read ON engagements FOR SELECT TO selah_app USING (app_can_see_engagement(id));
--> statement-breakpoint
CREATE POLICY engagement_insert ON engagements FOR INSERT TO selah_app
  WITH CHECK (app_role() = 'maayish_lead' AND maayish_org_id = app_org());
--> statement-breakpoint
CREATE POLICY engagement_update ON engagements FOR UPDATE TO selah_app
  USING (app_role() = 'maayish_lead' AND maayish_org_id = app_org())
  WITH CHECK (app_role() = 'maayish_lead' AND maayish_org_id = app_org());
--> statement-breakpoint
CREATE POLICY member_read ON engagement_members FOR SELECT TO selah_app USING (app_can_see_engagement(engagement_id));
--> statement-breakpoint
-- The lead adds anyone; a client admin adds only their own org's users.
CREATE POLICY member_write ON engagement_members FOR ALL TO selah_app
  USING (
    app_can_see_engagement(engagement_id)
    AND (app_role() = 'maayish_lead' OR (app_role() = 'client_admin' AND app_user_org(user_id) = app_org()))
  )
  WITH CHECK (
    app_can_see_engagement(engagement_id)
    AND (app_role() = 'maayish_lead' OR (app_role() = 'client_admin' AND app_user_org(user_id) = app_org()))
  );
--> statement-breakpoint

-- -------------------------------------------- engagement-scoped tables

CREATE POLICY scoped ON findings FOR ALL TO selah_app
  USING (app_can_see_engagement(engagement_id) AND app_label_ok(visibility, client_org_id, created_by))
  WITH CHECK (app_can_see_engagement(engagement_id) AND app_label_ok(visibility, client_org_id, created_by));
--> statement-breakpoint
CREATE POLICY scoped ON recommendations FOR ALL TO selah_app
  USING (app_can_see_engagement(engagement_id) AND app_label_ok(visibility, client_org_id, created_by))
  WITH CHECK (app_can_see_engagement(engagement_id) AND app_label_ok(visibility, client_org_id, created_by));
--> statement-breakpoint
CREATE POLICY scoped ON actions FOR ALL TO selah_app
  USING (app_can_see_engagement(engagement_id))
  WITH CHECK (app_can_see_engagement(engagement_id));
--> statement-breakpoint
CREATE POLICY scoped ON deadline_change_requests FOR ALL TO selah_app
  USING (app_can_see_engagement(engagement_id))
  WITH CHECK (app_can_see_engagement(engagement_id));
--> statement-breakpoint
-- An evidence upload stays visible only to its uploader until submitted.
CREATE POLICY scoped ON documents FOR ALL TO selah_app
  USING (
    app_can_see_engagement(engagement_id)
    AND app_label_ok(visibility, client_org_id, uploaded_by)
    AND (state <> 'draft' OR purpose <> 'evidence' OR uploaded_by = app_uid())
  )
  WITH CHECK (
    app_can_see_engagement(engagement_id)
    AND app_label_ok(visibility, client_org_id, uploaded_by)
  );
--> statement-breakpoint
CREATE POLICY scoped ON document_shares FOR ALL TO selah_app
  USING (EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id))
  WITH CHECK (EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id) AND app_can_see_user(user_id));
--> statement-breakpoint
CREATE POLICY scoped ON meeting_notes FOR ALL TO selah_app
  USING (app_can_see_engagement(engagement_id) AND app_label_ok(visibility, client_org_id, author_id))
  WITH CHECK (app_can_see_engagement(engagement_id) AND app_label_ok(visibility, client_org_id, author_id));
--> statement-breakpoint
CREATE POLICY scoped ON follow_ups FOR ALL TO selah_app
  USING (app_can_see_engagement(engagement_id) AND app_label_ok(visibility, client_org_id, created_by))
  WITH CHECK (app_can_see_engagement(engagement_id) AND app_label_ok(visibility, client_org_id, created_by));
--> statement-breakpoint
CREATE POLICY scoped ON reports FOR ALL TO selah_app
  USING (app_can_see_engagement(engagement_id) AND app_label_ok(visibility, client_org_id, generated_by))
  WITH CHECK (app_can_see_engagement(engagement_id) AND app_label_ok(visibility, client_org_id, generated_by));
--> statement-breakpoint

-- History tables: read within the engagement, insert only as yourself.
CREATE POLICY scoped_read ON progress_updates FOR SELECT TO selah_app USING (app_can_see_engagement(engagement_id));
--> statement-breakpoint
CREATE POLICY scoped_insert ON progress_updates FOR INSERT TO selah_app
  WITH CHECK (app_can_see_engagement(engagement_id) AND author_id = app_uid());
--> statement-breakpoint
CREATE POLICY scoped_read ON evidence_submissions FOR SELECT TO selah_app USING (app_can_see_engagement(engagement_id));
--> statement-breakpoint
CREATE POLICY scoped_insert ON evidence_submissions FOR INSERT TO selah_app
  WITH CHECK (app_can_see_engagement(engagement_id) AND submitted_by = app_uid() AND app_org_kind() = 'client');
--> statement-breakpoint
CREATE POLICY scoped_read ON reviews FOR SELECT TO selah_app USING (app_can_see_engagement(engagement_id));
--> statement-breakpoint
-- Only Maayish staff can record a review. A client can never verify work.
CREATE POLICY scoped_insert ON reviews FOR INSERT TO selah_app
  WITH CHECK (
    app_can_see_engagement(engagement_id) AND reviewer_id = app_uid()
    AND app_role() IN ('maayish_lead', 'consultant')
  );
--> statement-breakpoint
CREATE POLICY scoped_read ON activity_events FOR SELECT TO selah_app
  USING (app_can_see_engagement(engagement_id) AND app_label_ok(visibility, client_org_id, actor_id));
--> statement-breakpoint
CREATE POLICY scoped_insert ON activity_events FOR INSERT TO selah_app
  WITH CHECK (app_can_see_engagement(engagement_id) AND actor_id = app_uid());
--> statement-breakpoint
CREATE POLICY write_only ON audit_log FOR INSERT TO selah_app WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY own ON notifications FOR SELECT TO selah_app USING (user_id = app_uid());
--> statement-breakpoint
CREATE POLICY own_update ON notifications FOR UPDATE TO selah_app USING (user_id = app_uid()) WITH CHECK (user_id = app_uid());
--> statement-breakpoint
CREATE POLICY notify ON notifications FOR INSERT TO selah_app WITH CHECK (app_can_see_user(user_id));
--> statement-breakpoint

-- ------------------------------------------------------------------ AI

CREATE POLICY scoped ON ai_chunks FOR ALL TO selah_app
  USING (app_can_see_engagement(engagement_id) AND app_label_ok(visibility, client_org_id, owner_user_id))
  WITH CHECK (app_can_see_engagement(engagement_id) AND app_label_ok(visibility, client_org_id, owner_user_id));
--> statement-breakpoint
CREATE POLICY own ON ai_conversations FOR ALL TO selah_app
  USING (user_id = app_uid() AND app_can_see_engagement(engagement_id))
  WITH CHECK (user_id = app_uid() AND app_can_see_engagement(engagement_id));
--> statement-breakpoint
CREATE POLICY own ON ai_messages FOR ALL TO selah_app
  USING (user_id = app_uid())
  WITH CHECK (user_id = app_uid() AND EXISTS (SELECT 1 FROM ai_conversations c WHERE c.id = conversation_id));
--> statement-breakpoint

-- ---------------------------------------------------- integrity guards

-- History is append-only, even for the schema owner (truncate still works
-- for resetting a test database).
CREATE FUNCTION forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON progress_updates FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON evidence_submissions FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON reviews FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON activity_events FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint

-- Maayish roles only in the Maayish org, client roles only in client orgs.
CREATE FUNCTION check_membership_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k org_kind;
BEGIN
  SELECT kind INTO k FROM organizations WHERE id = NEW.org_id;
  IF (k = 'maayish') <> (NEW.role IN ('maayish_lead', 'consultant')) THEN
    RAISE EXCEPTION 'role % does not belong in a % organization', NEW.role, k USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER membership_role BEFORE INSERT OR UPDATE ON org_memberships FOR EACH ROW EXECUTE FUNCTION check_membership_role();
--> statement-breakpoint

-- Engagements always pair one Maayish org with one client org.
CREATE FUNCTION check_engagement_orgs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (SELECT kind FROM organizations WHERE id = NEW.client_org_id) <> 'client'
     OR (SELECT kind FROM organizations WHERE id = NEW.maayish_org_id) <> 'maayish' THEN
    RAISE EXCEPTION 'engagement must link a client org and the Maayish org' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER engagement_orgs BEFORE INSERT OR UPDATE ON engagements FOR EACH ROW EXECUTE FUNCTION check_engagement_orgs();
--> statement-breakpoint

-- Which status moves exist (who may make them is checked in authz/workflow.ts).
-- Verified Complete additionally needs an 'accept' review as the latest review.
CREATE FUNCTION check_action_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF (OLD.status, NEW.status) NOT IN (
    ('draft', 'assigned'),
    ('assigned', 'in_progress'),
    ('in_progress', 'blocked'),
    ('blocked', 'in_progress'),
    ('in_progress', 'awaiting_review'),
    ('awaiting_review', 'verified_complete'),
    ('awaiting_review', 'revision_requested'),
    ('revision_requested', 'in_progress')
  ) THEN
    RAISE EXCEPTION 'invalid action status change % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'verified_complete' AND COALESCE((
    SELECT r.outcome FROM reviews r WHERE r.action_id = NEW.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1
  ), 'reject') <> 'accept' THEN
    RAISE EXCEPTION 'verified_complete needs an accept review' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER action_transition BEFORE UPDATE ON actions FOR EACH ROW EXECUTE FUNCTION check_action_transition();
--> statement-breakpoint

-- Pull a document's chunks out of the AI index the moment it is unshared,
-- relabelled, archived, deleted or has its AI flag turned off.
CREATE FUNCTION drop_document_chunks() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM ai_chunks WHERE source_type = 'document' AND source_id = OLD.id;
    RETURN OLD;
  END IF;
  IF NOT NEW.ai_indexable OR NEW.visibility <> OLD.visibility OR NEW.state = 'archived' THEN
    DELETE FROM ai_chunks WHERE source_type = 'document' AND source_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_chunks AFTER UPDATE OF ai_indexable, visibility, state OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION drop_document_chunks();
