ALTER TABLE "meetings" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "accountable_user_id" uuid;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_department_fk" FOREIGN KEY ("department_id","org_id") REFERENCES "public"."departments"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_accountable_user_id_user_id_fk" FOREIGN KEY ("accountable_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_department_fk" FOREIGN KEY ("department_id","org_id") REFERENCES "public"."departments"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Departments across the work (F31 of the full picture, option B). A
-- recommendation may be for one department or for none (company-wide or
-- cross-department, with one accountable person at the client); its actions
-- follow its department. A meeting may be a department's, and its agenda then
-- covers that department's work.
--
-- 1. Only an active department of the row's own client (the composite
--    foreign key keeps the org).
CREATE TRIGGER row_department BEFORE INSERT OR UPDATE OF department_id ON recommendations
  FOR EACH ROW EXECUTE FUNCTION check_row_department();
--> statement-breakpoint
CREATE TRIGGER row_department BEFORE INSERT OR UPDATE OF department_id ON meetings
  FOR EACH ROW EXECUTE FUNCTION check_row_department();
--> statement-breakpoint
-- 2. The accountable person is someone at the client who can see the
--    project: an active client admin, or a client person staffed on it.
CREATE FUNCTION check_recommendation_accountable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.accountable_user_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.accountable_user_id IS DISTINCT FROM OLD.accountable_user_id) AND NOT EXISTS (
    SELECT 1 FROM org_memberships m JOIN projects p ON p.id = NEW.project_id
    WHERE m.user_id = NEW.accountable_user_id AND m.org_id = NEW.org_id AND m.active AND p.kind = 'client'
      AND (m.role = 'client_admin' OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = NEW.project_id AND pm.user_id = NEW.accountable_user_id))
  ) THEN
    RAISE EXCEPTION 'the accountable person is someone at the client on this project' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_recommendation_accountable() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER recommendation_accountable BEFORE INSERT OR UPDATE OF accountable_user_id ON recommendations
  FOR EACH ROW EXECUTE FUNCTION check_recommendation_accountable();
--> statement-breakpoint
-- 3. An action under a department's recommendation is that department's: it
--    takes the department when none is given, and cannot be filed under
--    another. Refiling the recommendation refiles its actions.
CREATE FUNCTION check_action_department() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE dept uuid := (SELECT r.department_id FROM recommendations r WHERE r.id = NEW.recommendation_id);
BEGIN
  IF dept IS NOT NULL THEN
    IF NEW.department_id IS NULL THEN
      NEW.department_id := dept;
    ELSIF NEW.department_id <> dept THEN
      RAISE EXCEPTION 'an action follows its recommendation''s department' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_action_department() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER action_department BEFORE INSERT OR UPDATE OF department_id, recommendation_id ON actions
  FOR EACH ROW EXECUTE FUNCTION check_action_department();
--> statement-breakpoint
CREATE FUNCTION recommendation_refiled() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.department_id IS NOT NULL AND NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    UPDATE actions SET department_id = NEW.department_id WHERE recommendation_id = NEW.id AND department_id IS DISTINCT FROM NEW.department_id;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION recommendation_refiled() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER recommendation_refiled AFTER UPDATE OF department_id ON recommendations
  FOR EACH ROW EXECUTE FUNCTION recommendation_refiled();
--> statement-breakpoint
-- 4. Like actions, a department's recommendation is read at the client by
--    that department's people and the client's admins, by its accountable
--    person, and by whoever owns one of its actions (who must read what they
--    implement).
CREATE FUNCTION app_owns_action_under(rec uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM actions a WHERE a.recommendation_id = rec AND a.owner_user_id = app_uid())
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_owns_action_under(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_owns_action_under(uuid) TO selah_app;
--> statement-breakpoint
CREATE POLICY department ON recommendations AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_dept_ok(department_id, org_id) OR accountable_user_id = app_uid() OR app_owns_action_under(id))
  WITH CHECK (app_dept_ok(department_id, org_id));
--> statement-breakpoint
-- 5. A department's meeting: its agenda lists only that department's work.
--    One agenda function; the three-argument form is the whole project.
CREATE FUNCTION app_meeting_agenda(pid uuid, before timestamptz, lang text, dept uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  today date := app_firm_today();
  last_held timestamptz := (SELECT max(m.starts_at) FROM meetings m WHERE m.project_id = pid AND m.status = 'held' AND m.starts_at < before);
  out text := '';
  part text;
  en boolean := lang = 'en';
BEGIN
  SELECT string_agg('- ' || a.title || CASE WHEN en THEN ' (due ' ELSE ' (الاستحقاق ' END || a.due_date || ')', E'\n' ORDER BY a.due_date) INTO part FROM (
    SELECT a.title, a.due_date FROM actions a JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
    WHERE a.project_id = pid AND a.due_date < today AND app_action_open(a.status) AND (dept IS NULL OR a.department_id = dept)
    ORDER BY a.due_date LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Overdue\n' ELSE E'## متأخرة\n' END || part || E'\n\n'; END IF;
  SELECT string_agg('- ' || a.title, E'\n' ORDER BY a.title) INTO part FROM (
    SELECT a.title FROM actions a JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
    WHERE a.project_id = pid AND a.status = 'awaiting_review' AND (dept IS NULL OR a.department_id = dept) ORDER BY a.title LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Awaiting review\n' ELSE E'## بانتظار المراجعة\n' END || part || E'\n\n'; END IF;
  SELECT string_agg('- ' || a.title || coalesce(': ' || a.blocked_reason, ''), E'\n' ORDER BY a.title) INTO part FROM (
    SELECT a.title, a.blocked_reason FROM actions a JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
    WHERE a.project_id = pid AND a.status = 'blocked' AND (dept IS NULL OR a.department_id = dept) ORDER BY a.title LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Blocked\n' ELSE E'## متوقفة\n' END || part || E'\n\n'; END IF;
  IF last_held IS NOT NULL THEN
    SELECT string_agg('- ' || c.title || ' (' || c.status || ')', E'\n' ORDER BY c.title) INTO part FROM (
      SELECT c.* FROM app_changed_actions(pid, last_held) c
        JOIN actions a ON a.id = c.action_id JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
      WHERE dept IS NULL OR a.department_id = dept
      ORDER BY c.title LIMIT 20) c;
    IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Changed since the last meeting\n' ELSE E'## ما تغيّر منذ الاجتماع السابق\n' END || part || E'\n\n'; END IF;
  END IF;
  RETURN nullif(rtrim(out, E'\n'), '');
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_meeting_agenda(uuid, timestamptz, text, uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_meeting_agenda(pid uuid, before timestamptz, lang text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_meeting_agenda(pid, before, lang, NULL::uuid)
$$;
--> statement-breakpoint
-- Runs after meeting_rules (trigger names sort): a department's meeting
-- gets its department's agenda, and keeps its department.
CREATE FUNCTION meeting_department() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.department_id IS NOT NULL THEN
      NEW.agenda_md := app_meeting_agenda(NEW.project_id, NEW.starts_at, NEW.spoken_lang, NEW.department_id);
    END IF;
  ELSIF NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    RAISE EXCEPTION 'a meeting keeps its department; book another one' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION meeting_department() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER meeting_rules_department BEFORE INSERT OR UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION meeting_department();
