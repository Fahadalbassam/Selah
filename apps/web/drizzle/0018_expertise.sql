CREATE TABLE "consultant_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"firm_org_id" uuid NOT NULL,
	"languages" text[] DEFAULT '{ar}'::text[] NOT NULL,
	"accepting_new_clients" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consultant_sectors" (
	"user_id" uuid NOT NULL,
	"sector_id" uuid NOT NULL,
	CONSTRAINT "consultant_sectors_user_id_sector_id_pk" PRIMARY KEY("user_id","sector_id")
);
--> statement-breakpoint
CREATE TABLE "consultant_service_areas" (
	"user_id" uuid NOT NULL,
	"service_area_id" uuid NOT NULL,
	CONSTRAINT "consultant_service_areas_user_id_service_area_id_pk" PRIMARY KEY("user_id","service_area_id")
);
--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "suggestions_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "consultant_profiles" ADD CONSTRAINT "consultant_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultant_profiles" ADD CONSTRAINT "consultant_profiles_firm_org_id_organizations_id_fk" FOREIGN KEY ("firm_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultant_sectors" ADD CONSTRAINT "consultant_sectors_user_id_consultant_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."consultant_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultant_sectors" ADD CONSTRAINT "consultant_sectors_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultant_service_areas" ADD CONSTRAINT "consultant_service_areas_user_id_consultant_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."consultant_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultant_service_areas" ADD CONSTRAINT "consultant_service_areas_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE no action ON UPDATE no action;