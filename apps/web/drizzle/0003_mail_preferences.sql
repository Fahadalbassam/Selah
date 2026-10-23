CREATE TABLE "mail_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"follow_up_digest" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_preferences" ADD CONSTRAINT "mail_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Each person reads and changes only their own preferences. The reminder job
-- reads them as the schema owner.
ALTER TABLE mail_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY own ON mail_preferences TO selah_app USING (user_id = app_uid()) WITH CHECK (user_id = app_uid());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON mail_preferences TO selah_app;
--> statement-breakpoint
-- The daily summary of reminders (src/jobs/follow-ups.ts): a line and a link
-- to the notifications page, like every other mail.
ALTER TABLE outbound_emails DROP CONSTRAINT outbound_kind;
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_kind CHECK (kind IN (
  'invitation', 'email_change.confirm', 'email_change.notice', 'access_review.due',
  'meeting.invite', 'meeting.cancel', 'password_reset', 'password_reset.notice', 'two_factor.reset',
  'inquiry.new', 'action.assigned', 'action.revision_requested', 'action.verified_complete', 'evidence.requested',
  'follow_up.digest'));
