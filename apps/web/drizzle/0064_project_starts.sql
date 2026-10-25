-- ------------------------------------------------ a project starts when its work does
-- A client project becomes planned when a signed engagement covers it
-- (0008), but nothing ever moved it on to active: only an internal project
-- was created active, and only a cancelled closing set it back. So the
-- reminders, the escalation ladder, the health history and the status packs,
-- which all run for active projects, never ran for a client project made on
-- the screens. Found while building the team walkthrough (2026-10-25).
--
-- A planned project starts the moment it has a released action (one that
-- left draft): from then on someone owns work with a date. Drafts alone don't
-- start it, and a pitch (still a draft project) is never touched. Two ways in:
-- an action is released on a planned project, or a draft project that
-- already has released actions becomes planned when an engagement covers it.
CREATE FUNCTION project_starts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE projects SET state = 'active' WHERE id = NEW.project_id AND state::text = 'planned';
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION project_starts() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER action_released_starts_project AFTER INSERT ON actions
  FOR EACH ROW WHEN (NEW.status::text <> 'draft') EXECUTE FUNCTION project_starts();
--> statement-breakpoint
CREATE TRIGGER action_release_starts_project AFTER UPDATE OF status ON actions
  FOR EACH ROW WHEN (OLD.status::text = 'draft' AND NEW.status::text <> 'draft') EXECUTE FUNCTION project_starts();
--> statement-breakpoint
CREATE FUNCTION covered_project_starts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM actions WHERE project_id = NEW.id AND status::text <> 'draft') THEN
    UPDATE projects SET state = 'active' WHERE id = NEW.id AND state::text = 'planned';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION covered_project_starts() FROM PUBLIC;
--> statement-breakpoint
-- After, not before: covering a project moves it out of draft inside
-- check_project_engagement(), without naming the state column.
CREATE TRIGGER covered_project_starts AFTER UPDATE ON projects
  FOR EACH ROW WHEN (OLD.state::text = 'draft' AND NEW.state::text = 'planned') EXECUTE FUNCTION covered_project_starts();
--> statement-breakpoint
-- Projects already running work.
UPDATE projects p SET state = 'active'
WHERE p.state::text = 'planned' AND EXISTS (SELECT 1 FROM actions a WHERE a.project_id = p.id AND a.status::text <> 'draft');
