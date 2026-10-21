-- Assessment templates and assessments (2026-10-21, docs/assessments.md).
--
--  a. Templates belong to the firm. Its members read them; the firm admin
--     and the consultants the admin names (template_authors) write them.
--     Clients never see a template, only the questions of an assessment the
--     firm has finalised and shared with them.
--  b. A published version never changes. Editing it starts a new draft,
--     copied by app_copy_template_version(), which also duplicates a
--     template. Archiving a template keeps it off new assessments.
--  c. An assessment of a client project uses one published version. Each
--     question's basis (legal requirement, regulator guidance, good practice,
--     the firm's method, the team's proposal) is worked out from the client's
--     legal form when the assessment is created and kept on its answer.
--  d. Scoring is fixed and visible (app_assessment_results). A gap is only
--     suggested: a consultant confirms it as a finding, and from there the
--     existing recommendations, actions, evidence and reviews carry it.
--  e. Follow-up per gap keeps reported, evidenced and verified apart.

-- ------------------------------------------------------------- a. access

GRANT SELECT, INSERT, DELETE ON template_authors TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON assessment_templates TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON template_versions, template_sections, template_questions TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON assessments TO selah_app;
--> statement-breakpoint
GRANT SELECT, UPDATE ON assessment_answers TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON assessment_evidence TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON assessment_notes TO selah_app;
--> statement-breakpoint
ALTER TABLE template_authors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assessment_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE template_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE template_sections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE template_questions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assessment_answers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assessment_evidence ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assessment_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The firm admin, or a consultant the admin named, of this firm.
CREATE FUNCTION app_is_template_author(firm uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT firm = app_org() AND app_org_kind() = 'firm' AND (
    app_role() = 'firm_admin'
    OR (app_role() = 'consultant' AND EXISTS (SELECT 1 FROM template_authors t WHERE t.firm_org_id = firm AND t.user_id = app_uid())))
$$;
--> statement-breakpoint
-- The firm's members, and the client admins and managers of a project whose
-- final assessment on this version was shared with them.
CREATE FUNCTION app_can_see_template_version(vid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM template_versions v WHERE v.id = vid AND v.firm_org_id = app_org() AND app_org_kind() = 'firm')
    OR (app_role() IN ('client_admin', 'client_manager') AND EXISTS (
      SELECT 1 FROM assessments a
      WHERE a.template_version_id = vid AND a.status = 'final' AND a.shared_with_client AND a.org_id = app_org()
        AND app_can_see_project(a.project_id)))
$$;
--> statement-breakpoint
-- Firm staff who can see the project; client admins and managers once the
-- firm has finalised and shared it.
CREATE FUNCTION app_can_see_assessment(aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM assessments a
    WHERE a.id = aid AND app_can_see_project(a.project_id) AND (
      app_org_kind() = 'firm'
      OR (app_role() IN ('client_admin', 'client_manager') AND a.status = 'final' AND a.shared_with_client)))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_is_template_author(uuid), app_can_see_template_version(uuid), app_can_see_assessment(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_is_template_author(uuid), app_can_see_template_version(uuid), app_can_see_assessment(uuid) TO selah_app;
--> statement-breakpoint
CREATE POLICY firm_read ON template_authors FOR SELECT TO selah_app
  USING (firm_org_id = app_org() AND app_org_kind() = 'firm');
--> statement-breakpoint
CREATE POLICY admin_write ON template_authors FOR ALL TO selah_app
  USING (firm_org_id = app_org() AND app_role() = 'firm_admin')
  WITH CHECK (firm_org_id = app_org() AND app_role() = 'firm_admin' AND granted_by = app_uid());
--> statement-breakpoint
CREATE POLICY firm_read ON assessment_templates FOR SELECT TO selah_app
  USING ((firm_org_id = app_org() AND app_org_kind() = 'firm')
         OR EXISTS (SELECT 1 FROM template_versions v WHERE v.template_id = assessment_templates.id AND app_can_see_template_version(v.id)));
--> statement-breakpoint
CREATE POLICY author_insert ON assessment_templates FOR INSERT TO selah_app
  WITH CHECK (app_is_template_author(firm_org_id) AND created_by = app_uid());
--> statement-breakpoint
CREATE POLICY author_update ON assessment_templates FOR UPDATE TO selah_app
  USING (app_is_template_author(firm_org_id)) WITH CHECK (app_is_template_author(firm_org_id));
--> statement-breakpoint
CREATE POLICY scoped_read ON template_versions FOR SELECT TO selah_app USING (app_can_see_template_version(id));
--> statement-breakpoint
CREATE POLICY author_write ON template_versions FOR ALL TO selah_app
  USING (app_is_template_author(firm_org_id)) WITH CHECK (app_is_template_author(firm_org_id));
--> statement-breakpoint
CREATE POLICY scoped_read ON template_sections FOR SELECT TO selah_app USING (app_can_see_template_version(version_id));
--> statement-breakpoint
CREATE POLICY author_write ON template_sections FOR ALL TO selah_app
  USING (app_is_template_author(firm_org_id)) WITH CHECK (app_is_template_author(firm_org_id));
--> statement-breakpoint
CREATE POLICY scoped_read ON template_questions FOR SELECT TO selah_app USING (app_can_see_template_version(version_id));
--> statement-breakpoint
CREATE POLICY author_write ON template_questions FOR ALL TO selah_app
  USING (app_is_template_author(firm_org_id)) WITH CHECK (app_is_template_author(firm_org_id));
--> statement-breakpoint
CREATE POLICY scoped_read ON assessments FOR SELECT TO selah_app
  USING (app_can_see_project(project_id) AND (
    app_org_kind() = 'firm' OR (app_role() IN ('client_admin', 'client_manager') AND status = 'final' AND shared_with_client)));
--> statement-breakpoint
CREATE POLICY firm_insert ON assessments FOR INSERT TO selah_app
  WITH CHECK (app_org_kind() = 'firm' AND firm_org_id = app_org() AND app_can_see_project(project_id) AND created_by = app_uid());
--> statement-breakpoint
CREATE POLICY firm_update ON assessments FOR UPDATE TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id))
  WITH CHECK (app_org_kind() = 'firm' AND app_can_see_project(project_id));
