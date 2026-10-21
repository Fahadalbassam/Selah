ALTER TABLE "outbound_emails" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD COLUMN "failed_at" timestamp with time zone;