CREATE TABLE "item_audience_people" (
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "item_audience_people_item_type_item_id_user_id_pk" PRIMARY KEY("item_type","item_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "item_audiences" (
	"org_id" uuid NOT NULL,
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"set_by" uuid NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_audiences_item_type_item_id_pk" PRIMARY KEY("item_type","item_id"),
	CONSTRAINT "item_audience_type" CHECK ("item_audiences"."item_type" IN ('document', 'meeting')),
	CONSTRAINT "item_audience_mode" CHECK ("item_audiences"."mode" IN ('except', 'only'))
);
--> statement-breakpoint
ALTER TABLE "outbound_emails" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "item_audience_people" ADD CONSTRAINT "item_audience_people_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_audience_people" ADD CONSTRAINT "item_audience_people_audience_fk" FOREIGN KEY ("item_type","item_id") REFERENCES "public"."item_audiences"("item_type","item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_audiences" ADD CONSTRAINT "item_audiences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_audiences" ADD CONSTRAINT "item_audiences_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_audience_people_user_idx" ON "item_audience_people" USING btree ("user_id");