--> statement-breakpoint
CREATE POLICY scoped_read ON assessment_answers FOR SELECT TO selah_app USING (app_can_see_assessment(assessment_id));
--> statement-breakpoint
CREATE POLICY firm_update ON assessment_answers FOR UPDATE TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id))
  WITH CHECK (app_org_kind() = 'firm' AND app_can_see_project(project_id));
--> statement-breakpoint
-- The client sees evidence rows only for files shared with it.
CREATE POLICY scoped_read ON assessment_evidence FOR SELECT TO selah_app
  USING (EXISTS (SELECT 1 FROM assessment_answers x WHERE x.id = answer_id AND app_can_see_assessment(x.assessment_id))
         AND (app_org_kind() = 'firm' OR EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id AND d.visibility = 'shared')));
--> statement-breakpoint
CREATE POLICY firm_write ON assessment_evidence FOR ALL TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id))
  WITH CHECK (app_org_kind() = 'firm' AND app_can_see_project(project_id) AND added_by = app_uid());
--> statement-breakpoint
-- The firm's notes on answers: firm staff on the project, never the client.
CREATE POLICY firm_only ON assessment_notes FOR ALL TO selah_app
  USING (app_org_kind() = 'firm' AND app_can_see_project(project_id))
  WITH CHECK (app_org_kind() = 'firm' AND app_can_see_project(project_id) AND updated_by = app_uid());
--> statement-breakpoint
CREATE FUNCTION check_assessment_note() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE x assessment_answers%ROWTYPE;
BEGIN
  IF current_setting('selah.purge', true) = 'on' AND current_user NOT IN ('selah_app', 'selah_auth') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO x FROM assessment_answers WHERE id = NEW.answer_id;
  NEW.project_id := x.project_id;
  NEW.org_id := x.org_id;
  IF app_uid() IS NOT NULL THEN
    NEW.updated_by := app_uid();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER note_rules BEFORE INSERT OR UPDATE ON assessment_notes FOR EACH ROW EXECUTE FUNCTION check_assessment_note();
--> statement-breakpoint
-- An author is an active consultant of the firm.
CREATE FUNCTION check_template_author() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM org_memberships m
                 WHERE m.user_id = NEW.user_id AND m.org_id = NEW.firm_org_id AND m.active AND m.role = 'consultant') THEN
    RAISE EXCEPTION 'template authors are active consultants of the firm' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER template_author BEFORE INSERT ON template_authors FOR EACH ROW EXECUTE FUNCTION check_template_author();
--> statement-breakpoint
CREATE FUNCTION log_template_author() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r template_authors%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome)
    VALUES (app_uid(), r.firm_org_id, CASE WHEN TG_OP = 'DELETE' THEN 'template_author.remove' ELSE 'template_author.add' END,
            'user', r.user_id, 'allow');
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER template_author_log AFTER INSERT OR DELETE ON template_authors FOR EACH ROW EXECUTE FUNCTION log_template_author();
--> statement-breakpoint

-- ------------------------------------------------------- b. stable versions

