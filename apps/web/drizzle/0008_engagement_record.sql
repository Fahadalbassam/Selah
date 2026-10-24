ALTER TYPE "public"."project_state" ADD VALUE 'draft';--> statement-breakpoint
CREATE TABLE "engagement_deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"acceptance_criteria" text,
	"due_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_org_id" uuid NOT NULL,
	"client_org_id" uuid NOT NULL,
	"inquiry_id" uuid,
	"title" text NOT NULL,
	"signed_on" date NOT NULL,
	"contract_ref" text,
	"scope" text NOT NULL,
	"exclusions" text,
	"data_agreement_on" date,
	"starts_on" date,
	"ends_on" date,
	"retainer_follows" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagements_inquiry_id_unique" UNIQUE("inquiry_id"),
	CONSTRAINT "engagement_period" CHECK ("engagements"."ends_on" IS NULL OR "engagements"."starts_on" IS NULL OR "engagements"."ends_on" >= "engagements"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "engagement_id" uuid;--> statement-breakpoint
ALTER TABLE "engagement_deliverables" ADD CONSTRAINT "engagement_deliverables_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_deliverables" ADD CONSTRAINT "engagement_deliverables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_deliverables" ADD CONSTRAINT "engagement_deliverables_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_firm_org_id_organizations_id_fk" FOREIGN KEY ("firm_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_client_org_id_organizations_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_inquiry_id_inquiries_id_fk" FOREIGN KEY ("inquiry_id") REFERENCES "public"."inquiries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "engagement_deliverables_engagement_idx" ON "engagement_deliverables" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "engagements_client_idx" ON "engagements" USING btree ("client_org_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The signed engagement (wave 1, item 5, 2026-10-24) and draft projects
-- (journey-map gap N3). An engagement records what the client signed; the
-- projects it covers are its phases. A client project no engagement covers
-- is a draft: a pitch or a phase not yet agreed. The firm works on it, the
-- client never sees it, and it becomes planned when an engagement covers
-- it. ('draft' is compared as text below: a new enum value can't be used as
-- a literal in the transaction that adds it.)
GRANT SELECT, INSERT, UPDATE, DELETE ON engagements, engagement_deliverables TO selah_app;
--> statement-breakpoint
ALTER TABLE engagements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE engagement_deliverables ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The firm admin and the client's consultants read it; so does the client's
-- admin (it is their contract). Only the firm admin records and changes it.
CREATE FUNCTION app_can_see_engagement(eid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM engagements g WHERE g.id = eid AND (
      (app_org_kind() = 'firm' AND g.firm_org_id = app_org()
        AND (app_role() = 'firm_admin' OR app_is_assigned_to_client(g.client_org_id)))
      OR (app_role() = 'client_admin' AND g.client_org_id = app_org())
    )
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_see_engagement(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_see_engagement(uuid) TO selah_app;
--> statement-breakpoint
CREATE POLICY engagement_read ON engagements FOR SELECT TO selah_app USING (app_can_see_engagement(id));
--> statement-breakpoint
CREATE POLICY engagement_write ON engagements FOR ALL TO selah_app
  USING (app_role() = 'firm_admin' AND firm_org_id = app_org())
  WITH CHECK (app_role() = 'firm_admin' AND firm_org_id = app_org());
--> statement-breakpoint
CREATE POLICY deliverable_read ON engagement_deliverables FOR SELECT TO selah_app USING (app_can_see_engagement(engagement_id));
--> statement-breakpoint
CREATE POLICY deliverable_write ON engagement_deliverables FOR ALL TO selah_app
  USING (app_role() = 'firm_admin' AND app_can_see_engagement(engagement_id))
  WITH CHECK (app_role() = 'firm_admin' AND app_can_see_engagement(engagement_id));
--> statement-breakpoint
-- An engagement is between the firm and one of its clients, signed on a day
-- that has come, from an inquiry of the same firm that became this client.
CREATE FUNCTION check_engagement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = NEW.firm_org_id AND o.kind = 'firm')
     OR NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = NEW.client_org_id AND o.kind = 'client') THEN
    RAISE EXCEPTION 'an engagement is between the firm and a client' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.client_org_id <> OLD.client_org_id THEN
    RAISE EXCEPTION 'an engagement stays with its client' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.signed_on > app_firm_today() OR NEW.data_agreement_on > app_firm_today() THEN
    RAISE EXCEPTION 'record a signature on or after the day it happens' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.inquiry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM inquiries i WHERE i.id = NEW.inquiry_id AND i.firm_org_id = NEW.firm_org_id
      AND (i.client_org_id IS NULL OR i.client_org_id = NEW.client_org_id)
  ) THEN
    RAISE EXCEPTION 'the engagement comes from an inquiry of this client' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_engagement() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER engagement_rules BEFORE INSERT OR UPDATE ON engagements FOR EACH ROW EXECUTE FUNCTION check_engagement();
--> statement-breakpoint
-- A deliverable's project is one the engagement covers.
CREATE FUNCTION check_engagement_deliverable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.engagement_id = NEW.engagement_id
  ) THEN
    RAISE EXCEPTION 'a deliverable belongs to a project the engagement covers' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_engagement_deliverable() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER deliverable_rules BEFORE INSERT OR UPDATE ON engagement_deliverables
  FOR EACH ROW EXECUTE FUNCTION check_engagement_deliverable();
