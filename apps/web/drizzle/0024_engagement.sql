CREATE TYPE "public"."engagement_mode" AS ENUM('full', 'restricted', 'consultant_managed');--> statement-breakpoint
CREATE TYPE "public"."received_via" AS ENUM('meeting', 'email', 'phone', 'document');--> statement-breakpoint
CREATE TYPE "public"."record_source" AS ENUM('client_portal', 'consultant_recorded', 'internal');--> statement-breakpoint
CREATE TABLE "department_members" (
	"department_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_head" boolean DEFAULT false NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_members_department_id_user_id_pk" PRIMARY KEY("department_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_id_org_uq" UNIQUE("id","org_id")
);
--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "owner_name" text;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_chunks" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence_submissions" ADD COLUMN "source" "record_source" DEFAULT 'client_portal' NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_submissions" ADD COLUMN "received_via" "received_via";--> statement-breakpoint
ALTER TABLE "evidence_submissions" ADD COLUMN "received_on" date;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "restricted_max_admins" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "engagement_mode" "engagement_mode";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "departments_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "progress_updates" ADD COLUMN "source" "record_source" DEFAULT 'client_portal' NOT NULL;--> statement-breakpoint
ALTER TABLE "progress_updates" ADD COLUMN "received_via" "received_via";--> statement-breakpoint
ALTER TABLE "progress_updates" ADD COLUMN "received_on" date;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "department_members_user_idx" ON "department_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_name_uq" ON "departments" USING btree ("org_id","name_ar");--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_department_fk" FOREIGN KEY ("department_id","org_id") REFERENCES "public"."departments"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_department_fk" FOREIGN KEY ("department_id","org_id") REFERENCES "public"."departments"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_one_owner" CHECK ("actions"."owner_user_id" IS NULL OR "actions"."owner_name" IS NULL);--> statement-breakpoint
ALTER TABLE "evidence_submissions" ADD CONSTRAINT "evidence_submissions_received" CHECK (("evidence_submissions"."source" = 'consultant_recorded') = ("evidence_submissions"."received_via" IS NOT NULL AND "evidence_submissions"."received_on" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "evidence_submissions" ADD CONSTRAINT "evidence_submissions_received_only" CHECK ("evidence_submissions"."source" = 'consultant_recorded' OR ("evidence_submissions"."received_via" IS NULL AND "evidence_submissions"."received_on" IS NULL));--> statement-breakpoint
ALTER TABLE "progress_updates" ADD CONSTRAINT "progress_updates_received" CHECK (("progress_updates"."source" = 'consultant_recorded') = ("progress_updates"."received_via" IS NOT NULL AND "progress_updates"."received_on" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "progress_updates" ADD CONSTRAINT "progress_updates_received_only" CHECK ("progress_updates"."source" = 'consultant_recorded' OR ("progress_updates"."received_via" IS NULL AND "progress_updates"."received_on" IS NULL));