CREATE FUNCTION check_assessment_template() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.firm_org_id <> OLD.firm_org_id OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'a template stays with its firm' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER template_rules BEFORE UPDATE ON assessment_templates FOR EACH ROW EXECUTE FUNCTION check_assessment_template();
--> statement-breakpoint
-- Versions are numbered in order and start as drafts. A draft may be
-- published (once it has questions, and each section has one) or discarded.
-- A published version is never changed or deleted.
CREATE FUNCTION check_template_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' AND EXISTS (SELECT 1 FROM assessment_templates t WHERE t.id = OLD.template_id) THEN
      RAISE EXCEPTION 'a published version is kept' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'a version starts as a draft' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM 1 FROM assessment_templates t WHERE t.id = NEW.template_id FOR UPDATE;
    NEW.version := coalesce((SELECT max(v.version) FROM template_versions v WHERE v.template_id = NEW.template_id), 0) + 1;
    NEW.published_by := NULL;
    NEW.published_at := NULL;
    IF app_uid() IS NOT NULL THEN
      NEW.created_by := app_uid();
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'a published version cannot be changed: start a new draft' USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'published_by', 'published_at']) <> (to_jsonb(OLD) - ARRAY['status', 'published_by', 'published_at']) THEN
    RAISE EXCEPTION 'a version keeps its template and number' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'published' THEN
    IF EXISTS (SELECT 1 FROM assessment_templates t WHERE t.id = NEW.template_id AND t.archived_at IS NOT NULL) THEN
      RAISE EXCEPTION 'the template is archived' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM template_questions q WHERE q.version_id = NEW.id)
       OR EXISTS (SELECT 1 FROM template_sections s WHERE s.version_id = NEW.id
                  AND NOT EXISTS (SELECT 1 FROM template_questions q WHERE q.section_id = s.id)) THEN
      RAISE EXCEPTION 'give every section at least one question before publishing' USING ERRCODE = 'check_violation';
    END IF;
    NEW.published_by := app_uid();
    NEW.published_at := now();
  ELSE
    NEW.published_by := NULL;
    NEW.published_at := NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER version_rules BEFORE INSERT OR UPDATE OR DELETE ON template_versions FOR EACH ROW EXECUTE FUNCTION check_template_version();
--> statement-breakpoint
CREATE FUNCTION log_template_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'published' AND OLD.status = 'draft' THEN
    INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
      VALUES (app_uid(), NEW.firm_org_id, 'template.publish', 'template_version', NEW.id, 'allow',
              jsonb_build_object('template_id', NEW.template_id, 'version', NEW.version));
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER version_log AFTER UPDATE ON template_versions FOR EACH ROW EXECUTE FUNCTION log_template_version();
--> statement-breakpoint
-- Sections and questions change only while their version is a draft (or
-- go with it when a draft is discarded). Questions are checked for shape.
CREATE FUNCTION check_template_content() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  st template_version_status;
  vid uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  dep template_questions%ROWTYPE;
  allowed text[];
BEGIN
  SELECT v.status INTO st FROM template_versions v WHERE v.id = vid;
  IF TG_OP = 'UPDATE' AND NEW.version_id <> OLD.version_id THEN
    RAISE EXCEPTION 'content stays in its version' USING ERRCODE = 'check_violation';
  END IF;
  IF st = 'published' THEN
    RAISE EXCEPTION 'a published version cannot be changed: start a new draft' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'template_questions' THEN
    IF (NEW.type = 'multiple_choice') <> (NEW.options IS NOT NULL) THEN
      RAISE EXCEPTION 'multiple-choice questions, and only they, list options' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.options IS NOT NULL AND (
      jsonb_typeof(NEW.options) <> 'array' OR jsonb_array_length(NEW.options) < 2
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.options) o
                 WHERE jsonb_typeof(o) <> 'object' OR jsonb_typeof(o -> 'value') IS DISTINCT FROM 'string'
                   OR nullif(trim(o ->> 'value'), '') IS NULL OR o ->> 'value' = 'na'
                   OR jsonb_typeof(o -> 'label') IS DISTINCT FROM 'string'
                   OR jsonb_typeof(o -> 'points') IS DISTINCT FROM 'number'
                   OR (o ->> 'points')::numeric <> floor((o ->> 'points')::numeric) OR (o ->> 'points')::numeric < 0)
      OR (SELECT count(DISTINCT o ->> 'value') FROM jsonb_array_elements(NEW.options) o) <> jsonb_array_length(NEW.options)
    ) THEN
      RAISE EXCEPTION 'give at least two options, each with its own value, a label and whole points from 0' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.type = 'text' AND (NEW.gap_max_points IS NOT NULL OR NEW.weight <> 1) THEN
      RAISE EXCEPTION 'text questions are not scored' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.applies_if_question_id IS NOT NULL THEN
      SELECT * INTO dep FROM template_questions q WHERE q.id = NEW.applies_if_question_id;
      IF dep.version_id IS DISTINCT FROM NEW.version_id OR dep.id = NEW.id OR dep.type = 'text' THEN
        RAISE EXCEPTION 'a question can depend only on another scored question of the same version' USING ERRCODE = 'check_violation';
      END IF;
      allowed := CASE dep.type
        WHEN 'yes_no' THEN ARRAY['yes', 'partly', 'no', 'na']
        WHEN 'rating' THEN ARRAY['1', '2', '3', '4', 'na']
        ELSE ARRAY(SELECT o ->> 'value' FROM jsonb_array_elements(dep.options) o) || 'na'::text END;
      IF NOT NEW.applies_if_values <@ allowed THEN
        RAISE EXCEPTION 'the condition names an answer that question does not have' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.legal_for && NEW.guidance_for THEN
      RAISE EXCEPTION 'a legal form is either bound or guided, not both' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER content_rules BEFORE INSERT OR UPDATE OR DELETE ON template_sections FOR EACH ROW EXECUTE FUNCTION check_template_content();
