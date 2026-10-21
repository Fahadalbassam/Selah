CREATE TABLE "meeting_transcripts" (
	"meeting_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"lang" text NOT NULL,
	"format" text NOT NULL,
	"body" text NOT NULL,
	"imported_by" uuid NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delete_after" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "transcript_keep_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD CONSTRAINT "meeting_transcripts_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD CONSTRAINT "meeting_transcripts_imported_by_user_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD CONSTRAINT "meeting_transcripts_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_transcripts_delete_idx" ON "meeting_transcripts" USING btree ("delete_after");