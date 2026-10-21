CREATE TYPE "public"."assessment_status" AS ENUM('draft', 'final');--> statement-breakpoint
CREATE TYPE "public"."criterion_basis" AS ENUM('legal_requirement', 'regulator_guidance', 'good_practice', 'firm_method', 'team_proposed');--> statement-breakpoint
CREATE TYPE "public"."legal_form" AS ENUM('sole_proprietorship', 'llc', 'closed_jsc', 'listed_jsc', 'non_profit', 'other');--> statement-breakpoint
CREATE TYPE "public"."assessment_question_type" AS ENUM('yes_no', 'multiple_choice', 'rating', 'text');--> statement-breakpoint
CREATE TYPE "public"."template_version_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "assessment_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"basis" "criterion_basis" NOT NULL,
	"value" text,
	"text_answer" text,
	"comment" text,
	"answered_by" uuid,
	"answered_at" timestamp with time zone,
	CONSTRAINT "assessment_answers_question_uq" UNIQUE("assessment_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "assessment_evidence" (
	"answer_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_evidence_answer_id_document_id_pk" PRIMARY KEY("answer_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "assessment_notes" (
	"answer_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"body" text NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"description" text,
	"description_ar" text,
	"archived_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_templates_firm_uq" UNIQUE("id","firm_org_id")
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"firm_org_id" uuid NOT NULL,
	"template_version_id" uuid NOT NULL,
	"title" text NOT NULL,
	"legal_form" "legal_form" NOT NULL,
	"status" "assessment_status" DEFAULT 'draft' NOT NULL,
	"shared_with_client" boolean DEFAULT false NOT NULL,
	"finalised_by" uuid,
	"finalised_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessments_scope_uq" UNIQUE("id","project_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "template_authors" (
	"firm_org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_authors_firm_org_id_user_id_pk" PRIMARY KEY("firm_org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "template_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"firm_org_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"ref" text,
	"prompt" text NOT NULL,
	"prompt_ar" text,
	"guidance" text,
	"guidance_ar" text,
	"type" "assessment_question_type" NOT NULL,
	"options" jsonb,
	"weight" integer DEFAULT 1 NOT NULL,
	"gap_max_points" integer,
	"basis" "criterion_basis" NOT NULL,
	"legal_for" "legal_form"[],
	"guidance_for" "legal_form"[],
	"citation" text,
	"locator" text,
	"citation_verified" boolean DEFAULT false NOT NULL,
	"applies_if_question_id" uuid,
	"applies_if_values" text[],
	CONSTRAINT "template_questions_weight" CHECK ("template_questions"."weight" BETWEEN 1 AND 3),
	CONSTRAINT "template_questions_gap" CHECK ("template_questions"."gap_max_points" IS NULL OR "template_questions"."gap_max_points" >= 0),
	CONSTRAINT "template_questions_own_basis" CHECK ("template_questions"."basis" NOT IN ('legal_requirement', 'regulator_guidance')),
	CONSTRAINT "template_questions_sourced" CHECK (("template_questions"."basis" <> 'good_practice' AND coalesce(cardinality("template_questions"."legal_for"), 0) = 0 AND coalesce(cardinality("template_questions"."guidance_for"), 0) = 0)
        OR (nullif(trim("template_questions"."citation"), '') IS NOT NULL AND nullif(trim("template_questions"."locator"), '') IS NOT NULL)),
	CONSTRAINT "template_questions_applies" CHECK (("template_questions"."applies_if_question_id" IS NULL) = ("template_questions"."applies_if_values" IS NULL) AND ("template_questions"."applies_if_values" IS NULL OR cardinality("template_questions"."applies_if_values") > 0))
);
--> statement-breakpoint
CREATE TABLE "template_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"firm_org_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"title_ar" text,
	"description" text,
	"description_ar" text,
	CONSTRAINT "template_sections_version_uq" UNIQUE("id","version_id")
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"firm_org_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "template_version_status" DEFAULT 'draft' NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_versions_number_uq" UNIQUE("template_id","version"),
	CONSTRAINT "template_versions_firm_uq" UNIQUE("id","firm_org_id")
);
--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "assessment_answer_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "legal_form" "legal_form";--> statement-breakpoint
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_question_id_template_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."template_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_answered_by_user_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_assessment_fk" FOREIGN KEY ("assessment_id","project_id","org_id") REFERENCES "public"."assessments"("id","project_id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_evidence" ADD CONSTRAINT "assessment_evidence_answer_id_assessment_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."assessment_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_evidence" ADD CONSTRAINT "assessment_evidence_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_evidence" ADD CONSTRAINT "assessment_evidence_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_evidence" ADD CONSTRAINT "assessment_evidence_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_notes" ADD CONSTRAINT "assessment_notes_answer_id_assessment_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."assessment_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_notes" ADD CONSTRAINT "assessment_notes_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_notes" ADD CONSTRAINT "assessment_notes_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_templates" ADD CONSTRAINT "assessment_templates_firm_org_id_organizations_id_fk" FOREIGN KEY ("firm_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_templates" ADD CONSTRAINT "assessment_templates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_firm_org_id_organizations_id_fk" FOREIGN KEY ("firm_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_finalised_by_user_id_fk" FOREIGN KEY ("finalised_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_version_fk" FOREIGN KEY ("template_version_id","firm_org_id") REFERENCES "public"."template_versions"("id","firm_org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_authors" ADD CONSTRAINT "template_authors_firm_org_id_organizations_id_fk" FOREIGN KEY ("firm_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_authors" ADD CONSTRAINT "template_authors_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_authors" ADD CONSTRAINT "template_authors_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_questions" ADD CONSTRAINT "template_questions_applies_if_question_id_template_questions_id_fk" FOREIGN KEY ("applies_if_question_id") REFERENCES "public"."template_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_questions" ADD CONSTRAINT "template_questions_section_fk" FOREIGN KEY ("section_id","version_id") REFERENCES "public"."template_sections"("id","version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_questions" ADD CONSTRAINT "template_questions_version_fk" FOREIGN KEY ("version_id","firm_org_id") REFERENCES "public"."template_versions"("id","firm_org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_sections" ADD CONSTRAINT "template_sections_version_fk" FOREIGN KEY ("version_id","firm_org_id") REFERENCES "public"."template_versions"("id","firm_org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_fk" FOREIGN KEY ("template_id","firm_org_id") REFERENCES "public"."assessment_templates"("id","firm_org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessment_answers_assessment_idx" ON "assessment_answers" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "assessments_project_idx" ON "assessments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "template_questions_version_idx" ON "template_questions" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "template_sections_version_idx" ON "template_sections" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_versions_one_draft" ON "template_versions" USING btree ("template_id") WHERE status = 'draft';--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_assessment_answer_id_assessment_answers_id_fk" FOREIGN KEY ("assessment_answer_id") REFERENCES "public"."assessment_answers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "findings_answer_uq" ON "findings" USING btree ("assessment_answer_id");