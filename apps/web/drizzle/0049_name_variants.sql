ALTER TABLE "user" ADD COLUMN "name_alt" text;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD COLUMN "name_alt" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "short_names" text[] DEFAULT '{}'::text[] NOT NULL;