--> statement-breakpoint
CREATE TRIGGER content_rules BEFORE INSERT OR UPDATE OR DELETE ON template_questions FOR EACH ROW EXECUTE FUNCTION check_template_content();
--> statement-breakpoint
-- A new draft of a version's content, in the same template (an edit) or in
-- another template of the same firm (a duplicate). With the caller's rights,
-- so only an author can make it.
CREATE FUNCTION app_copy_template_version(src uuid, target_template uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  firm uuid;
  nv uuid;
  s template_sections%ROWTYPE;
  q template_questions%ROWTYPE;
  ns uuid;
  qmap jsonb := '{}';
BEGIN
  SELECT v.firm_org_id INTO firm FROM template_versions v WHERE v.id = src;
  IF firm IS NULL OR NOT EXISTS (SELECT 1 FROM assessment_templates t WHERE t.id = target_template AND t.firm_org_id = firm) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO template_versions (template_id, firm_org_id, version, created_by)
    VALUES (target_template, firm, 0, app_uid()) RETURNING id INTO nv;
  FOR s IN SELECT * FROM template_sections WHERE version_id = src ORDER BY position LOOP
    INSERT INTO template_sections (version_id, firm_org_id, position, title, title_ar, description, description_ar)
      VALUES (nv, firm, s.position, s.title, s.title_ar, s.description, s.description_ar) RETURNING id INTO ns;
    FOR q IN SELECT * FROM template_questions WHERE section_id = s.id ORDER BY position LOOP
      qmap := qmap || jsonb_build_object(q.id::text, gen_random_uuid());
      INSERT INTO template_questions (id, version_id, section_id, firm_org_id, position, ref, prompt, prompt_ar, guidance, guidance_ar,
                                      type, options, weight, gap_max_points, basis, legal_for, guidance_for, citation, locator,
                                      citation_verified)
        VALUES ((qmap ->> q.id::text)::uuid, nv, ns, firm, q.position, q.ref, q.prompt, q.prompt_ar, q.guidance, q.guidance_ar,
                q.type, q.options, q.weight, q.gap_max_points, q.basis, q.legal_for, q.guidance_for, q.citation, q.locator,
                q.citation_verified);
    END LOOP;
  END LOOP;
  -- Conditions last, once every question they point at exists.
  FOR q IN SELECT * FROM template_questions WHERE version_id = src AND applies_if_question_id IS NOT NULL LOOP
    UPDATE template_questions SET applies_if_question_id = (qmap ->> q.applies_if_question_id::text)::uuid,
                                  applies_if_values = q.applies_if_values
      WHERE id = (qmap ->> q.id::text)::uuid;
  END LOOP;
  RETURN nv;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_copy_template_version(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_copy_template_version(uuid, uuid) TO selah_app;
--> statement-breakpoint

-- ----------------------------------------------------------- c. assessments

ALTER TABLE organizations ADD CONSTRAINT legal_form_clients CHECK (legal_form IS NULL OR kind = 'client');
--> statement-breakpoint
-- The firm admin records a client's legal form. Assessments already made
-- keep the one they were made with.
CREATE FUNCTION check_legal_form() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.legal_form IS DISTINCT FROM OLD.legal_form AND app_uid() IS NOT NULL AND app_role() IS DISTINCT FROM 'firm_admin' THEN
    RAISE EXCEPTION 'only the firm admin records a client''s legal form' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER legal_form BEFORE UPDATE OF legal_form ON organizations FOR EACH ROW EXECUTE FUNCTION check_legal_form();
--> statement-breakpoint
-- The basis of a question for a client of this legal form.
CREATE FUNCTION app_criterion_basis(q template_questions, form legal_form) RETURNS criterion_basis
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN form = ANY (q.legal_for) THEN 'legal_requirement'::criterion_basis
              WHEN form = ANY (q.guidance_for) THEN 'regulator_guidance'::criterion_basis
              ELSE q.basis END
$$;
--> statement-breakpoint
-- An assessment is of a client project, on a published version of a live
-- template of the project's firm, and takes the client's legal form.
CREATE FUNCTION check_assessment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  p projects%ROWTYPE;
  form legal_form;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO p FROM projects WHERE id = NEW.project_id;
    IF p.kind <> 'client' THEN
      RAISE EXCEPTION 'assessments are of client projects' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.firm_org_id <> p.firm_org_id THEN
      RAISE EXCEPTION 'the template must be the project firm''s' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM template_versions v JOIN assessment_templates t ON t.id = v.template_id
                   WHERE v.id = NEW.template_version_id AND v.status = 'published' AND t.archived_at IS NULL) THEN
      RAISE EXCEPTION 'assess against a published version of a template that is not archived' USING ERRCODE = 'check_violation';
    END IF;
    SELECT o.legal_form INTO form FROM organizations o WHERE o.id = NEW.org_id;
    IF form IS NULL THEN
      RAISE EXCEPTION 'record the client''s legal form first: it decides which criteria are legal requirements'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.legal_form := form;
    NEW.status := 'draft';
    NEW.shared_with_client := false;
    NEW.finalised_by := NULL;
    NEW.finalised_at := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.project_id, NEW.org_id, NEW.firm_org_id, NEW.template_version_id, NEW.legal_form, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.project_id, OLD.org_id, OLD.firm_org_id, OLD.template_version_id, OLD.legal_form, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'an assessment keeps its project, template and legal form' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  IF OLD.status = 'final' THEN
    IF NEW.status <> 'final' OR NEW.title <> OLD.title OR NEW.finalised_by IS DISTINCT FROM OLD.finalised_by
       OR NEW.finalised_at IS DISTINCT FROM OLD.finalised_at THEN
      RAISE EXCEPTION 'a final assessment is kept as it was: start a new one to reassess' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.shared_with_client AND NEW.status <> 'final' THEN
    RAISE EXCEPTION 'share an assessment once it is final' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'final' THEN
    IF EXISTS (SELECT 1 FROM app_assessment_results(NEW.id) r WHERE r.applicable AND r.type <> 'text' AND r.value IS NULL) THEN
      RAISE EXCEPTION 'answer every question that applies (or mark it not applicable) before finalising' USING ERRCODE = 'check_violation';
    END IF;
    NEW.finalised_by := app_uid();
    NEW.finalised_at := now();
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER assessment_rules BEFORE INSERT OR UPDATE ON assessments FOR EACH ROW EXECUTE FUNCTION check_assessment();
--> statement-breakpoint
-- Every question gets its row, with the basis worked out for this client.
CREATE FUNCTION make_assessment_answers() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO assessment_answers (assessment_id, project_id, org_id, question_id, basis)
    SELECT NEW.id, NEW.project_id, NEW.org_id, q.id, app_criterion_basis(q, NEW.legal_form)
    FROM template_questions q WHERE q.version_id = NEW.template_version_id;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER assessment_answers AFTER INSERT ON assessments FOR EACH ROW EXECUTE FUNCTION make_assessment_answers();
--> statement-breakpoint
CREATE FUNCTION log_assessment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status <> OLD.status OR NEW.shared_with_client <> OLD.shared_with_client THEN
    INSERT INTO activity_events (project_id, org_id, actor_id, event, entity_type, entity_id, from_state, to_state, visibility)
      VALUES (NEW.project_id, NEW.org_id, app_uid(),
              CASE WHEN TG_OP = 'INSERT' THEN 'assessment_started'
                   WHEN NEW.status <> OLD.status THEN 'assessment_finalised'
                   WHEN NEW.shared_with_client THEN 'assessment_shared' ELSE 'assessment_unshared' END,
              'assessment', NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status::text END, NEW.status::text,
              CASE WHEN NEW.shared_with_client THEN 'shared' ELSE 'firm_private' END::visibility);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER assessment_log AFTER INSERT OR UPDATE ON assessments FOR EACH ROW EXECUTE FUNCTION log_assessment();
--> statement-breakpoint
-- Answers change while the assessment is a draft, and only their answer.
-- The value must be one the question has. Who and when are set here.
CREATE FUNCTION check_assessment_answer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  q template_questions%ROWTYPE;
  answer_cols text[] := ARRAY['value', 'text_answer', 'comment', 'answered_by', 'answered_at'];
BEGIN
  IF current_setting('selah.purge', true) = 'on' AND current_user NOT IN ('selah_app', 'selah_auth') THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - answer_cols) <> (to_jsonb(OLD) - answer_cols) THEN
    RAISE EXCEPTION 'an answer stays with its question' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT a.status FROM assessments a WHERE a.id = NEW.assessment_id) <> 'draft' THEN
    RAISE EXCEPTION 'a final assessment is kept as it was: start a new one to reassess' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO q FROM template_questions WHERE id = NEW.question_id;
  IF NEW.value IS NOT NULL AND NOT NEW.value = ANY (CASE q.type
      WHEN 'yes_no' THEN ARRAY['yes', 'partly', 'no', 'na']
      WHEN 'rating' THEN ARRAY['1', '2', '3', '4', 'na']
      WHEN 'text' THEN ARRAY['na']
      ELSE ARRAY(SELECT o ->> 'value' FROM jsonb_array_elements(q.options) o) || 'na'::text END) THEN
    RAISE EXCEPTION 'that is not an answer to this question' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.text_answer IS NOT NULL AND q.type <> 'text' THEN
    RAISE EXCEPTION 'only text questions take a written answer; use the comment' USING ERRCODE = 'check_violation';
  END IF;
  NEW.answered_by := app_uid();
  NEW.answered_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER answer_rules BEFORE UPDATE ON assessment_answers FOR EACH ROW EXECUTE FUNCTION check_assessment_answer();
