CREATE TABLE "action_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"mentions" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_comments" ADD CONSTRAINT "action_comments_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_comments" ADD CONSTRAINT "action_comments_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_comments" ADD CONSTRAINT "action_comments_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_comments_action_idx" ON "action_comments" USING btree ("action_id","created_at");-- ------------------------------------------------ the thread on an action (F11)
-- Whoever can see an action reads and writes its thread. Mentions name people
-- who can see it too, and the people in the thread hear about new comments.
-- Append-only: the author may remove their own comment, which blanks the text
-- and keeps the row.

-- A fix found here: an action with no owner yet made the department check
-- null, which counted as passing, so someone outside the department could
-- read its updates, evidence and requests. No owner now means the
-- department decides.
CREATE OR REPLACE FUNCTION app_action_dept_ok(act uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT app_dept_ok(a.department_id, a.org_id) OR coalesce(a.owner_user_id = app_uid(), false)
    FROM actions a WHERE a.id = act
  ), true)
$$;
--> statement-breakpoint
-- Whether someone (not the caller) can see an action: the same checks as the
-- action's row-level security (project, recommendation label, department) and
-- the app's action-owner rule, worked out for that person.
CREATE FUNCTION app_user_sees_action(target uuid, act uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT CASE
      WHEN o.kind = 'firm' THEN
        o.id = p.firm_org_id
        AND coalesce(r.visibility::text, 'shared') IN ('shared', 'firm_private')
        AND (m.role = 'firm_admin'
          OR (m.role = 'consultant' AND (
            EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = target)
            OR (p.kind = 'client' AND EXISTS (
              SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = p.org_id AND ca.user_id = target AND ca.is_lead)))))
      ELSE
        o.id = p.org_id AND p.kind = 'client' AND p.state::text <> 'draft'
        AND coalesce(r.visibility::text, 'shared') IN ('shared', 'client_private')
        AND (m.role = 'client_admin'
          OR (m.role = 'client_manager' AND EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = target))
          OR (m.role = 'action_owner' AND a.owner_user_id = target))
        AND (a.department_id IS NULL OR m.role = 'client_admin' OR a.owner_user_id = target
          OR NOT o.departments_enabled
          OR EXISTS (SELECT 1 FROM department_members dm WHERE dm.department_id = a.department_id AND dm.user_id = target))
    END
    FROM actions a
    JOIN projects p ON p.id = a.project_id
    LEFT JOIN recommendations r ON r.id = a.recommendation_id
    JOIN org_memberships m ON m.user_id = target AND m.active AND m.org_id IN (p.firm_org_id, p.org_id)
    JOIN organizations o ON o.id = m.org_id
    WHERE a.id = act
    LIMIT 1
  ), false)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_user_sees_action(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
-- Who the caller can mention on an action they can see: everyone else who can see it.
CREATE FUNCTION app_action_people(act uuid) RETURNS TABLE (user_id uuid, name text, side text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.name, o.kind::text
  FROM actions a
  JOIN projects p ON p.id = a.project_id
  JOIN org_memberships m ON m.org_id IN (p.firm_org_id, p.org_id) AND m.active
  JOIN organizations o ON o.id = m.org_id
  JOIN "user" u ON u.id = m.user_id
  WHERE a.id = act AND app_can_see_action(act) AND u.id <> app_uid() AND app_user_sees_action(u.id, act)
  ORDER BY o.kind, u.name
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_action_people(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_action_people(uuid) TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON action_comments TO selah_app;
--> statement-breakpoint
ALTER TABLE action_comments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The thread is as visible as its action (the same three checks).
CREATE POLICY scoped_read ON action_comments FOR SELECT TO selah_app
  USING (app_can_see_project(project_id) AND app_can_see_action(action_id));
--> statement-breakpoint
CREATE POLICY author_insert ON action_comments FOR INSERT TO selah_app
  WITH CHECK (author_id = app_uid() AND app_can_see_project(project_id) AND app_can_see_action(action_id)
    AND EXISTS (SELECT 1 FROM actions a WHERE a.id = action_id AND a.project_id = action_comments.project_id));
--> statement-breakpoint
-- Removing is the only change, and only by the author (check_action_comment_change).
CREATE POLICY author_remove ON action_comments FOR UPDATE TO selah_app
  USING (author_id = app_uid() AND app_can_see_action(action_id))
  WITH CHECK (author_id = app_uid());
--> statement-breakpoint
-- A new comment: written now by the caller, with text, mentioning only
-- other people who can see the action.
CREATE FUNCTION check_action_comment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('selah.purge', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.created_at := now();
  NEW.removed_at := NULL;
  NEW.body := btrim(NEW.body);
  IF NEW.body = '' OR length(NEW.body) > 8000 THEN
    RAISE EXCEPTION 'a comment needs text, up to 8000 characters' USING ERRCODE = 'check_violation';
  END IF;
  NEW.mentions := ARRAY(SELECT DISTINCT x FROM unnest(NEW.mentions) x);
  IF cardinality(NEW.mentions) > 20 THEN
    RAISE EXCEPTION 'a comment mentions at most 20 people' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.mentions) x WHERE x = NEW.author_id OR NOT app_user_sees_action(x, NEW.action_id)) THEN
    RAISE EXCEPTION 'a comment mentions only other people who can see the action' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_action_comment() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER action_comment BEFORE INSERT ON action_comments FOR EACH ROW EXECUTE FUNCTION check_action_comment();
--> statement-breakpoint
-- The only change: the author removes it, once. The text goes; the row stays.
CREATE FUNCTION check_action_comment_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('selah.purge', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'comments are kept; remove one instead' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'this comment was already removed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.removed_at IS NULL OR app_uid() IS DISTINCT FROM OLD.author_id
     OR (NEW.id, NEW.project_id, NEW.org_id, NEW.action_id, NEW.author_id, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.project_id, OLD.org_id, OLD.action_id, OLD.author_id, OLD.created_at) THEN
    RAISE EXCEPTION 'only its author removes a comment, and nothing else changes' USING ERRCODE = 'check_violation';
  END IF;
  NEW.removed_at := now();
  NEW.body := '';
  NEW.mentions := '{}';
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_action_comment_change() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER action_comment_change BEFORE UPDATE OR DELETE ON action_comments FOR EACH ROW EXECUTE FUNCTION check_action_comment_change();
--> statement-breakpoint
-- Who hears about a new comment, only when the caller just wrote it: the
-- people it mentions (action.mentioned), and (action.commented) the action's
-- owner, everyone who wrote in the thread before, and, when the client
-- writes, the firm's team on the project. Only people who can see the action.
CREATE FUNCTION app_notify_action_comment(cid uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c action_comments%ROWTYPE; owner_id uuid; pid uuid; n integer;
BEGIN
  SELECT * INTO c FROM action_comments WHERE id = cid;
  IF NOT FOUND OR c.author_id IS DISTINCT FROM app_uid() OR c.removed_at IS NOT NULL OR c.created_at < now() - interval '1 minute'
     OR NOT app_can_see_action(c.action_id) THEN
    RAISE EXCEPTION 'notification does not match the comment' USING ERRCODE = 'check_violation';
  END IF;
  SELECT a.owner_user_id, a.project_id INTO owner_id, pid FROM actions a WHERE a.id = c.action_id;
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT u, CASE WHEN u = ANY (c.mentions) THEN 'action.mentioned' ELSE 'action.commented' END, 'action', c.action_id
    FROM (
      SELECT unnest(c.mentions) AS u
      UNION SELECT owner_id WHERE owner_id IS NOT NULL
      UNION SELECT x.author_id FROM action_comments x WHERE x.action_id = c.action_id AND x.id <> c.id AND x.removed_at IS NULL
      UNION SELECT t FROM app_project_audience(pid) t WHERE app_org_kind() = 'client'
    ) who
    WHERE u <> app_uid() AND app_user_sees_action(u, c.action_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_notify_action_comment(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_notify_action_comment(uuid) TO selah_app;
--> statement-breakpoint
-- Mail about the thread (lib/mail-templates.ts MAIL_KINDS).
ALTER TABLE outbound_emails DROP CONSTRAINT outbound_kind;
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_kind CHECK (kind IN (
  'invitation', 'email_change.confirm', 'email_change.notice', 'access_review.due',
  'meeting.invite', 'meeting.cancel', 'password_reset', 'password_reset.notice', 'two_factor.reset',
  'inquiry.new', 'inquiry.received', 'inquiry.declined', 'action.assigned', 'action.revision_requested',
  'action.verified_complete', 'evidence.requested', 'action.commented', 'action.mentioned', 'follow_up.digest', 'client.archived'));
--> statement-breakpoint
-- Comments are update mail: at once or in the summary, as each person chose
-- (lib/mail-choices.ts UPDATE_MAIL_KINDS).
CREATE OR REPLACE FUNCTION app_update_mail_kinds() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT ARRAY['action.assigned', 'action.revision_requested', 'action.verified_complete', 'evidence.requested',
    'action.commented', 'action.mentioned']
$$;
--> statement-breakpoint
-- Mail about an action goes to its owner, except mail about the thread,
-- which goes to whoever the comment reached (they can see the action).
CREATE OR REPLACE FUNCTION mail_action_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; addr text; matches boolean; thread boolean;
BEGIN
  NEW.mailed_at := NULL;
  IF NEW.entity_type <> 'action' OR NEW.kind <> ALL (app_update_mail_kinds()) THEN
    RETURN NEW;
  END IF;
  thread := NEW.kind IN ('action.commented', 'action.mentioned');
  SELECT x.owner_user_id, x.status INTO a FROM actions x WHERE x.id = NEW.entity_id;
  IF NOT FOUND OR (NOT thread AND a.owner_user_id IS DISTINCT FROM NEW.user_id) THEN
    RETURN NEW;
  END IF;
  matches := CASE NEW.kind
    -- Released to them, or handed to them while it's under way.
    WHEN 'action.assigned' THEN app_action_open(a.status)
    WHEN 'action.revision_requested' THEN a.status = 'revision_requested'
    WHEN 'action.verified_complete' THEN a.status = 'verified_complete'
    WHEN 'action.commented' THEN true
    WHEN 'action.mentioned' THEN true
    ELSE app_action_open(a.status)
      AND EXISTS (SELECT 1 FROM evidence_requests r WHERE r.action_id = NEW.entity_id AND r.status = 'open')
  END;
  IF NOT matches THEN
    RETURN NEW;
  END IF;
  IF NOT app_can_reset_password(NEW.user_id) THEN
    RETURN NEW; -- switched off or erased: no mail
  END IF;
  IF (SELECT c.updates FROM app_mail_choice(NEW.user_id) c) <> 'instant'
     OR EXISTS (SELECT 1 FROM mail_mutes m WHERE m.user_id = NEW.user_id AND m.action_id = NEW.entity_id) THEN
    RETURN NEW; -- batched into their summary, switched off, or muted
  END IF;
  IF EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.user_id = NEW.user_id AND n.kind = NEW.kind AND n.entity_id = NEW.entity_id
      AND n.mailed_at > now() - interval '1 hour'
  ) THEN
    RETURN NEW;
  END IF;
  SELECT u.email INTO addr FROM "user" u WHERE u.id = NEW.user_id;
  IF addr IS NOT NULL THEN
    INSERT INTO outbound_emails (to_email, kind, link) VALUES (addr, NEW.kind, '/actions/' || NEW.entity_id);
    NEW.mailed_at := now();
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- A closed project's thread is closed too (lib/closure.ts FROZEN_TABLES).
CREATE TRIGGER project_open BEFORE INSERT OR UPDATE OR DELETE ON action_comments FOR EACH ROW EXECUTE FUNCTION check_project_open();
--> statement-breakpoint
-- A read-only observer (N6) reads the thread; their notes stay firm-only (action_notes).
CREATE TRIGGER project_observer BEFORE INSERT OR UPDATE OR DELETE ON action_comments FOR EACH ROW EXECUTE FUNCTION check_not_observer();
--> statement-breakpoint
-- A minimal-records client's threads are blanked with the rest of the text after handover.
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
    UPDATE action_comments SET body = gone WHERE project_id = pid AND removed_at IS NULL AND body <> gone;
    UPDATE meeting_notes SET body = gone WHERE project_id = pid AND body <> gone;
    UPDATE meeting_decisions SET text = gone WHERE project_id = pid AND text <> gone;
    UPDATE meeting_summaries SET main_points_md = gone WHERE project_id = pid AND main_points_md <> gone;
    UPDATE meetings SET agenda_md = gone WHERE project_id = pid AND agenda_md <> gone;
    UPDATE findings SET description = gone WHERE project_id = pid AND description <> gone;
    UPDATE recommendations SET rationale = gone WHERE project_id = pid AND rationale <> gone;
    UPDATE recommendations SET target_outcome = gone WHERE project_id = pid AND target_outcome <> gone;
    UPDATE recommendations SET required_evidence = gone WHERE project_id = pid AND required_evidence <> gone;
    UPDATE recommendation_responses SET reason = gone WHERE project_id = pid AND reason <> gone;
    UPDATE recommendation_responses SET planned_action = gone WHERE project_id = pid AND planned_action <> gone;
    UPDATE recommendation_responses SET firm_reply = gone WHERE project_id = pid AND firm_reply <> gone;
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