--> statement-breakpoint
-- A project and its engagement: the same client; a draft becomes planned
-- when an engagement covers it, and only then leaves draft; a covered
-- project keeps an engagement. Internal projects are never drafts.
CREATE FUNCTION check_project_engagement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.kind = 'internal' AND (NEW.state::text = 'draft' OR NEW.engagement_id IS NOT NULL) THEN
    RAISE EXCEPTION 'drafts and engagements are for client projects' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.engagement_id IS NOT NULL THEN
    -- Covering a project is agreeing its scope: the firm admin's step.
    IF (TG_OP = 'INSERT' OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id)
       AND app_uid() IS NOT NULL AND app_role() IS DISTINCT FROM 'firm_admin' THEN
      RAISE EXCEPTION 'only the firm admin puts a project under an engagement' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM engagements g WHERE g.id = NEW.engagement_id AND g.client_org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'a project is covered by an engagement of its own client' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.state::text = 'draft' THEN
      NEW.state := 'planned';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state::text = 'draft' AND NEW.state::text <> 'draft' AND NEW.engagement_id IS NULL THEN
      RAISE EXCEPTION 'a draft project starts when a signed engagement covers it' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.engagement_id IS NOT NULL AND NEW.engagement_id IS NULL THEN
      RAISE EXCEPTION 'a project keeps the engagement that covers it' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.state::text <> 'draft' AND NEW.state::text = 'draft' THEN
      RAISE EXCEPTION 'a project the client has seen is never a draft again' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_project_engagement() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER project_engagement BEFORE INSERT OR UPDATE OF engagement_id, state, kind ON projects
  FOR EACH ROW EXECUTE FUNCTION check_project_engagement();
--> statement-breakpoint
-- The client's people join a project once an engagement covers it: they are
-- told when they are added, and a draft is hidden from them.
CREATE FUNCTION check_draft_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.state::text = 'draft')
     AND EXISTS (SELECT 1 FROM org_memberships m JOIN organizations o ON o.id = m.org_id
                 WHERE m.user_id = NEW.user_id AND o.kind = 'client') THEN
    RAISE EXCEPTION 'the client''s people join once a signed engagement covers the project' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_draft_member() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER draft_member BEFORE INSERT ON project_members FOR EACH ROW EXECUTE FUNCTION check_draft_member();
--> statement-breakpoint
-- The project check from the spec, with drafts hidden from the client.
CREATE OR REPLACE FUNCTION app_can_see_project(eid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects e
    WHERE e.id = eid AND (
      (app_role() = 'firm_admin' AND e.firm_org_id = app_org())
      OR (app_role() = 'consultant' AND e.firm_org_id = app_org() AND (
            EXISTS (SELECT 1 FROM project_members em WHERE em.project_id = eid AND em.user_id = app_uid())
            OR (e.kind = 'client' AND app_is_client_lead(e.org_id))))
      OR (app_role() = 'client_admin' AND e.kind = 'client' AND e.org_id = app_org() AND e.state::text <> 'draft')
      OR (app_role() IN ('client_manager', 'action_owner') AND e.kind = 'client' AND e.org_id = app_org()
          AND e.state::text <> 'draft'
          AND EXISTS (SELECT 1 FROM project_members em WHERE em.project_id = eid AND em.user_id = app_uid()))
    )
  )
$$;
