CREATE TYPE "public"."attendee_response" AS ENUM('needs_action', 'accepted', 'declined', 'tentative');--> statement-breakpoint
CREATE TYPE "public"."attendee_role" AS ENUM('organizer', 'required', 'optional');--> statement-breakpoint
CREATE TYPE "public"."meeting_kind" AS ENUM('kickoff', 'status', 'steering', 'workshop', 'handover', 'other');--> statement-breakpoint
CREATE TYPE "public"."meeting_location" AS ENUM('online', 'in_person', 'phone');--> statement-breakpoint
CREATE TYPE "public"."meeting_provider" AS ENUM('google_meet', 'teams', 'zoom');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('scheduled', 'held', 'cancelled');--> statement-breakpoint
CREATE TABLE "meeting_attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"user_id" uuid,
	"contact_id" uuid,
	"role" "attendee_role" DEFAULT 'required' NOT NULL,
	"response" "attendee_response" DEFAULT 'needs_action' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendee_one_kind" CHECK (("meeting_attendees"."user_id" IS NULL) <> ("meeting_attendees"."contact_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "meeting_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"text" text NOT NULL,
	"lang" text DEFAULT 'ar' NOT NULL,
	"decided_by" text,
	"supersedes_id" uuid,
	"visibility" "visibility" DEFAULT 'shared' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_summaries" (
	"meeting_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"lang" text NOT NULL,
	"main_points_md" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"drafted_by_ai_at" timestamp with time zone,
	"confirmed_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"visibility" "visibility" DEFAULT 'firm_private' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "meeting_kind" NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"location" "meeting_location" NOT NULL,
	"join_url" text,
	"provider" "meeting_provider",
	"location_text" text,
	"organizer_id" uuid NOT NULL,
	"status" "meeting_status" DEFAULT 'scheduled' NOT NULL,
	"ics_uid" text NOT NULL,
	"ics_sequence" integer DEFAULT 0 NOT NULL,
	"agenda_md" text,
	"spoken_lang" text DEFAULT 'ar' NOT NULL,
	"transcript_consent" boolean DEFAULT false NOT NULL,
	"consent_noted_by" uuid,
	"visibility" "visibility" DEFAULT 'shared' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_ics_uid_unique" UNIQUE("ics_uid")
);
--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "meeting_decision_id" uuid;--> statement-breakpoint
ALTER TABLE "meeting_notes" ADD COLUMN "meeting_id" uuid;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD COLUMN "meeting_id" uuid;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_contact_id_client_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_supersedes_id_meeting_decisions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."meeting_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_summaries" ADD CONSTRAINT "meeting_summaries_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_summaries" ADD CONSTRAINT "meeting_summaries_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_summaries" ADD CONSTRAINT "meeting_summaries_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organizer_id_user_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_consent_noted_by_user_id_fk" FOREIGN KEY ("consent_noted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_attendees_user_uq" ON "meeting_attendees" USING btree ("meeting_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_attendees_contact_uq" ON "meeting_attendees" USING btree ("meeting_id","contact_id");--> statement-breakpoint
CREATE INDEX "meeting_attendees_user_idx" ON "meeting_attendees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "meeting_decisions_meeting_idx" ON "meeting_decisions" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "meetings_project_idx" ON "meetings" USING btree ("project_id","starts_at");--> statement-breakpoint
CREATE INDEX "meetings_start_idx" ON "meetings" USING btree ("starts_at");--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_meeting_decision_id_meeting_decisions_id_fk" FOREIGN KEY ("meeting_decision_id") REFERENCES "public"."meeting_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_notes" ADD CONSTRAINT "meeting_notes_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD CONSTRAINT "outbound_emails_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;