-- ------------------------------------------------ a project starts when its work does
-- A client project becomes planned when a signed engagement covers it
-- (0008), but nothing ever moved it on to active: only an internal project
-- was created active, and only a cancelled closing set it back. So the
-- reminders, the escalation ladder, the health history and the status packs,
-- which all run for active projects, never ran for a client project made on
-- the screens. Found while building the team walkthrough (2026-10-25).
--
-- A planned project starts the moment its first action is released (leaves
-- draft): from then on someone owns work with a date. Drafts alone don't
-- start it, and a pitch (still a draft project) is never touched.
CREATE FUNCTION project_starts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE projects SET state = 'active' WHERE id = NEW.project_id AND state::text = 'planned';
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION project_starts() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER action_starts_project AFTER INSERT OR UPDATE OF status ON actions
  FOR EACH ROW WHEN (NEW.status::text <> 'draft') EXECUTE FUNCTION project_starts();
--> statement-breakpoint
-- Projects already running work.
UPDATE projects p SET state = 'active'
WHERE p.state::text = 'planned' AND EXISTS (SELECT 1 FROM actions a WHERE a.project_id = p.id AND a.status::text <> 'draft');