--> statement-breakpoint
-- Evidence for an answer is a file of the same project that the firm can
-- see, added or removed while the assessment is a draft.
CREATE FUNCTION check_assessment_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r assessment_evidence%ROWTYPE;
  x assessment_answers%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT * INTO x FROM assessment_answers WHERE id = r.answer_id;
  IF NOT FOUND THEN
    RETURN r; -- the assessment is going
  END IF;
  IF (SELECT a.status FROM assessments a WHERE a.id = x.assessment_id) <> 'draft' THEN
    RAISE EXCEPTION 'a final assessment is kept as it was: start a new one to reassess' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = NEW.document_id AND d.project_id = x.project_id
                 AND d.visibility IN ('shared', 'firm_private')) THEN
    RAISE EXCEPTION 'attach a file of this project that the firm can see' USING ERRCODE = 'check_violation';
  END IF;
  NEW.project_id := x.project_id;
  NEW.org_id := x.org_id;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER evidence_rules BEFORE INSERT OR DELETE ON assessment_evidence FOR EACH ROW EXECUTE FUNCTION check_assessment_evidence();
--> statement-breakpoint

-- ------------------------------------------------------ d. scores and gaps

-- One row per question, with the caller's rights. Points: yes 2, partly 1,
-- no 0; a rating of 1-4 scores 0-3; an option scores its points; times the
-- weight. Not scored: text, "na", unanswered, and a question whose condition
-- is not met. A gap is an applicable scored answer at or below the
-- question's gap_max_points (default half the maximum, rounded down).
CREATE FUNCTION app_assessment_results(aid uuid)
RETURNS TABLE (answer_id uuid, question_id uuid, section_id uuid, section_position integer, question_position integer, ref text,
               type assessment_question_type, basis criterion_basis, value text, applicable boolean, points integer,
               max_points integer, is_gap boolean, finding_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH base AS (
    SELECT x.id AS answer_id, q.id AS question_id, s.id AS section_id, s.position AS section_position, q.position AS question_position,
           q.ref, q.type, x.basis, x.value, q.weight, q.gap_max_points,
           (q.applies_if_question_id IS NULL OR coalesce(dep.value = ANY (q.applies_if_values), false)) AS cond_met,
           CASE q.type WHEN 'yes_no' THEN 2 WHEN 'rating' THEN 3
                WHEN 'multiple_choice' THEN (SELECT max((o ->> 'points')::integer) FROM jsonb_array_elements(q.options) o) END AS raw_max,
           CASE WHEN x.value IS NULL OR x.value = 'na' THEN NULL
                WHEN q.type = 'yes_no' THEN CASE x.value WHEN 'yes' THEN 2 WHEN 'partly' THEN 1 ELSE 0 END
                WHEN q.type = 'rating' THEN x.value::integer - 1
                WHEN q.type = 'multiple_choice' THEN
                  (SELECT (o ->> 'points')::integer FROM jsonb_array_elements(q.options) o WHERE o ->> 'value' = x.value) END AS raw
    FROM assessment_answers x
    JOIN template_questions q ON q.id = x.question_id
    JOIN template_sections s ON s.id = q.section_id
    LEFT JOIN assessment_answers dep ON dep.assessment_id = x.assessment_id AND dep.question_id = q.applies_if_question_id
    WHERE x.assessment_id = aid
  ),
  -- A condition on a question that does not apply itself is not met.
  app AS (
    SELECT b.*, b.cond_met AND NOT EXISTS (
      WITH RECURSIVE up(qid) AS (
        SELECT q.applies_if_question_id FROM template_questions q WHERE q.id = b.question_id
        UNION SELECT q.applies_if_question_id FROM template_questions q JOIN up ON q.id = up.qid
      )
      SELECT 1 FROM up JOIN base p ON p.question_id = up.qid WHERE NOT p.cond_met
    ) AS applicable
    FROM base b
  )
  SELECT a.answer_id, a.question_id, a.section_id, a.section_position, a.question_position, a.ref, a.type, a.basis, a.value, a.applicable,
         CASE WHEN a.applicable THEN a.raw * a.weight END,
         CASE WHEN a.applicable AND a.raw IS NOT NULL THEN a.raw_max * a.weight END,
         coalesce(a.applicable AND a.raw <= coalesce(a.gap_max_points, a.raw_max / 2), false),
         f.id
  FROM app a LEFT JOIN findings f ON f.assessment_answer_id = a.answer_id
  ORDER BY a.section_position, a.question_position
$$;
--> statement-breakpoint
-- Per section: points earned and possible (answered, applicable, scored
-- questions only), questions still to answer, and gaps.
CREATE FUNCTION app_assessment_scores(aid uuid)
RETURNS TABLE (section_id uuid, section_position integer, title text, title_ar text, earned integer, possible integer,
               to_answer integer, gaps integer, confirmed integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT s.id, s.position, s.title, s.title_ar,
         coalesce(sum(r.points), 0)::integer, coalesce(sum(r.max_points), 0)::integer,
         count(*) FILTER (WHERE r.applicable AND r.type <> 'text' AND r.value IS NULL)::integer,
         count(*) FILTER (WHERE r.is_gap)::integer,
         count(*) FILTER (WHERE r.is_gap AND r.finding_id IS NOT NULL)::integer
  FROM assessments a
  JOIN template_sections s ON s.version_id = a.template_version_id
  LEFT JOIN app_assessment_results(aid) r ON r.section_id = s.id
  WHERE a.id = aid
  GROUP BY s.id, s.position, s.title, s.title_ar
  ORDER BY s.position
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_assessment_results(uuid), app_assessment_scores(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_assessment_results(uuid), app_assessment_scores(uuid) TO selah_app;
--> statement-breakpoint
-- A finding confirmed from an assessment points at a gap of a final
-- assessment of the same project, and keeps pointing at it.
CREATE FUNCTION check_finding_answer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE x assessment_answers%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.assessment_answer_id IS DISTINCT FROM OLD.assessment_answer_id THEN
      RAISE EXCEPTION 'a finding keeps the answer it came from' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.assessment_answer_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO x FROM assessment_answers WHERE id = NEW.assessment_answer_id;
  IF x.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'the answer is not in this project' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT a.status FROM assessments a WHERE a.id = x.assessment_id) <> 'final' THEN
    RAISE EXCEPTION 'finalise the assessment before confirming its gaps' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT coalesce((SELECT r.is_gap FROM app_assessment_results(x.assessment_id) r WHERE r.answer_id = x.id), false) THEN
    RAISE EXCEPTION 'that answer is not a gap' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER finding_answer BEFORE INSERT OR UPDATE OF assessment_answer_id ON findings FOR EACH ROW EXECUTE FUNCTION check_finding_answer();
--> statement-breakpoint

-- ------------------------------------------------------------ e. follow-up

-- Per confirmed gap: its finding, the recommendations answering it, and
-- their released actions by state. Reported (awaiting review), evidenced
-- (evidence submitted) and verified (accepted by a review) are counted
-- apart and never added together: "evidenced" overlaps the other two.
-- Verified is split by whose evidence it rested on (app_verified_basis).
-- With the caller's rights.
CREATE FUNCTION app_assessment_followup(aid uuid)
RETURNS TABLE (answer_id uuid, ref text, finding_id uuid, finding_title text, recommendations integer, actions integer,
               reported integer, evidenced integer, verified integer, verified_client_evidence integer,
               verified_consultant_recorded integer, closed integer, overdue integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT x.id, q.ref, f.id, f.title,
         (SELECT count(*) FROM recommendations r WHERE r.finding_id = f.id)::integer,
         count(a.id)::integer,
         count(a.id) FILTER (WHERE a.status::text = 'awaiting_review')::integer,
         count(a.id) FILTER (WHERE EXISTS (SELECT 1 FROM evidence_submissions es WHERE es.action_id = a.id))::integer,
         count(a.id) FILTER (WHERE a.status::text = 'verified_complete')::integer,
         count(a.id) FILTER (WHERE a.status::text = 'verified_complete' AND app_verified_basis(a.id) = 'client_evidence')::integer,
         count(a.id) FILTER (WHERE a.status::text = 'verified_complete' AND app_verified_basis(a.id) = 'consultant_recorded')::integer,
         count(a.id) FILTER (WHERE a.status::text = 'closed')::integer,
         count(a.id) FILTER (WHERE a.status::text NOT IN ('verified_complete', 'closed') AND a.due_date < (now() AT TIME ZONE 'Asia/Riyadh')::date)::integer
  FROM assessment_answers x
  JOIN template_questions q ON q.id = x.question_id
  JOIN template_sections s ON s.id = q.section_id
  JOIN findings f ON f.assessment_answer_id = x.id
  LEFT JOIN recommendations r ON r.finding_id = f.id
  LEFT JOIN actions a ON a.recommendation_id = r.id AND a.status::text <> 'draft'
  WHERE x.assessment_id = aid
  GROUP BY x.id, q.ref, f.id, f.title, s.position, q.position
  ORDER BY s.position, q.position
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_assessment_followup(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_assessment_followup(uuid) TO selah_app;
--> statement-breakpoint
-- The trace starts at the assessment for findings that came from one.
CREATE OR REPLACE FUNCTION app_trace(pid uuid)
RETURNS TABLE (node_type text, node_id uuid, parent_type text, parent_id uuid, label text, state text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT 'objective', o.id, NULL, NULL::uuid, coalesce(o.title_ar, o.title_en), o.perspective::text
    FROM strategic_objectives o WHERE o.project_id = pid
  UNION ALL
  SELECT 'kpi', k.id, 'objective', o.id, coalesce(k.name_ar, k.name_en), CASE WHEN k.active THEN 'active' ELSE 'inactive' END
    FROM kpis k LEFT JOIN strategic_objectives o ON o.id = k.objective_id WHERE k.project_id = pid
  UNION ALL
  SELECT 'assessment', a.id, NULL, NULL, a.title, a.status::text FROM assessments a WHERE a.project_id = pid
  UNION ALL
  SELECT 'finding', f.id, CASE WHEN a.id IS NOT NULL THEN 'assessment' END, a.id, f.title, x.basis::text
    FROM findings f LEFT JOIN assessment_answers x ON x.id = f.assessment_answer_id LEFT JOIN assessments a ON a.id = x.assessment_id
    WHERE f.project_id = pid
  UNION ALL
  SELECT 'recommendation', r.id, CASE WHEN f.id IS NOT NULL THEN 'finding' END, f.id, r.title, r.priority::text
    FROM recommendations r LEFT JOIN findings f ON f.id = r.finding_id WHERE r.project_id = pid
  UNION ALL
  SELECT 'recommendation', r.id, 'kpi', k.id, r.title, r.priority::text
    FROM recommendation_kpis rk JOIN recommendations r ON r.id = rk.recommendation_id JOIN kpis k ON k.id = rk.kpi_id
    WHERE rk.project_id = pid
  UNION ALL
  SELECT 'action', a.id, CASE WHEN r.id IS NOT NULL THEN 'recommendation' END, r.id, a.title, a.status::text
    FROM actions a LEFT JOIN recommendations r ON r.id = a.recommendation_id WHERE a.project_id = pid
  UNION ALL
  SELECT 'action', n.id, 'action', old.id, n.title, n.status::text
    FROM actions old JOIN actions n ON n.id = old.superseded_by WHERE old.project_id = pid
  UNION ALL
  SELECT 'evidence', es.id, 'action', a.id, d.title, es.source::text
    FROM evidence_submissions es JOIN actions a ON a.id = es.action_id LEFT JOIN documents d ON d.id = es.document_id
    WHERE es.project_id = pid
  UNION ALL
  SELECT 'review', rv.id, 'action', a.id, NULL, rv.outcome::text
    FROM reviews rv JOIN actions a ON a.id = rv.action_id WHERE rv.project_id = pid
$$;
--> statement-breakpoint
-- Minimal records: answers' written text goes with the rest after handover.
CREATE OR REPLACE FUNCTION app_purge_minimal_records(today date) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  pid uuid;
  n integer := 0;
  gone constant text := '—';
BEGIN
  PERFORM set_config('selah.purge', 'on', true);
  FOR pid IN
    SELECT p.id FROM projects p
      JOIN organizations o ON o.id = p.org_id AND o.minimal_records
      LEFT JOIN firm_settings fs ON fs.org_id = p.firm_org_id
    WHERE p.handover_on IS NOT NULL AND p.minimal_purged_at IS NULL
      AND p.handover_on + coalesce(fs.minimal_purge_days, 90) <= today
  LOOP
    UPDATE progress_updates SET body = gone WHERE project_id = pid AND body <> gone;
    UPDATE action_notes SET body = gone WHERE project_id = pid AND body <> gone;
    UPDATE meeting_notes SET body = gone WHERE project_id = pid AND body <> gone;
    UPDATE meeting_decisions SET text = gone WHERE project_id = pid AND text <> gone;
    UPDATE meeting_summaries SET main_points_md = gone WHERE project_id = pid AND main_points_md <> gone;
    UPDATE meetings SET agenda_md = gone WHERE project_id = pid AND agenda_md <> gone;
    UPDATE findings SET description = gone WHERE project_id = pid AND description <> gone;
    UPDATE recommendations SET rationale = gone WHERE project_id = pid AND rationale <> gone;
    UPDATE recommendations SET target_outcome = gone WHERE project_id = pid AND target_outcome <> gone;
    UPDATE recommendations SET required_evidence = gone WHERE project_id = pid AND required_evidence <> gone;
    UPDATE actions SET description = gone WHERE project_id = pid AND description <> gone;
    UPDATE actions SET closure_note = gone WHERE project_id = pid AND closure_note <> gone;
    UPDATE actions SET blocked_reason = gone WHERE project_id = pid AND blocked_reason <> gone;
    UPDATE assessment_answers SET text_answer = gone WHERE project_id = pid AND text_answer <> gone;
    UPDATE assessment_answers SET comment = gone WHERE project_id = pid AND comment <> gone;
    UPDATE assessment_notes SET body = gone WHERE project_id = pid AND body <> gone;
    UPDATE projects SET minimal_purged_at = now() WHERE id = pid;
    n := n + 1;
  END LOOP;
  PERFORM set_config('selah.purge', 'off', true);
  RETURN n;
END $$;
