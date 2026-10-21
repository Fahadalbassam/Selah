CREATE TYPE "public"."kpi_direction" AS ENUM('higher_better', 'lower_better');--> statement-breakpoint
CREATE TYPE "public"."kpi_frequency" AS ENUM('monthly', 'quarterly');--> statement-breakpoint
CREATE TYPE "public"."kpi_perspective" AS ENUM('financial', 'customer', 'internal_process', 'learning_growth');--> statement-breakpoint
CREATE TYPE "public"."kpi_reading_status" AS ENUM('reported', 'verified', 'rejected');--> statement-breakpoint
CREATE TABLE "firm_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"client_kpis_enabled" boolean DEFAULT false NOT NULL,
	"kpi_grace_days" integer DEFAULT 10 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"kpi_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"value" numeric NOT NULL,
	"reported_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evidence_document_id" uuid,
	"supersedes_id" uuid,
	"status" "kpi_reading_status" DEFAULT 'reported' NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "kpis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"objective_id" uuid NOT NULL,
	"name_ar" text,
	"name_en" text,
	"unit" text NOT NULL,
	"direction" "kpi_direction" NOT NULL,
	"baseline" numeric NOT NULL,
	"target" numeric NOT NULL,
	"start_date" date NOT NULL,
	"target_date" date NOT NULL,
	"frequency" "kpi_frequency" NOT NULL,
	"owner_user_id" uuid,
	"data_source" text,
	"green_threshold" integer DEFAULT 90 NOT NULL,
	"amber_threshold" integer DEFAULT 60 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_named" CHECK (coalesce("kpis"."name_ar", "kpis"."name_en") IS NOT NULL),
	CONSTRAINT "kpi_dates" CHECK ("kpis"."target_date" > "kpis"."start_date"),
	CONSTRAINT "kpi_thresholds" CHECK (0 <= "kpis"."amber_threshold" AND "kpis"."amber_threshold" <= "kpis"."green_threshold" AND "kpis"."green_threshold" <= 100)
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"value" numeric,
	"as_of" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendation_kpis" (
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"kpi_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_kpis_recommendation_id_kpi_id_pk" PRIMARY KEY("recommendation_id","kpi_id")
);
--> statement-breakpoint
CREATE TABLE "strategic_objectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"perspective" "kpi_perspective" NOT NULL,
	"title_ar" text,
	"title_en" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "objective_titled" CHECK (coalesce("strategic_objectives"."title_ar", "strategic_objectives"."title_en") IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "baseline_due_date" date;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD CONSTRAINT "firm_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_readings" ADD CONSTRAINT "kpi_readings_kpi_id_kpis_id_fk" FOREIGN KEY ("kpi_id") REFERENCES "public"."kpis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_readings" ADD CONSTRAINT "kpi_readings_reported_by_user_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_readings" ADD CONSTRAINT "kpi_readings_evidence_document_id_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_readings" ADD CONSTRAINT "kpi_readings_supersedes_id_kpi_readings_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."kpi_readings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_readings" ADD CONSTRAINT "kpi_readings_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_readings" ADD CONSTRAINT "kpi_readings_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpis" ADD CONSTRAINT "kpis_objective_id_strategic_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."strategic_objectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpis" ADD CONSTRAINT "kpis_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpis" ADD CONSTRAINT "kpis_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpis" ADD CONSTRAINT "kpis_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_kpis" ADD CONSTRAINT "recommendation_kpis_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_kpis" ADD CONSTRAINT "recommendation_kpis_kpi_id_kpis_id_fk" FOREIGN KEY ("kpi_id") REFERENCES "public"."kpis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_kpis" ADD CONSTRAINT "recommendation_kpis_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_kpis" ADD CONSTRAINT "recommendation_kpis_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategic_objectives" ADD CONSTRAINT "strategic_objectives_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategic_objectives" ADD CONSTRAINT "strategic_objectives_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kpi_readings_kpi_idx" ON "kpi_readings" USING btree ("kpi_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_readings_supersede_once" ON "kpi_readings" USING btree ("supersedes_id");--> statement-breakpoint
CREATE INDEX "kpis_objective_idx" ON "kpis" USING btree ("objective_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_snapshots_once" ON "metric_snapshots" USING btree ("project_id","metric","as_of");