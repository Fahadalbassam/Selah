CREATE TYPE "public"."conflict_status" AS ENUM('not_checked', 'clear', 'flagged', 'waived');--> statement-breakpoint
CREATE TYPE "public"."discovery_mode" AS ENUM('in_person', 'video', 'phone');--> statement-breakpoint
CREATE TYPE "public"."discovery_outcome" AS ENUM('proceed', 'not_a_fit', 'needs_followup');--> statement-breakpoint
CREATE TYPE "public"."employee_band" AS ENUM('1-9', '10-49', '50-249', '250+');--> statement-breakpoint
CREATE TYPE "public"."heard_from" AS ENUM('referral', 'search', 'social_media', 'event', 'existing_client', 'other');--> statement-breakpoint
CREATE TYPE "public"."inquiry_status" AS ENUM('new', 'triaged', 'discovery_scheduled', 'discovery_done', 'proposal_sent', 'won', 'lost', 'declined', 'spam', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."inquiry_urgency" AS ENUM('exploring', 'within_3_months', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."ownership_type" AS ENUM('sole', 'family_single_owner', 'family_multi_partner', 'llc', 'joint_stock', 'non_profit', 'other');--> statement-breakpoint
CREATE TABLE "discovery_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inquiry_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"held_at" timestamp with time zone,
	"mode" "discovery_mode" NOT NULL,
	"attendees" text,
	"notes" text,
	"outcome" "discovery_outcome",
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_org_id" uuid NOT NULL,
	"public_ref" text NOT NULL,
	"org_name" text,
	"org_name_ar" text,
	"cr_number" text,
	"sector_id" uuid NOT NULL,
	"employee_band" "employee_band" NOT NULL,
	"ownership_type" "ownership_type" NOT NULL,
	"contact_name" text,
	"contact_role" text,
	"contact_email" text,
	"contact_phone" text,
	"preferred_language" text NOT NULL,
	"message" text,
	"self_check" jsonb NOT NULL,
	"urgency" "inquiry_urgency",
	"heard_from" "heard_from",
	"privacy_notice_version" text NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"ip_hash" text,
	"user_agent_hash" text,
	"status" "inquiry_status" DEFAULT 'new' NOT NULL,
	"owner_user_id" uuid,
	"conflict_status" "conflict_status" DEFAULT 'not_checked' NOT NULL,
	"conflict_note" text,
	"conflict_checked_by" uuid,
	"conflict_checked_at" timestamp with time zone,
	"client_org_id" uuid,
	"converted_by" uuid,
	"converted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"purge_after" date,
	"anonymised_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inquiries_public_ref_unique" UNIQUE("public_ref"),
	CONSTRAINT "inquiry_language" CHECK ("inquiries"."preferred_language" IN ('ar', 'en')),
	CONSTRAINT "inquiry_contact_kept" CHECK ("inquiries"."anonymised_at" IS NOT NULL OR ("inquiries"."contact_email" IS NOT NULL AND "inquiries"."contact_name" IS NOT NULL AND "inquiries"."org_name" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "inquiry_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inquiry_id" uuid NOT NULL,
	"actor_id" uuid,
	"event" text NOT NULL,
	"from_status" "inquiry_status",
	"to_status" "inquiry_status",
	"note" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inquiry_services" (
	"inquiry_id" uuid NOT NULL,
	"service_area_id" uuid NOT NULL,
	CONSTRAINT "inquiry_services_inquiry_id_service_area_id_pk" PRIMARY KEY("inquiry_id","service_area_id")
);
--> statement-breakpoint
CREATE TABLE "sectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "sectors_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "service_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "service_areas_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "intake_email" text;--> statement-breakpoint
ALTER TABLE "discovery_sessions" ADD CONSTRAINT "discovery_sessions_inquiry_id_inquiries_id_fk" FOREIGN KEY ("inquiry_id") REFERENCES "public"."inquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_sessions" ADD CONSTRAINT "discovery_sessions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_firm_org_id_organizations_id_fk" FOREIGN KEY ("firm_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_conflict_checked_by_user_id_fk" FOREIGN KEY ("conflict_checked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_client_org_id_organizations_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_converted_by_user_id_fk" FOREIGN KEY ("converted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_events" ADD CONSTRAINT "inquiry_events_inquiry_id_inquiries_id_fk" FOREIGN KEY ("inquiry_id") REFERENCES "public"."inquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_events" ADD CONSTRAINT "inquiry_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_services" ADD CONSTRAINT "inquiry_services_inquiry_id_inquiries_id_fk" FOREIGN KEY ("inquiry_id") REFERENCES "public"."inquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_services" ADD CONSTRAINT "inquiry_services_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_sessions_inquiry_idx" ON "discovery_sessions" USING btree ("inquiry_id");--> statement-breakpoint
CREATE INDEX "inquiries_status_idx" ON "inquiries" USING btree ("firm_org_id","status");--> statement-breakpoint
CREATE INDEX "inquiries_ip_idx" ON "inquiries" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "inquiry_events_inquiry_idx" ON "inquiry_events" USING btree ("inquiry_id","created_at");