CREATE TYPE "public"."text_status" AS ENUM('pending', 'searchable', 'not_searchable');--> statement-breakpoint
CREATE TABLE "document_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"lang" text NOT NULL,
	"summary" text NOT NULL,
	"citations" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_summary_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"line" integer NOT NULL,
	"kind" text NOT NULL,
	"transcript_start" integer,
	"transcript_end" integer,
	"document_id" uuid,
	"document_version" integer,
	"page" integer
);
--> statement-breakpoint
ALTER TABLE "ai_chunks" ADD COLUMN "page" integer;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "lang" text DEFAULT 'ar' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "text_status" text_status DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_summaries" ADD CONSTRAINT "document_summaries_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_summaries" ADD CONSTRAINT "document_summaries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_summaries" ADD CONSTRAINT "document_summaries_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_summary_sources" ADD CONSTRAINT "meeting_summary_sources_meeting_id_meeting_summaries_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting_summaries"("meeting_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_summary_sources" ADD CONSTRAINT "meeting_summary_sources_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_summary_sources" ADD CONSTRAINT "meeting_summary_sources_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_summaries_once" ON "document_summaries" USING btree ("document_id","sha256","lang");--> statement-breakpoint
CREATE INDEX "meeting_summary_sources_meeting_idx" ON "meeting_summary_sources" USING btree ("meeting_id","line");