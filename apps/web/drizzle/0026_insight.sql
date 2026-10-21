CREATE TABLE "project_visits" (
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_visits_user_id_project_id_pk" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "minimal_purge_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "minimal_records" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "display_alias" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "minimal_purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_visits" ADD CONSTRAINT "project_visits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_visits" ADD CONSTRAINT "project_visits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;