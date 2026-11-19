-- Classification leaks found by the phase 3 assessment (area 2,
-- docs/review/work/phase3-classification.md). Each one carried a labelled
-- item, or a number built from one, to someone the label keeps it from.
-- No product rule changes: the database now does what the screens promise.
--
-- 1. The leaving-person report and the hand-over (L1, S1). The report runs
--    past row-level security, so it showed a client admin the title of an
--    action released under a firm-only recommendation, and the hand-over
--    (which works on the same list) moved that action for them. A caller at
--    the client now gets only actions they may read: the recommendation's
--    label and the action's department. Such an action neither shows nor
--    blocks the switch-off for them; the firm sees it in its own report and
--    settles it. The firm's view is unchanged. Latest: 0076.
CREATE OR REPLACE FUNCTION app_person_holdings_of(uid uuid)
RETURNS TABLE (kind text, entity_id uuid, project_id uuid, org_id uuid, title text, detail text, blocking boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- open actions they own (a draft only for the firm; at the client, only what the caller may read)
  SELECT 'action', a.id, a.project_id, a.org_id, a.title, a.status::text, true
  FROM actions a JOIN projects p ON p.id = a.project_id
  WHERE a.owner_user_id = uid AND a.status NOT IN ('verified_complete', 'closed') AND p.state <> 'closed'
    AND (a.status <> 'draft' OR app_org_kind() = 'firm')
    AND (app_org_kind() = 'firm' OR (app_recommendation_label_ok(a.recommendation_id) AND app_dept_ok(a.department_id, a.org_id)))
  UNION ALL
  -- clients they lead (prospects included: whoever pitched leads them)
  SELECT 'client_lead', o.id, NULL, o.id, o.name, o.name_ar, true
  FROM client_assignments ca JOIN organizations o ON o.id = ca.client_org_id
  WHERE ca.user_id = uid AND ca.is_lead AND o.status = 'active'
  UNION ALL
  -- projects they lead
  SELECT 'project_lead', p.id, p.id, p.org_id, p.title, p.state::text, true
  FROM project_members pm JOIN projects p ON p.id = pm.project_id
  WHERE pm.user_id = uid AND pm.is_lead AND p.state <> 'closed'
  UNION ALL
  -- work waiting for review that only they can do: they are staffed on the
  -- project or lead its client, and no other active firm person is (being
  -- on the client's team alone does not open its projects)
  SELECT 'review', a.id, a.project_id, a.org_id, a.title, NULL, true
  FROM actions a JOIN projects p ON p.id = a.project_id
  WHERE a.status = 'awaiting_review' AND p.state <> 'closed'
    AND (app_org_kind() = 'firm' OR (app_recommendation_label_ok(a.recommendation_id) AND app_dept_ok(a.department_id, a.org_id)))
    AND EXISTS (
      SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = uid AND NOT pm.observer
      UNION ALL
      SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = p.org_id AND ca.user_id = uid AND ca.is_lead AND p.kind = 'client'
    )
    AND NOT EXISTS (
      SELECT 1 FROM (
        SELECT pm.user_id FROM project_members pm WHERE pm.project_id = p.id AND NOT pm.observer
        UNION
        SELECT ca.user_id FROM client_assignments ca WHERE ca.client_org_id = p.org_id AND ca.is_lead AND p.kind = 'client'
      ) other
      JOIN org_memberships m ON m.user_id = other.user_id AND m.org_id = p.firm_org_id AND m.active
      WHERE other.user_id <> uid
    )
  UNION ALL
  -- named client roles (sponsor, coordinator, ...)
  SELECT 'client_role', r.id, r.project_id, r.org_id, p.title, r.role::text, false
  FROM project_client_roles r JOIN projects p ON p.id = r.project_id
  WHERE r.user_id = uid AND p.state <> 'closed'
  UNION ALL
  -- departments they head
  SELECT 'department_head', d.id, NULL, d.org_id, coalesce(d.name_en, d.name_ar), d.name_ar, false
  FROM department_members dm JOIN departments d ON d.id = dm.department_id
  WHERE dm.user_id = uid AND dm.is_head
$$;
--> statement-breakpoint
-- 2. A withdrawn file's activity event (L3). It was stored "shared" with the
--    file's name and the reason, so each side read the other's private file
--    name. It now takes the file's label and carries neither (the reason
--    stays on the file itself, read under the file's own rules). The audit
--    row drops the name in the service (services/documents.ts). Latest: 0018.
CREATE OR REPLACE FUNCTION app_withdraw_document(doc uuid, reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d documents%ROWTYPE;
BEGIN
  SELECT * INTO d FROM documents WHERE id = doc;
  IF d.id IS NULL OR NOT app_can_see_project(d.project_id) OR d.uploaded_by IS DISTINCT FROM app_uid() THEN
    RAISE EXCEPTION 'only the person who uploaded a file withdraws it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF d.purpose = 'evidence' THEN
    RAISE EXCEPTION 'evidence is returned by the reviewer, not withdrawn' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT p.state FROM projects p WHERE p.id = d.project_id) = 'closed' THEN
    RAISE EXCEPTION 'a closed project''s files stay as they are' USING ERRCODE = 'check_violation';
  END IF;
  IF d.state = 'archived' THEN
    RAISE EXCEPTION 'this file is already archived' USING ERRCODE = 'check_violation';
  END IF;
  IF d.supersedes_id IS NOT NULL OR EXISTS (SELECT 1 FROM documents n WHERE n.supersedes_id = doc) THEN
    RAISE EXCEPTION 'a file with versions is replaced by a new version, not withdrawn' USING ERRCODE = 'check_violation';
  END IF;
  IF app_document_settled(doc) THEN
    RAISE EXCEPTION 'this file was already relied on and stays on record' USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(btrim(coalesce(reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'say why the file is withdrawn' USING ERRCODE = 'check_violation';
  END IF;
  -- Items it answered ask again once their last file goes.
  DELETE FROM info_request_files WHERE document_id = doc;
  -- A draft assessment stops citing it.
  DELETE FROM assessment_evidence WHERE document_id = doc;
  PERFORM set_config('selah.withdraw', doc::text, true);
  UPDATE documents SET state = 'archived', ai_indexable = false,
    withdrawn_at = now(), withdrawn_by = app_uid(), withdrawn_reason = btrim(reason)
  WHERE id = doc;
  PERFORM set_config('selah.withdraw', '', true);
  INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, visibility)
    VALUES (d.project_id, d.org_id, app_uid(), 'document', doc, 'document_withdrawn', d.visibility);
END $$;
--> statement-breakpoint
-- 3. Whether the caller may read a file by its label and department, past
--    row-level security. True for a file that no longer exists (the event
--    keeps its own label then).
CREATE FUNCTION app_document_label_ok(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT app_label_ok(d.visibility, d.org_id, d.uploaded_by) AND app_dept_ok(d.department_id, d.org_id)
    FROM documents d WHERE d.id = doc
  ), true)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_document_label_ok(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_document_label_ok(uuid) TO selah_app;
--> statement-breakpoint
-- An event about a file is read only by someone the file's label lets in,
-- like recommendation_label for actions (0078). Events are append-only and
-- are not rewritten: this also hides the withdrawals stored "shared" with a
-- name before this migration from the side that cannot open the file.
CREATE POLICY document_label ON activity_events AS RESTRICTIVE FOR SELECT TO selah_app
  USING (entity_type <> 'document' OR app_document_label_ok(entity_id));
--> statement-breakpoint
-- 4. The numbers a report freezes (L4). A report is made for the client, and
--    the firm froze its own view, which counts actions under firm-only (and
--    a consultant's private) recommendations. With client_side the count
--    keeps to actions under shared recommendations, the same work the
--    client's own screens count. Live firm screens are unchanged. Latest: 0079.
DROP FUNCTION app_project_progress(uuid, date);
--> statement-breakpoint
CREATE FUNCTION app_project_progress(pid uuid, today date DEFAULT app_firm_today(), client_side boolean DEFAULT false)
RETURNS TABLE (
  total integer, verified integer, partially integer, risk_accepted integer, not_applicable integer,
  superseded integer, open integer, overdue integer, implemented_pct numeric,
  extended integer, extended_twice integer, slip_days integer,
  late_d1_30 integer, late_d31_60 integer, late_d61_90 integer, late_d90_plus integer
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH a AS (
    SELECT * FROM actions x WHERE x.project_id = pid AND x.status <> 'draft'
      AND (NOT client_side OR x.recommendation_id IS NULL
           OR EXISTS (SELECT 1 FROM recommendations r WHERE r.id = x.recommendation_id AND r.visibility = 'shared'))
  ),
  s AS (SELECT sl.* FROM app_action_slips(pid, today) sl WHERE sl.action_id IN (SELECT a.id FROM a))
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE status = 'verified_complete')::int,
    count(*) FILTER (WHERE closure_outcome = 'partially_implemented')::int,
    count(*) FILTER (WHERE closure_outcome = 'risk_accepted')::int,
    count(*) FILTER (WHERE closure_outcome = 'not_applicable')::int,
    count(*) FILTER (WHERE closure_outcome = 'superseded')::int,
    count(*) FILTER (WHERE closure_outcome IS NULL AND status <> 'verified_complete')::int,
    count(*) FILTER (WHERE closure_outcome IS NULL AND status <> 'verified_complete' AND a.due_date < today)::int,
    round(100.0 * count(*) FILTER (WHERE status = 'verified_complete') / nullif(count(*) FILTER (WHERE closure_outcome IS NULL OR closure_outcome NOT IN ('not_applicable', 'superseded')), 0), 1),
    (SELECT count(*) FROM s WHERE s.extensions >= 1)::int,
    (SELECT count(*) FROM s WHERE s.extensions >= 2)::int,
    (SELECT coalesce(sum(s.slip_days), 0) FROM s)::int,
    (SELECT count(*) FROM s WHERE s.bucket = 'd1_30')::int,
    (SELECT count(*) FROM s WHERE s.bucket = 'd31_60')::int,
    (SELECT count(*) FROM s WHERE s.bucket = 'd61_90')::int,
    (SELECT count(*) FROM s WHERE s.bucket = 'd90_plus')::int
  FROM a
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_project_progress(uuid, date, boolean) TO selah_app;
--> statement-breakpoint
-- 5. The stored monthly history (L5). app_snapshot_metrics counts every
--    released action, firm-only and every department included, and the
--    Progress tab draws the history for the firm only (lib/progress-parts.ts).
--    The rows are now the firm's too. Latest: baseline.
DROP POLICY scoped_read ON metric_snapshots;
--> statement-breakpoint
CREATE POLICY scoped_read ON metric_snapshots FOR SELECT TO selah_app
  USING (app_can_see_project(project_id) AND app_org_kind() = 'firm');
--> statement-breakpoint
-- 6. A file answering a confidential request, across its versions (C1).
--    The rule looked only at the file attached to the request, and a new
--    version is never attached, so the client could switch the assistant on
--    for version 2. Every version in the chain now answers the request.
CREATE FUNCTION app_document_chain(doc uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH RECURSIVE up AS (
    SELECT d.id, d.supersedes_id FROM documents d WHERE d.id = doc
    UNION
    SELECT d.id, d.supersedes_id FROM documents d JOIN up ON d.id = up.supersedes_id
  ), down AS (
    SELECT d.id FROM documents d WHERE d.id = doc
    UNION
    SELECT d.id FROM documents d JOIN down ON d.supersedes_id = down.id
  )
  SELECT id FROM up UNION SELECT id FROM down
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_document_chain(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION app_document_answers_confidential(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM info_request_files f JOIN info_requests r ON r.id = f.request_id
    WHERE f.document_id IN (SELECT app_document_chain(doc)) AND r.sensitivity = 'confidential'
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_document_answers_confidential(uuid) FROM PUBLIC;
--> statement-breakpoint
-- Switching the assistant on (latest: 0016), and a new version that would
-- arrive with it on.
CREATE OR REPLACE FUNCTION check_confidential_file() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.ai_indexable AND (TG_OP = 'INSERT' OR NOT OLD.ai_indexable)
     AND app_document_answers_confidential(coalesce(CASE WHEN TG_OP = 'INSERT' THEN NEW.supersedes_id END, NEW.id)) THEN
    RAISE EXCEPTION 'a file answering a confidential request stays out of the assistant' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER confidential_file_version BEFORE INSERT ON documents
  FOR EACH ROW WHEN (NEW.supersedes_id IS NOT NULL AND NEW.ai_indexable) EXECUTE FUNCTION check_confidential_file();
--> statement-breakpoint
-- Attaching a file to a confidential request: no version of it may be with
-- the assistant (latest: 0016).
CREATE OR REPLACE FUNCTION check_info_request_file() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r info_requests%ROWTYPE;
  d documents%ROWTYPE;
BEGIN
  SELECT * INTO r FROM info_requests WHERE id = NEW.request_id;
  SELECT * INTO d FROM documents WHERE id = NEW.document_id;
  IF r.status NOT IN ('requested', 'received') THEN
    RAISE EXCEPTION 'this request is not open for files' USING ERRCODE = 'check_violation';
  END IF;
  IF d.project_id <> r.project_id OR d.org_id <> r.org_id OR d.state = 'archived' OR d.visibility <> 'shared' THEN
    RAISE EXCEPTION 'answer with a file of this project that both sides can see' USING ERRCODE = 'check_violation';
  END IF;
  IF r.sensitivity = 'confidential' AND EXISTS (
    SELECT 1 FROM documents v WHERE v.id IN (SELECT app_document_chain(d.id)) AND v.ai_indexable
  ) THEN
    RAISE EXCEPTION 'turn the assistant off for this file first: the request is confidential' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Marking a request confidential: no version of its files may be with the
-- assistant. The request trigger (0016) keeps its own check for the
-- attached files; this adds their other versions.
CREATE FUNCTION check_info_request_versions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.sensitivity = 'confidential' AND OLD.sensitivity <> 'confidential' AND EXISTS (
    SELECT 1 FROM info_request_files f, LATERAL app_document_chain(f.document_id) c(id)
    JOIN documents v ON v.id = c.id
    WHERE f.request_id = NEW.id AND v.ai_indexable
  ) THEN
    RAISE EXCEPTION 'turn the assistant off for its files first' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_info_request_versions() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER info_request_versions BEFORE UPDATE OF sensitivity ON info_requests
  FOR EACH ROW EXECUTE FUNCTION check_info_request_versions();
--> statement-breakpoint
-- 7. Renaming or refiling a file (C3). The row policy on documents is FOR
--    ALL, so anyone who could read a file could change its title or its
--    department (which also hides it from other departments). No screen
--    does either; the database now agrees: only the person who uploaded it,
--    or an admin of the side that owns it. Moves made inside the database's
--    own functions (a department's work moved by the firm admin, 0078) and
--    jobs are not stopped.
CREATE FUNCTION check_document_rename() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'selah_app' AND app_uid() IS NOT NULL
     AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.department_id IS DISTINCT FROM OLD.department_id)
     AND NOT (OLD.uploaded_by = app_uid()
              OR (app_org() = OLD.owner_org_id AND app_role() IN ('firm_admin', 'client_admin'))) THEN
    RAISE EXCEPTION 'only the person who uploaded a file, or an admin of its side, renames or refiles it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_rename BEFORE UPDATE OF title, department_id ON documents
  FOR EACH ROW EXECUTE FUNCTION check_document_rename();
