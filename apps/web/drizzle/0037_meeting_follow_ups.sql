ALTER TABLE "follow_ups" ADD COLUMN "meeting_id" uuid;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "follow_ups_meeting_idx" ON "follow_ups" USING btree ("meeting_id");