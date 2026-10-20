CREATE TYPE "public"."closure_outcome" AS ENUM('partially_implemented', 'risk_accepted', 'not_applicable', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."evidence_request_status" AS ENUM('open', 'submitted', 'accepted', 'rejected', 'waived');--> statement-breakpoint
CREATE TYPE "public"."follow_up_kind" AS ENUM('due_soon', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."recommendation_source" AS ENUM('consultant', 'board_decision', 'compliance');--> statement-breakpoint
ALTER TYPE "public"."action_status" ADD VALUE 'closed';--> statement-breakpoint
CREATE TABLE "action_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_date" date,
	"status" "evidence_request_status" DEFAULT 'open' NOT NULL,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_up_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_id" uuid NOT NULL,
	"kind" "follow_up_kind" NOT NULL,
	"level" integer NOT NULL,
	"due_date" date NOT NULL,
	"recipients" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"accepted_by" uuid NOT NULL,
	"statement" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "awaiting_review_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "closure_outcome" "closure_outcome";--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "closure_note" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "closed_by" uuid;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "evidence_submissions" ADD COLUMN "evidence_request_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "remind_days_before" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "escalate_level2_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "escalate_level3_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "source" "recommendation_source" DEFAULT 'consultant' NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "meeting_note_id" uuid;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "decided_on" date;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "period_start" date;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "period_end" date;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "metrics" jsonb;--> statement-breakpoint
ALTER TABLE "action_notes" ADD CONSTRAINT "action_notes_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_notes" ADD CONSTRAINT "action_notes_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_notes" ADD CONSTRAINT "action_notes_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_requests" ADD CONSTRAINT "evidence_requests_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_requests" ADD CONSTRAINT "evidence_requests_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_requests" ADD CONSTRAINT "evidence_requests_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_requests" ADD CONSTRAINT "evidence_requests_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_log" ADD CONSTRAINT "follow_up_log_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_acceptances" ADD CONSTRAINT "risk_acceptances_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_acceptances" ADD CONSTRAINT "risk_acceptances_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_acceptances" ADD CONSTRAINT "risk_acceptances_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_notes_action_idx" ON "action_notes" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "evidence_requests_action_idx" ON "evidence_requests" USING btree ("action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_log_once" ON "follow_up_log" USING btree ("action_id","kind","level","due_date");--> statement-breakpoint
CREATE INDEX "risk_acceptances_action_idx" ON "risk_acceptances" USING btree ("action_id");--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_superseded_by_actions_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_submissions" ADD CONSTRAINT "evidence_submissions_evidence_request_id_evidence_requests_id_fk" FOREIGN KEY ("evidence_request_id") REFERENCES "public"."evidence_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_meeting_note_id_meeting_notes_id_fk" FOREIGN KEY ("meeting_note_id") REFERENCES "public"."meeting_notes"("id") ON DELETE set null ON UPDATE no action;