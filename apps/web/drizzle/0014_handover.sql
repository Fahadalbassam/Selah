CREATE TYPE "public"."ai_draft_outcome" AS ENUM('accepted_unchanged', 'edited', 'discarded');--> statement-breakpoint
CREATE TABLE "ai_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"outcome" "ai_draft_outcome" NOT NULL,
	"edit_distance" integer,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_draft_distance" CHECK ("ai_drafts"."edit_distance" IS NULL OR "ai_drafts"."edit_distance" >= 0)
);
--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "stale_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "checkin_days" integer[] DEFAULT '{30,60,90}'::integer[] NOT NULL;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "checkin_day" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "handover_on" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "client_sponsor_user_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_drafts" ADD CONSTRAINT "ai_drafts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_drafts" ADD CONSTRAINT "ai_drafts_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_sponsor_user_id_user_id_fk" FOREIGN KEY ("client_sponsor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "follow_ups_checkin_once" ON "follow_ups" USING btree ("project_id","checkin_day");