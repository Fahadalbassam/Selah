CREATE TYPE "public"."chat_case_type" AS ENUM('recommendation', 'action', 'finding', 'meeting', 'document');--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "case_type" "chat_case_type";--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "case_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "last_message_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "keep" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "chat_archive_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "chat_after_close_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "chat_idle_delete_days" integer DEFAULT 180 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ai_conversations_user_idx" ON "ai_conversations" USING btree ("user_id","last_message_at");--> statement-breakpoint
CREATE INDEX "ai_conversations_case_idx" ON "ai_conversations" USING btree ("case_type","case_id");--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversation_case" CHECK (("ai_conversations"."case_type" IS NULL) = ("ai_conversations"."case_id" IS NULL));--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversation_title" CHECK (length("ai_conversations"."title") <= 120);