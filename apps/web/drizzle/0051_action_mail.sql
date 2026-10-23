-- Mail for action events (bug register 17, approved 2026-10-22). An action
-- owner who doesn't open Selah still hears they have work: when an action is
-- released or handed to them, sent back for revision, verified, or given a
-- new item of evidence to send.
--
-- The mail follows the in-app notification, so every path that tells the
-- owner in the app (src/services/actions.ts, plan.ts, follow-through.ts) also
-- mails them, and nothing else can. The app role may insert notifications for
-- anyone it can see, so the trigger mails only when the notification matches
-- the action as it stands (the person is its owner, and it really is in that
-- state), only to someone still active, and at most once an hour per person,
-- action and event (mailed_at marks the notification that sent one, so an
-- early notice that mailed nothing never holds back the real one). Like
-- every Selah mail it carries a line and a link, never the action's title
-- or content.

ALTER TABLE "notifications" ADD COLUMN "mailed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE outbound_emails DROP CONSTRAINT outbound_kind;
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_kind CHECK (kind IN (
  'invitation', 'email_change.confirm', 'email_change.notice', 'access_review.due',
  'meeting.invite', 'meeting.cancel', 'password_reset', 'password_reset.notice', 'two_factor.reset',
  'inquiry.new', 'action.assigned', 'action.revision_requested', 'action.verified_complete', 'evidence.requested'));
--> statement-breakpoint

CREATE FUNCTION mail_action_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; addr text; matches boolean;
BEGIN
  NEW.mailed_at := NULL;
  IF NEW.entity_type <> 'action'
     OR NEW.kind NOT IN ('action.assigned', 'action.revision_requested', 'action.verified_complete', 'evidence.requested') THEN
    RETURN NEW;
  END IF;
  SELECT x.owner_user_id, x.status INTO a FROM actions x WHERE x.id = NEW.entity_id;
  IF NOT FOUND OR a.owner_user_id IS DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;
  matches := CASE NEW.kind
    -- Released to them, or handed to them while it's under way.
    WHEN 'action.assigned' THEN a.status NOT IN ('draft', 'verified_complete', 'closed')
    WHEN 'action.revision_requested' THEN a.status = 'revision_requested'
    WHEN 'action.verified_complete' THEN a.status = 'verified_complete'
    ELSE a.status NOT IN ('draft', 'verified_complete', 'closed')
      AND EXISTS (SELECT 1 FROM evidence_requests r WHERE r.action_id = NEW.entity_id AND r.status = 'open')
  END;
  IF NOT matches THEN
    RETURN NEW;
  END IF;
  IF NOT app_can_reset_password(NEW.user_id) THEN
    RETURN NEW; -- switched off or erased: no mail
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
REVOKE ALL ON FUNCTION mail_action_notification() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER mail_action_notification BEFORE INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION mail_action_notification();
