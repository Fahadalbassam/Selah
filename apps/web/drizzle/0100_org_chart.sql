CREATE TYPE "public"."org_chart_request_status" AS ENUM('open', 'done', 'declined');--> statement-breakpoint
CREATE TYPE "public"."org_chart_state" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."org_unit_kind" AS ENUM('board', 'committee', 'executive', 'sector', 'department', 'section', 'unit', 'office');--> statement-breakpoint
CREATE TABLE "org_chart_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chart_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"what" text NOT NULL,
	"where_text" text,
	"why" text,
	"status" "org_chart_request_status" DEFAULT 'open' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "org_chart_request_what" CHECK (char_length(btrim("org_chart_change_requests"."what")) BETWEEN 3 AND 1000),
	CONSTRAINT "org_chart_request_texts" CHECK (char_length(coalesce("org_chart_change_requests"."where_text", '')) <= 300 AND char_length(coalesce("org_chart_change_requests"."why", '')) <= 1000),
	CONSTRAINT "org_chart_request_closed" CHECK (("org_chart_change_requests"."status" = 'open') = ("org_chart_change_requests"."closed_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "org_chart_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chart_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"state" "org_chart_state" DEFAULT 'draft' NOT NULL,
	"number" integer,
	"effective_on" date,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"resolution_document_id" uuid,
	"show_names" boolean DEFAULT false NOT NULL,
	"published_snapshot" jsonb,
	"based_on_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_chart_versions_id_org_uq" UNIQUE("id","org_id"),
	CONSTRAINT "org_chart_version_published" CHECK (("org_chart_versions"."state" = 'draft') = ("org_chart_versions"."number" IS NULL) AND ("org_chart_versions"."state" = 'draft') = ("org_chart_versions"."effective_on" IS NULL)
        AND ("org_chart_versions"."state" = 'draft') = ("org_chart_versions"."published_at" IS NULL) AND ("org_chart_versions"."state" = 'draft') = ("org_chart_versions"."published_snapshot" IS NULL)),
	CONSTRAINT "org_chart_version_superseded" CHECK (("org_chart_versions"."state" = 'superseded') = ("org_chart_versions"."superseded_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "org_charts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_charts_org_id_unique" UNIQUE("org_id"),
	CONSTRAINT "org_charts_id_org_uq" UNIQUE("id","org_id")
);
--> statement-breakpoint
CREATE TABLE "org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" "org_unit_kind" NOT NULL,
	"code" text NOT NULL,
	"name_ar" text,
	"name_en" text,
	"level" smallint DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"advisory" boolean DEFAULT false NOT NULL,
	"department_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_unit_named" CHECK (coalesce("org_units"."name_ar", "org_units"."name_en") IS NOT NULL),
	CONSTRAINT "org_unit_name_length" CHECK (char_length(coalesce("org_units"."name_ar", '')) <= 200 AND char_length(coalesce("org_units"."name_en", '')) <= 200),
	CONSTRAINT "org_unit_code" CHECK ("org_units"."code" ~ '^[0-9A-Za-z][0-9A-Za-z.-]{0,39}$'),
	CONSTRAINT "org_unit_level" CHECK ("org_units"."level" BETWEEN 1 AND 12),
	CONSTRAINT "org_unit_not_own_parent" CHECK ("org_units"."parent_id" IS DISTINCT FROM "org_units"."id")
);
--> statement-breakpoint
CREATE TABLE "position_holders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chart_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"position_lineage_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text,
	"from_date" date NOT NULL,
	"to_date" date,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_by" uuid,
	"ended_at" timestamp with time zone,
	CONSTRAINT "position_holder_who" CHECK (num_nonnulls("position_holders"."user_id", "position_holders"."name") = 1),
	CONSTRAINT "position_holder_name" CHECK ("position_holders"."name" IS NULL OR char_length(btrim("position_holders"."name")) BETWEEN 2 AND 200),
	CONSTRAINT "position_holder_dates" CHECK ("position_holders"."to_date" IS NULL OR "position_holders"."to_date" >= "position_holders"."from_date")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"lineage_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title_ar" text,
	"title_en" text,
	"reports_to_id" uuid,
	"is_head" boolean DEFAULT false NOT NULL,
	"specialties" text[] DEFAULT '{}'::text[] NOT NULL,
	"planned_count" smallint DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_titled" CHECK (coalesce("positions"."title_ar", "positions"."title_en") IS NOT NULL),
	CONSTRAINT "position_title_length" CHECK (char_length(coalesce("positions"."title_ar", '')) <= 200 AND char_length(coalesce("positions"."title_en", '')) <= 200),
	CONSTRAINT "position_code" CHECK ("positions"."code" ~ '^[0-9A-Za-z][0-9A-Za-z.-]{0,39}$'),
	CONSTRAINT "position_planned" CHECK ("positions"."planned_count" BETWEEN 1 AND 999),
	CONSTRAINT "position_specialties" CHECK (cardinality("positions"."specialties") <= 30),
	CONSTRAINT "position_not_own_manager" CHECK ("positions"."reports_to_id" IS DISTINCT FROM "positions"."id")
);
--> statement-breakpoint
ALTER TABLE "org_chart_change_requests" ADD CONSTRAINT "org_chart_change_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_chart_change_requests" ADD CONSTRAINT "org_chart_change_requests_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_chart_change_requests" ADD CONSTRAINT "org_chart_change_requests_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_chart_change_requests" ADD CONSTRAINT "org_chart_change_requests_chart_fk" FOREIGN KEY ("chart_id","org_id") REFERENCES "public"."org_charts"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_chart_versions" ADD CONSTRAINT "org_chart_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_chart_versions" ADD CONSTRAINT "org_chart_versions_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_chart_versions" ADD CONSTRAINT "org_chart_versions_resolution_document_id_documents_id_fk" FOREIGN KEY ("resolution_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_chart_versions" ADD CONSTRAINT "org_chart_versions_based_on_id_org_chart_versions_id_fk" FOREIGN KEY ("based_on_id") REFERENCES "public"."org_chart_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_chart_versions" ADD CONSTRAINT "org_chart_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_chart_versions" ADD CONSTRAINT "org_chart_versions_chart_fk" FOREIGN KEY ("chart_id","org_id") REFERENCES "public"."org_charts"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_charts" ADD CONSTRAINT "org_charts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_charts" ADD CONSTRAINT "org_charts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_org_units_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_version_fk" FOREIGN KEY ("version_id","org_id") REFERENCES "public"."org_chart_versions"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_department_fk" FOREIGN KEY ("department_id","org_id") REFERENCES "public"."departments"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_holders" ADD CONSTRAINT "position_holders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_holders" ADD CONSTRAINT "position_holders_position_lineage_id_positions_id_fk" FOREIGN KEY ("position_lineage_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_holders" ADD CONSTRAINT "position_holders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_holders" ADD CONSTRAINT "position_holders_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_holders" ADD CONSTRAINT "position_holders_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_holders" ADD CONSTRAINT "position_holders_chart_fk" FOREIGN KEY ("chart_id","org_id") REFERENCES "public"."org_charts"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."org_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_lineage_id_positions_id_fk" FOREIGN KEY ("lineage_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_reports_to_id_positions_id_fk" FOREIGN KEY ("reports_to_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_version_fk" FOREIGN KEY ("version_id","org_id") REFERENCES "public"."org_chart_versions"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_chart_change_requests_chart_idx" ON "org_chart_change_requests" USING btree ("chart_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "org_chart_versions_one_draft" ON "org_chart_versions" USING btree ("chart_id") WHERE "org_chart_versions"."state" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "org_chart_versions_one_current" ON "org_chart_versions" USING btree ("chart_id") WHERE "org_chart_versions"."state" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "org_chart_versions_number_uq" ON "org_chart_versions" USING btree ("chart_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "org_units_code_uq" ON "org_units" USING btree ("version_id","code");--> statement-breakpoint
CREATE INDEX "org_units_parent_idx" ON "org_units" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "org_units_department_idx" ON "org_units" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "position_holders_lineage_idx" ON "position_holders" USING btree ("position_lineage_id","from_date");--> statement-breakpoint
CREATE INDEX "position_holders_user_idx" ON "position_holders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "position_holders_chart_idx" ON "position_holders" USING btree ("chart_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_code_uq" ON "positions" USING btree ("version_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_lineage_uq" ON "positions" USING btree ("version_id","lineage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_one_head" ON "positions" USING btree ("unit_id") WHERE "positions"."is_head";--> statement-breakpoint
CREATE INDEX "positions_unit_idx" ON "positions" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "positions_reports_to_idx" ON "positions" USING btree ("reports_to_id");--> statement-breakpoint
CREATE INDEX "positions_lineage_idx" ON "positions" USING btree ("lineage_id");--> statement-breakpoint
-- ------------------------------------------ the client's organisation structure
-- Approved 17 Nov 2026 (gate A follow-ups, section 3, new feature B), part 1
-- of 5: the data, the rules and the services; the screens come later.
--
-- The firm sells the organisation structure as a service and the board
-- approves it (CMA Corporate Governance Regulations, articles 22 and 23).
-- Inside Selah it becomes the client's living structure: positions, not
-- people, so a position outlives whoever sits in it.
--
-- Shape. One org_charts row per client (org-level, like its indicators).
-- org_chart_versions holds the firm's one draft and every published version
-- (state published: the current one; superseded: history, never deleted).
-- Each version has its own org_units and positions rows; a published
-- version's rows never change, and its published_snapshot is the frozen
-- structure (no names) that the client view, the PDF and the history read.
-- Publishing turns the draft into the current version and copies it into a
-- fresh draft, so the firm always has one to edit. People sit in positions
-- through position_holders, dated; a holding belongs to the position across
-- versions (positions.lineage_id: the id of the position's first row), so a
-- new drawing never loses who holds what, and the client's admin keeps names
-- current on the published structure without touching the firm's draft.
--
-- The chart never grants or limits access to any work. A unit linked to a
-- department is a label; app_dept_ok() and the department rules are untouched.
-- Selah never designs, scores or judges a structure.

-- 1. Who reads, edits and publishes. Each answers true or false, never null
--    (a caller with no active membership is simply nobody).

-- Firm people who read a client's structure, with every name: the firm
-- admin, the client's lead and deputy, and consultants staffed on any of its
-- projects (an observer, or someone on a closed project, reads too).
CREATE FUNCTION app_org_chart_firm_reader(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(app_firm_works_with(org) AND (
    app_role() = 'firm_admin'
    OR app_is_client_lead(org)
    OR EXISTS (
      SELECT 1 FROM project_members pm JOIN projects p ON p.id = pm.project_id
      WHERE pm.user_id = app_uid() AND p.org_id = org AND p.kind = 'client')
  ), false)
$$;
--> statement-breakpoint
-- Firm people who edit the draft and change holders: the firm admin, the
-- lead, the deputy, and consultants staffed, not as observers, on one of the
-- client's projects that is not closed (the same people as D4 for indicators).
CREATE FUNCTION app_org_chart_editor(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(app_firm_works_with(org) AND (
    app_role() = 'firm_admin'
    OR app_is_client_lead(org)
    OR EXISTS (
      SELECT 1 FROM project_members pm JOIN projects p ON p.id = pm.project_id
      WHERE pm.user_id = app_uid() AND NOT pm.observer AND p.org_id = org AND p.kind = 'client' AND p.state <> 'closed')
  ), false)
$$;
--> statement-breakpoint
-- Who publishes: the firm admin, the client's lead or its deputy.
CREATE FUNCTION app_org_chart_publisher(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(app_firm_works_with(org) AND (app_role() = 'firm_admin' OR app_is_client_lead(org)), false)
$$;
--> statement-breakpoint
-- Who reads the client's published structure and its history: the firm's
-- readers, and the client's admins and managers. Action owners don't (they get
-- "your manager" only, app_my_manager). A restricted client has admins only.
CREATE FUNCTION app_org_chart_readable(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_org_chart_firm_reader(org)
    OR coalesce(app_org_kind() = 'client' AND org = app_org() AND app_role() IN ('client_admin', 'client_manager'), false)
$$;
--> statement-breakpoint
-- A version: the draft is the firm's; published and past versions for every reader.
CREATE FUNCTION app_org_chart_version_readable(vid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT CASE WHEN v.state = 'draft' THEN app_org_chart_firm_reader(v.org_id) ELSE app_org_chart_readable(v.org_id) END
    FROM org_chart_versions v WHERE v.id = vid), false)
$$;
--> statement-breakpoint
-- Who changes the people in positions: the firm's editors, and the client's admin.
CREATE FUNCTION app_org_chart_holder_writer(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_org_chart_editor(org) OR coalesce(app_org_kind() = 'client' AND app_role() = 'client_admin' AND org = app_org(), false)
$$;
--> statement-breakpoint
-- A position that is on a published or past version (not only the firm's draft).
CREATE FUNCTION app_org_chart_lineage_published(lineage uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM positions p JOIN org_chart_versions v ON v.id = p.version_id
    WHERE p.lineage_id = lineage AND v.state <> 'draft')
$$;
--> statement-breakpoint
-- 2. Names, on the server only.
--
-- A client manager's branch in a version: the units linked to her
-- departments and every unit under them, and the chain above it: the
-- positions those positions report to, up to the top, and the heads of the
-- units above the linked ones. Positions only, never names. Internal.
CREATE FUNCTION app_org_chart_branch(vid uuid, uid uuid) RETURNS TABLE (position_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH RECURSIVE linked AS (
    SELECT u.id, u.parent_id FROM org_units u
    WHERE u.version_id = vid AND u.department_id IN (SELECT dm.department_id FROM department_members dm WHERE dm.user_id = uid)
  ), down (id) AS (
    SELECT id FROM linked
    UNION
    SELECT c.id FROM org_units c JOIN down d ON c.parent_id = d.id
  ), above (id) AS (
    SELECT parent_id FROM linked WHERE parent_id IS NOT NULL
    UNION
    SELECT u.parent_id FROM org_units u JOIN above a ON u.id = a.id WHERE u.parent_id IS NOT NULL
  ), mine AS (
    SELECT p.id, p.reports_to_id FROM positions p JOIN down d ON p.unit_id = d.id
  ), chain (id) AS (
    SELECT reports_to_id FROM mine WHERE reports_to_id IS NOT NULL
    UNION
    SELECT p.reports_to_id FROM positions p JOIN chain c ON p.id = c.id WHERE p.reports_to_id IS NOT NULL
  )
  SELECT id FROM mine
  UNION SELECT id FROM chain
  UNION SELECT p.id FROM positions p JOIN above a ON p.unit_id = a.id WHERE p.is_head
$$;
--> statement-breakpoint
-- The positions of a version whose holders' names the caller sees: every one
-- for the firm's readers and the client's admins; for a client manager, her
-- branch and the chain above it, only while the version's show_names is on
-- and the client has departments (with departments off a manager has no
-- department of her own, so no branch). Nobody at a minimal-records client.
CREATE FUNCTION app_org_chart_named_positions(vid uuid) RETURNS TABLE (position_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH v AS (
    SELECT v.id, v.org_id, v.show_names, o.departments_enabled
    FROM org_chart_versions v JOIN organizations o ON o.id = v.org_id
    WHERE v.id = vid AND NOT o.minimal_records AND app_org_chart_version_readable(v.id)
  )
  SELECT p.id FROM v JOIN positions p ON p.version_id = v.id
  WHERE app_org_chart_firm_reader(v.org_id) OR (app_org_kind() = 'client' AND app_role() = 'client_admin' AND v.org_id = app_org())
  UNION
  SELECT b.position_id FROM v CROSS JOIN LATERAL app_org_chart_branch(v.id, app_uid()) b
  WHERE app_org_kind() = 'client' AND app_role() = 'client_manager' AND v.org_id = app_org() AND v.show_names AND v.departments_enabled
$$;
--> statement-breakpoint
-- Who holds each position of a version on a day. A holder the caller may not
-- name comes back as filled, with no name, person, dates or id: the name is
-- never sent to be hidden in the page. Nothing for a version the caller can't read.
CREATE FUNCTION app_org_chart_holders(vid uuid, as_of date)
RETURNS TABLE (position_id uuid, holder_id uuid, user_id uuid, name text, from_date date, to_date date, named boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH v AS (SELECT v.id FROM org_chart_versions v WHERE v.id = vid AND app_org_chart_version_readable(v.id)),
  named AS (SELECT n.position_id FROM app_org_chart_named_positions(vid) n)
  SELECT p.id,
    CASE WHEN k.ok THEN h.id END,
    CASE WHEN k.ok THEN h.user_id END,
    CASE WHEN k.ok THEN coalesce(h.name, u.name) END,
    CASE WHEN k.ok THEN h.from_date END,
    CASE WHEN k.ok THEN h.to_date END,
    k.ok
  FROM v JOIN positions p ON p.version_id = v.id
    JOIN position_holders h ON h.position_lineage_id = p.lineage_id AND h.from_date <= as_of AND (h.to_date IS NULL OR h.to_date >= as_of)
    LEFT JOIN "user" u ON u.id = h.user_id
    CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM named WHERE named.position_id = p.id) AS ok) k
  ORDER BY p.id, h.from_date
$$;
--> statement-breakpoint
-- "Your manager", for any client person who holds a position on the current
-- structure: the position theirs reports to, and who holds it today (vacant
-- when nobody does). No other names. The name only while the version shows
-- names, or for the client's admin.
CREATE FUNCTION app_my_manager()
RETURNS TABLE (my_position_id uuid, position_id uuid, code text, title_ar text, title_en text, holder_name text, vacant boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH v AS (
    SELECT v.id, v.show_names FROM org_chart_versions v JOIN organizations o ON o.id = v.org_id
    WHERE app_org_kind() = 'client' AND v.org_id = app_org() AND v.state = 'published' AND NOT o.minimal_records
  ), mine AS (
    SELECT DISTINCT p.id, p.reports_to_id, v.show_names FROM v JOIN positions p ON p.version_id = v.id
      JOIN position_holders h ON h.position_lineage_id = p.lineage_id
    WHERE h.user_id = app_uid() AND h.from_date <= app_firm_today() AND (h.to_date IS NULL OR h.to_date >= app_firm_today())
      AND p.reports_to_id IS NOT NULL
  )
  SELECT m.id, b.id, b.code, b.title_ar, b.title_en,
    CASE WHEN m.show_names OR app_role() = 'client_admin' THEN coalesce(h.name, u.name) END,
    h.id IS NULL
  FROM mine m JOIN positions b ON b.id = m.reports_to_id
    LEFT JOIN position_holders h ON h.position_lineage_id = b.lineage_id
      AND h.from_date <= app_firm_today() AND (h.to_date IS NULL OR h.to_date >= app_firm_today())
    LEFT JOIN "user" u ON u.id = h.user_id
  ORDER BY m.id, h.from_date
$$;
--> statement-breakpoint
-- 3. Starting, publishing, and the client admin's names switch. The app
--    writes org_charts and org_chart_versions only through these.

-- The firm's editors start a client's structure: the chart and its first draft. Once.
CREATE FUNCTION app_start_org_chart(org uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE cid uuid;
BEGIN
  IF NOT app_org_chart_editor(org) THEN
    RAISE EXCEPTION 'no such client' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('org_chart_start'), hashtext(org::text));
  SELECT c.id INTO cid FROM org_charts c WHERE c.org_id = org;
  IF cid IS NOT NULL THEN
    RETURN cid;
  END IF;
  INSERT INTO org_charts (org_id, created_by) VALUES (org, app_uid()) RETURNING id INTO cid;
  INSERT INTO org_chart_versions (chart_id, org_id, state, created_by) VALUES (cid, org, 'draft', app_uid());
  RETURN cid;
END $$;
--> statement-breakpoint
-- The structure as published: units and positions, no names. Internal.
CREATE FUNCTION app_org_chart_snapshot_of(vid uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'format', 1,
    'units', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
          'id', u.id, 'parentId', u.parent_id, 'kind', u.kind, 'code', u.code, 'nameAr', u.name_ar, 'nameEn', u.name_en,
          'level', u.level, 'sortOrder', u.sort_order, 'advisory', u.advisory,
          'departmentId', u.department_id, 'departmentNameAr', d.name_ar, 'departmentNameEn', d.name_en)
        ORDER BY u.level, u.sort_order, u.code)
      FROM org_units u LEFT JOIN departments d ON d.id = u.department_id WHERE u.version_id = vid), '[]'::jsonb),
    'positions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
          'id', p.id, 'lineageId', p.lineage_id, 'unitId', p.unit_id, 'code', p.code, 'titleAr', p.title_ar, 'titleEn', p.title_en,
          'reportsToId', p.reports_to_id, 'isHead', p.is_head, 'specialties', to_jsonb(p.specialties),
          'plannedCount', p.planned_count, 'sortOrder', p.sort_order)
        ORDER BY p.sort_order, p.code)
      FROM positions p WHERE p.version_id = vid), '[]'::jsonb))
$$;
--> statement-breakpoint
-- Copy a version's units and positions into a new draft: new ids (derived
-- from the draft and the old id, so the second pass can find them), the same
-- lineages, the tree and the reporting lines rebuilt after every row exists.
-- A link to a department that is no longer active is left out. Internal.
CREATE FUNCTION app_org_chart_copy(src uuid, dst uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO org_units (id, version_id, org_id, parent_id, kind, code, name_ar, name_en, level, sort_order, advisory, department_id)
    SELECT md5(dst::text || u.id::text)::uuid, dst, u.org_id, NULL, u.kind, u.code, u.name_ar, u.name_en, u.level, u.sort_order, u.advisory,
      CASE WHEN d.active THEN u.department_id END
    FROM org_units u LEFT JOIN departments d ON d.id = u.department_id WHERE u.version_id = src;
  UPDATE org_units n SET parent_id = md5(dst::text || u.parent_id::text)::uuid
    FROM org_units u WHERE u.version_id = src AND u.parent_id IS NOT NULL AND n.id = md5(dst::text || u.id::text)::uuid;
  INSERT INTO positions (id, version_id, org_id, unit_id, lineage_id, code, title_ar, title_en, reports_to_id, is_head, specialties, planned_count, sort_order)
    SELECT md5(dst::text || p.id::text)::uuid, dst, p.org_id, md5(dst::text || p.unit_id::text)::uuid, p.lineage_id, p.code, p.title_ar, p.title_en,
      NULL, p.is_head, p.specialties, p.planned_count, p.sort_order
    FROM positions p WHERE p.version_id = src;
  UPDATE positions n SET reports_to_id = md5(dst::text || p.reports_to_id::text)::uuid
    FROM positions p WHERE p.version_id = src AND p.reports_to_id IS NOT NULL AND n.id = md5(dst::text || p.id::text)::uuid;
END $$;
--> statement-breakpoint
-- Publish the draft (the firm admin, the lead or the deputy), with the day it
-- takes effect and, optionally, the board resolution: a file of this client
-- that the client can see. The current version becomes history; the draft
-- becomes current, numbered, its structure frozen in the snapshot; the
-- client admin's names switch carries over (off for a first version);
-- whoever held a position the new structure no longer has stops holding it
-- today; and a fresh draft, a copy, is ready for the next change. Returns the
-- published version.
CREATE FUNCTION app_publish_org_chart(cid uuid, p_effective date, p_resolution uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c org_charts;
  d org_chart_versions;
  prev_names boolean;
  next_number integer;
  fresh uuid;
BEGIN
  SELECT * INTO c FROM org_charts WHERE id = cid;
  IF c.id IS NULL OR NOT app_org_chart_publisher(c.org_id) THEN
    RAISE EXCEPTION 'no such structure' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_effective IS NULL THEN
    RAISE EXCEPTION 'give the day the structure takes effect' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('org_chart'), hashtext(cid::text));
  SELECT * INTO d FROM org_chart_versions v WHERE v.chart_id = cid AND v.state = 'draft' FOR UPDATE;
  IF d.id IS NULL OR NOT EXISTS (SELECT 1 FROM org_units u WHERE u.version_id = d.id) THEN
    RAISE EXCEPTION 'the draft has no units yet' USING ERRCODE = 'check_violation';
  END IF;
  IF p_resolution IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM documents x WHERE x.id = p_resolution AND x.org_id = c.org_id AND x.visibility = 'shared' AND x.state <> 'archived') THEN
    RAISE EXCEPTION 'the resolution must be a file of this client that the client can see' USING ERRCODE = 'check_violation';
  END IF;
  SELECT v.show_names INTO prev_names FROM org_chart_versions v WHERE v.chart_id = cid AND v.state = 'published';
  UPDATE org_chart_versions SET state = 'superseded', superseded_at = now() WHERE chart_id = cid AND state = 'published';
  SELECT coalesce(max(v.number), 0) + 1 INTO next_number FROM org_chart_versions v WHERE v.chart_id = cid;
  UPDATE org_chart_versions SET state = 'published', number = next_number, effective_on = p_effective,
      published_by = app_uid(), published_at = now(), resolution_document_id = p_resolution,
      show_names = coalesce(prev_names, false), published_snapshot = app_org_chart_snapshot_of(d.id)
    WHERE id = d.id;
  UPDATE position_holders h SET to_date = greatest(h.from_date, app_firm_today())
    WHERE h.chart_id = cid AND h.to_date IS NULL
      AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.version_id = d.id AND p.lineage_id = h.position_lineage_id);
  INSERT INTO org_chart_versions (chart_id, org_id, state, based_on_id, created_by)
    VALUES (cid, c.org_id, 'draft', d.id, app_uid()) RETURNING id INTO fresh;
  PERFORM app_org_chart_copy(d.id, fresh);
  RETURN d.id;
END $$;
--> statement-breakpoint
-- The client admin's switch: whether the client's managers see names on a
-- published (or past) version at all.
CREATE FUNCTION app_set_org_chart_show_names(vid uuid, p_on boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v org_chart_versions;
BEGIN
  SELECT * INTO v FROM org_chart_versions WHERE id = vid;
  IF v.id IS NULL OR v.state = 'draft' OR app_org_kind() IS DISTINCT FROM 'client' OR app_role() IS DISTINCT FROM 'client_admin'
     OR v.org_id IS DISTINCT FROM app_org() THEN
    RAISE EXCEPTION 'no such version' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE org_chart_versions SET show_names = coalesce(p_on, false) WHERE id = vid;
END $$;
--> statement-breakpoint
-- 4. The rules on each table.

-- A version starts as a draft of its chart; once published, what was
-- published (number, day, publisher, resolution, snapshot) never changes and
-- it never goes back to a draft; history stays history and is never deleted.
-- Only the names switch moves afterwards. Jobs and a discarded client pass.
CREATE FUNCTION check_org_chart_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF app_uid() IS NOT NULL AND current_setting('selah.discard', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'a version of the structure is never deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' THEN
      RAISE EXCEPTION 'a version starts as a draft' USING ERRCODE = 'check_violation';
    END IF;
    NEW.org_id := (SELECT c.org_id FROM org_charts c WHERE c.id = NEW.chart_id);
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF app_uid() IS NULL OR current_setting('selah.discard', true) IS NOT DISTINCT FROM 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.chart_id <> OLD.chart_id OR NEW.org_id <> OLD.org_id OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'a version stays with its structure' USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.state = 'superseded' AND NEW.state <> 'superseded') OR (OLD.state = 'published' AND NEW.state = 'draft') THEN
    RAISE EXCEPTION 'a published version is never taken back; publish a new one' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state <> 'draft' AND (NEW.number, NEW.effective_on, NEW.published_by, NEW.published_at, NEW.resolution_document_id, NEW.published_snapshot)
     IS DISTINCT FROM (OLD.number, OLD.effective_on, OLD.published_by, OLD.published_at, OLD.resolution_document_id, OLD.published_snapshot) THEN
    RAISE EXCEPTION 'a published version never changes; change the draft and publish it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER org_chart_version_rules BEFORE INSERT OR UPDATE OR DELETE ON org_chart_versions FOR EACH ROW EXECUTE FUNCTION check_org_chart_version();
--> statement-breakpoint
-- A unit: in its version's client, changed only while its version is the
-- draft, under a unit of the same version, never under itself or one of its
-- own units (the tree has no cycle), and removed only once empty.
CREATE FUNCTION check_org_unit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  st org_chart_state;
  vorg uuid;
  loose boolean := app_uid() IS NULL OR current_setting('selah.discard', true) IS NOT DISTINCT FROM 'on';
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF loose THEN
      RETURN OLD;
    END IF;
    IF (SELECT v.state FROM org_chart_versions v WHERE v.id = OLD.version_id) IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'a published structure never changes; change the draft and publish it' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM org_units c WHERE c.parent_id = OLD.id) OR EXISTS (SELECT 1 FROM positions p WHERE p.unit_id = OLD.id) THEN
      RAISE EXCEPTION 'move or remove the units and positions inside this unit first' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  SELECT v.state, v.org_id INTO st, vorg FROM org_chart_versions v WHERE v.id = NEW.version_id;
  IF st IS NULL THEN
    RAISE EXCEPTION 'no such version of the structure' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.version_id <> OLD.version_id OR NEW.org_id <> OLD.org_id) THEN
    RAISE EXCEPTION 'a unit stays in its version' USING ERRCODE = 'check_violation';
  END IF;
  NEW.org_id := vorg;
  IF st <> 'draft' AND NOT loose THEN
    RAISE EXCEPTION 'a published structure never changes; change the draft and publish it' USING ERRCODE = 'check_violation';
  END IF;
  NEW.code := btrim(NEW.code);
  NEW.name_ar := nullif(btrim(NEW.name_ar), '');
  NEW.name_en := nullif(btrim(NEW.name_en), '');
  IF NEW.parent_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.parent_id IS DISTINCT FROM OLD.parent_id) THEN
    IF NOT EXISTS (SELECT 1 FROM org_units p WHERE p.id = NEW.parent_id AND p.version_id = NEW.version_id) THEN
      RAISE EXCEPTION 'a unit sits under a unit of the same structure' USING ERRCODE = 'check_violation';
    END IF;
    -- One change to the tree of a version at a time, so two moves can't make a loop together.
    PERFORM pg_advisory_xact_lock(hashtext('org_chart_tree'), hashtext(NEW.version_id::text));
    IF EXISTS (
      WITH RECURSIVE up (id) AS (
        SELECT NEW.parent_id
        UNION
        SELECT u.parent_id FROM org_units u JOIN up ON u.id = up.id WHERE u.parent_id IS NOT NULL
      ) SELECT 1 FROM up WHERE up.id = NEW.id) THEN
      RAISE EXCEPTION 'a unit cannot sit under itself or under one of its own units' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER org_unit_rules BEFORE INSERT OR UPDATE OR DELETE ON org_units FOR EACH ROW EXECUTE FUNCTION check_org_unit();
--> statement-breakpoint
-- The department a unit is linked to (a label only) is an active department
-- of the same client (the composite foreign key keeps the org).
CREATE TRIGGER row_department BEFORE INSERT OR UPDATE OF department_id ON org_units
  FOR EACH ROW EXECUTE FUNCTION check_row_department();
--> statement-breakpoint
-- A position: in a unit of the same version, changed only in the draft,
-- reporting to a position of the same version and never to itself through a
-- chain (no cycle). Its lineage is its own id, or a position of an earlier
-- version of the same structure that it carries on (the draft's copies).
-- Specialties are kept trimmed, without blanks or repeats. Removing one
-- leaves whoever reported to it reporting to no one, until the firm says.
CREATE FUNCTION check_position() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  st org_chart_state;
  vorg uuid;
  vchart uuid;
  loose boolean := app_uid() IS NULL OR current_setting('selah.discard', true) IS NOT DISTINCT FROM 'on';
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF loose THEN
      RETURN OLD;
    END IF;
    IF (SELECT v.state FROM org_chart_versions v WHERE v.id = OLD.version_id) IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'a published structure never changes; change the draft and publish it' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE positions SET reports_to_id = NULL WHERE reports_to_id = OLD.id;
    RETURN OLD;
  END IF;
  SELECT v.state, v.org_id, v.chart_id INTO st, vorg, vchart FROM org_chart_versions v WHERE v.id = NEW.version_id;
  IF st IS NULL THEN
    RAISE EXCEPTION 'no such version of the structure' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.version_id <> OLD.version_id OR NEW.org_id <> OLD.org_id OR NEW.lineage_id <> OLD.lineage_id) THEN
    RAISE EXCEPTION 'a position stays in its version' USING ERRCODE = 'check_violation';
  END IF;
  NEW.org_id := vorg;
  IF st <> 'draft' AND NOT loose THEN
    RAISE EXCEPTION 'a published structure never changes; change the draft and publish it' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.lineage_id IS NULL OR NEW.lineage_id = NEW.id THEN
      NEW.lineage_id := NEW.id;
    ELSIF NOT EXISTS (
      SELECT 1 FROM positions l JOIN org_chart_versions lv ON lv.id = l.version_id
      WHERE l.id = NEW.lineage_id AND l.lineage_id = l.id AND lv.chart_id = vchart) THEN
      RAISE EXCEPTION 'a position carries on only a position of the same structure' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.unit_id IS DISTINCT FROM OLD.unit_id)
     AND NOT EXISTS (SELECT 1 FROM org_units u WHERE u.id = NEW.unit_id AND u.version_id = NEW.version_id) THEN
    RAISE EXCEPTION 'a position sits in a unit of the same structure' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reports_to_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.reports_to_id IS DISTINCT FROM OLD.reports_to_id) THEN
    IF NOT EXISTS (SELECT 1 FROM positions p WHERE p.id = NEW.reports_to_id AND p.version_id = NEW.version_id) THEN
      RAISE EXCEPTION 'a position reports to a position of the same structure' USING ERRCODE = 'check_violation';
    END IF;
    -- One change to the reporting lines of a version at a time, so two changes can't make a loop together.
    PERFORM pg_advisory_xact_lock(hashtext('org_chart_lines'), hashtext(NEW.version_id::text));
    IF EXISTS (
      WITH RECURSIVE up (id) AS (
        SELECT NEW.reports_to_id
        UNION
        SELECT p.reports_to_id FROM positions p JOIN up ON p.id = up.id WHERE p.reports_to_id IS NOT NULL
      ) SELECT 1 FROM up WHERE up.id = NEW.id) THEN
      RAISE EXCEPTION 'a position cannot report to itself, even through others' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.code := btrim(NEW.code);
  NEW.title_ar := nullif(btrim(NEW.title_ar), '');
  NEW.title_en := nullif(btrim(NEW.title_en), '');
  NEW.specialties := ARRAY(
    SELECT y.t FROM (
      SELECT btrim(x.s) AS t, min(x.o) AS o FROM unnest(NEW.specialties) WITH ORDINALITY AS x(s, o)
      WHERE btrim(x.s) <> '' GROUP BY btrim(x.s)
    ) y ORDER BY y.o);
  IF EXISTS (SELECT 1 FROM unnest(NEW.specialties) s WHERE char_length(s) > 100) THEN
    RAISE EXCEPTION 'a specialty is at most 100 characters' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER position_rules BEFORE INSERT OR UPDATE OR DELETE ON positions FOR EACH ROW EXECUTE FUNCTION check_position();
--> statement-breakpoint
-- A holding: a position of the structure (its lineage), and either an active
-- person of the same client or a typed name; never at a minimal-records
-- client (titles only, no names). The client's admin places people only in
-- positions of the published structure; the firm's editors also in the
-- draft's. One person holds a position once at a time. Afterwards a holding
-- only ends, once, on or after the day it started: who held what stays on
-- record. The database records who added and who ended it.
CREATE FUNCTION check_position_holder() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  lchart uuid;
  lorg uuid;
  in_current boolean;
  in_draft boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - '{to_date,ended_by,ended_at}'::text[]) <> (to_jsonb(OLD) - '{to_date,ended_by,ended_at}'::text[]) THEN
      RAISE EXCEPTION 'a holding only ends; to change who holds the position, end this holding and add the next'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.to_date IS NOT DISTINCT FROM OLD.to_date THEN
      RETURN NEW;
    END IF;
    IF OLD.to_date IS NOT NULL OR NEW.to_date IS NULL THEN
      RAISE EXCEPTION 'this holding has already ended' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.to_date < OLD.from_date THEN
      RAISE EXCEPTION 'a holding ends on or after the day it started' USING ERRCODE = 'check_violation';
    END IF;
    NEW.ended_by := coalesce(app_uid(), NEW.ended_by);
    NEW.ended_at := now();
    RETURN NEW;
  END IF;

  SELECT v.chart_id, v.org_id INTO lchart, lorg
  FROM positions p JOIN org_chart_versions v ON v.id = p.version_id
  WHERE p.id = NEW.position_lineage_id AND p.lineage_id = p.id;
  IF lchart IS NULL THEN
    RAISE EXCEPTION 'no such position' USING ERRCODE = 'check_violation';
  END IF;
  NEW.chart_id := lchart;
  NEW.org_id := lorg;
  IF coalesce((SELECT o.minimal_records FROM organizations o WHERE o.id = lorg), false) THEN
    RAISE EXCEPTION 'this client keeps minimal records: its structure has titles only, no names' USING ERRCODE = 'check_violation';
  END IF;
  NEW.name := nullif(btrim(NEW.name), '');
  IF NEW.user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM org_memberships m WHERE m.user_id = NEW.user_id AND m.org_id = lorg AND m.active) THEN
    RAISE EXCEPTION 'a holder is one of the client''s own active people, or a typed name' USING ERRCODE = 'check_violation';
  END IF;
  IF app_uid() IS NOT NULL THEN
    in_current := EXISTS (
      SELECT 1 FROM positions p JOIN org_chart_versions v ON v.id = p.version_id
      WHERE p.lineage_id = NEW.position_lineage_id AND v.chart_id = lchart AND v.state = 'published');
    in_draft := EXISTS (
      SELECT 1 FROM positions p JOIN org_chart_versions v ON v.id = p.version_id
      WHERE p.lineage_id = NEW.position_lineage_id AND v.chart_id = lchart AND v.state = 'draft');
    IF NOT (in_current OR (in_draft AND app_org_chart_editor(lorg))) THEN
      RAISE EXCEPTION 'people are placed in positions of the published structure' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_by := app_uid();
  END IF;
  NEW.created_at := now();
  IF NEW.to_date IS NULL THEN
    NEW.ended_by := NULL;
    NEW.ended_at := NULL;
  ELSE
    NEW.ended_by := NEW.created_by;
    NEW.ended_at := now();
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('position_holder'), hashtext(NEW.position_lineage_id::text));
  IF EXISTS (
    SELECT 1 FROM position_holders h
    WHERE h.position_lineage_id = NEW.position_lineage_id
      AND (h.user_id = NEW.user_id OR lower(h.name) = lower(NEW.name))
      AND daterange(h.from_date, h.to_date, '[]') && daterange(NEW.from_date, NEW.to_date, '[]')) THEN
    RAISE EXCEPTION 'this person already holds the position on some of those days' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER position_holder_rules BEFORE INSERT OR UPDATE ON position_holders FOR EACH ROW EXECUTE FUNCTION check_position_holder();
--> statement-breakpoint
-- A change of who holds a position on the published structure tells the
-- client's lead and deputy (not the person who made it), in Selah and by
-- work mail: one unread notice per client at a time, and at most one mail a
-- firm day. Neither carries the name.
CREATE FUNCTION notify_position_holder() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_uid() IS NULL OR (TG_OP = 'UPDATE' AND NEW.to_date IS NOT DISTINCT FROM OLD.to_date) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM positions p JOIN org_chart_versions v ON v.id = p.version_id
    WHERE p.lineage_id = NEW.position_lineage_id AND v.chart_id = NEW.chart_id AND v.state = 'published') THEN
    RETURN NULL;
  END IF;
  WITH told AS (
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT ca.user_id, 'org_chart.holder_changed', 'organization', NEW.org_id
      FROM client_assignments ca JOIN org_memberships m ON m.user_id = ca.user_id AND m.active
      WHERE ca.client_org_id = NEW.org_id AND (ca.is_lead OR ca.is_deputy) AND ca.user_id <> app_uid()
        AND NOT EXISTS (
          SELECT 1 FROM notifications x
          WHERE x.user_id = ca.user_id AND x.kind = 'org_chart.holder_changed' AND x.entity_id = NEW.org_id AND x.read_at IS NULL)
    RETURNING user_id
  )
  INSERT INTO outbound_emails (to_email, kind, link)
    SELECT u.email, 'org_chart.holder_changed', '/clients/' || NEW.org_id FROM told t JOIN "user" u ON u.id = t.user_id
    WHERE app_can_reset_password(t.user_id)
      AND NOT EXISTS (
        SELECT 1 FROM outbound_emails o
        WHERE o.kind = 'org_chart.holder_changed' AND lower(o.to_email) = lower(u.email) AND app_firm_date(o.created_at) = app_firm_today());
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER position_holder_notify AFTER INSERT OR UPDATE OF to_date ON position_holders FOR EACH ROW EXECUTE FUNCTION notify_position_holder();
--> statement-breakpoint
-- "Suggest a change": written by the client's admin, in their own name, with
-- what (required), where and why; it starts open. Afterwards the firm only
-- marks it done or declined, once, and the database records who and when.
CREATE FUNCTION check_org_chart_change_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE corg uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT c.org_id INTO corg FROM org_charts c WHERE c.id = NEW.chart_id;
    IF corg IS NULL THEN
      RAISE EXCEPTION 'no such structure' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.org_id := corg;
    IF app_uid() IS NOT NULL THEN
      IF NOT coalesce(app_org_kind() = 'client' AND app_role() = 'client_admin' AND app_org() = corg, false) THEN
        RAISE EXCEPTION 'the client''s admin suggests changes to its structure' USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.created_by := app_uid();
    END IF;
    NEW.what := btrim(NEW.what);
    NEW.where_text := nullif(btrim(NEW.where_text), '');
    NEW.why := nullif(btrim(NEW.why), '');
    NEW.status := 'open';
    NEW.closed_by := NULL;
    NEW.closed_at := NULL;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - '{status,closed_by,closed_at}'::text[]) <> (to_jsonb(OLD) - '{status,closed_by,closed_at}'::text[]) THEN
    RAISE EXCEPTION 'a suggestion is only marked done or declined' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = OLD.status AND NEW.closed_by IS NOT DISTINCT FROM OLD.closed_by AND NEW.closed_at IS NOT DISTINCT FROM OLD.closed_at THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'open' OR NEW.status = 'open' THEN
    RAISE EXCEPTION 'this suggestion is already answered' USING ERRCODE = 'check_violation';
  END IF;
  NEW.closed_by := coalesce(app_uid(), NEW.closed_by);
  NEW.closed_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER org_chart_change_request_rules BEFORE INSERT OR UPDATE ON org_chart_change_requests
  FOR EACH ROW EXECUTE FUNCTION check_org_chart_change_request();
--> statement-breakpoint
-- A suggestion reaches the client's lead and deputy, in Selah and by work
-- mail, without its text (read in Selah).
CREATE FUNCTION notify_org_chart_change_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  WITH told AS (
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT ca.user_id, 'org_chart.change_requested', 'organization', NEW.org_id
      FROM client_assignments ca JOIN org_memberships m ON m.user_id = ca.user_id AND m.active
      WHERE ca.client_org_id = NEW.org_id AND (ca.is_lead OR ca.is_deputy)
    RETURNING user_id
  )
  INSERT INTO outbound_emails (to_email, kind, link)
    SELECT u.email, 'org_chart.change_requested', '/clients/' || NEW.org_id FROM told t JOIN "user" u ON u.id = t.user_id
    WHERE app_can_reset_password(t.user_id);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER org_chart_change_request_notify AFTER INSERT ON org_chart_change_requests
  FOR EACH ROW EXECUTE FUNCTION notify_org_chart_change_request();
--> statement-breakpoint
-- Minimal records (latest definition: 0009_prospects). The switch is
-- refused, like for contacts and files, while the client's structure holds
-- the name of anyone, now or in the past: nothing is deleted to make way for
-- it (the product owner is asked before anything deletes data). Unchanged
-- otherwise.
CREATE OR REPLACE FUNCTION check_minimal_records() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE switched boolean := CASE WHEN TG_OP = 'INSERT' THEN NEW.minimal_records OR NEW.display_alias IS NOT NULL
  ELSE NEW.minimal_records IS DISTINCT FROM OLD.minimal_records OR NEW.display_alias IS DISTINCT FROM OLD.display_alias END;
BEGIN
  IF switched AND app_uid() IS NOT NULL AND app_role() IS DISTINCT FROM 'firm_admin' THEN
    RAISE EXCEPTION 'only the firm admin sets minimal records' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT NEW.minimal_records THEN
    RETURN NEW;
  END IF;
  IF NEW.engagement_mode IS DISTINCT FROM 'consultant_managed' THEN
    RAISE EXCEPTION 'minimal records are for clients the firm manages' USING ERRCODE = 'check_violation';
  END IF;
  IF nullif(trim(NEW.display_alias), '') IS NULL THEN
    RAISE EXCEPTION 'give the client an alias' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' OR NOT OLD.minimal_records THEN
    IF EXISTS (SELECT 1 FROM client_contacts c WHERE c.org_id = NEW.id) OR EXISTS (SELECT 1 FROM documents d WHERE d.org_id = NEW.id) THEN
      RAISE EXCEPTION 'remove the client''s contacts and files before switching to minimal records' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM position_holders h WHERE h.org_id = NEW.id) THEN
      RAISE EXCEPTION 'remove the names of people from the client''s structure before switching to minimal records' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.display_alias := trim(NEW.display_alias);
  NEW.name := NEW.display_alias;
  NEW.name_ar := NEW.display_alias;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- An archived client's structure freezes with the rest of its client-level
-- records (lib/offboarding.ts CLIENT_FROZEN_TABLES).
CREATE TRIGGER client_open BEFORE INSERT OR UPDATE OR DELETE ON org_charts FOR EACH ROW EXECUTE FUNCTION check_client_open();
--> statement-breakpoint
CREATE TRIGGER client_open BEFORE INSERT OR UPDATE OR DELETE ON org_chart_versions FOR EACH ROW EXECUTE FUNCTION check_client_open();
--> statement-breakpoint
CREATE TRIGGER client_open BEFORE INSERT OR UPDATE OR DELETE ON org_units FOR EACH ROW EXECUTE FUNCTION check_client_open();
--> statement-breakpoint
CREATE TRIGGER client_open BEFORE INSERT OR UPDATE OR DELETE ON positions FOR EACH ROW EXECUTE FUNCTION check_client_open();
--> statement-breakpoint
CREATE TRIGGER client_open BEFORE INSERT OR UPDATE OR DELETE ON position_holders FOR EACH ROW EXECUTE FUNCTION check_client_open();
--> statement-breakpoint
CREATE TRIGGER client_open BEFORE INSERT OR UPDATE OR DELETE ON org_chart_change_requests FOR EACH ROW EXECUTE FUNCTION check_client_open();
--> statement-breakpoint
-- 5. Grants and row-level security. The app reads the chart and its versions
--    and writes them only through the functions above; it writes units and
--    positions (the firm's editors, in the draft), holders (the firm's editors
--    and the client's admin) and suggestions (the client's admin). It never
--    deletes a holding or a suggestion.
GRANT SELECT ON org_charts, org_chart_versions TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON org_units, positions TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON position_holders, org_chart_change_requests TO selah_app;
--> statement-breakpoint
ALTER TABLE org_charts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE org_chart_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE org_units ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE position_holders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE org_chart_change_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY scoped_read ON org_charts FOR SELECT TO selah_app USING (app_org_chart_readable(org_id));
--> statement-breakpoint
CREATE POLICY scoped_read ON org_chart_versions FOR SELECT TO selah_app
  USING (CASE WHEN state = 'draft' THEN app_org_chart_firm_reader(org_id) ELSE app_org_chart_readable(org_id) END);
--> statement-breakpoint
CREATE POLICY scoped_read ON org_units FOR SELECT TO selah_app USING (app_org_chart_version_readable(version_id));
--> statement-breakpoint
CREATE POLICY editor_insert ON org_units FOR INSERT TO selah_app WITH CHECK (app_org_chart_editor(org_id));
--> statement-breakpoint
CREATE POLICY editor_update ON org_units FOR UPDATE TO selah_app USING (app_org_chart_editor(org_id)) WITH CHECK (app_org_chart_editor(org_id));
--> statement-breakpoint
CREATE POLICY editor_delete ON org_units FOR DELETE TO selah_app USING (app_org_chart_editor(org_id));
--> statement-breakpoint
CREATE POLICY scoped_read ON positions FOR SELECT TO selah_app USING (app_org_chart_version_readable(version_id));
--> statement-breakpoint
CREATE POLICY editor_insert ON positions FOR INSERT TO selah_app WITH CHECK (app_org_chart_editor(org_id));
--> statement-breakpoint
CREATE POLICY editor_update ON positions FOR UPDATE TO selah_app USING (app_org_chart_editor(org_id)) WITH CHECK (app_org_chart_editor(org_id));
--> statement-breakpoint
CREATE POLICY editor_delete ON positions FOR DELETE TO selah_app USING (app_org_chart_editor(org_id));
--> statement-breakpoint
-- The raw holdings, names included: the firm's readers, and the client's
-- admin for positions of the published structure or its history. A client
-- manager reads names only through app_org_chart_holders(), which applies
-- her branch and the names switch; an action owner reads none.
CREATE POLICY full_read ON position_holders FOR SELECT TO selah_app USING (
  app_org_chart_firm_reader(org_id)
  OR (app_org_kind() = 'client' AND app_role() = 'client_admin' AND org_id = app_org() AND app_org_chart_lineage_published(position_lineage_id))
);
--> statement-breakpoint
CREATE POLICY writer_insert ON position_holders FOR INSERT TO selah_app WITH CHECK (app_org_chart_holder_writer(org_id));
--> statement-breakpoint
CREATE POLICY writer_update ON position_holders FOR UPDATE TO selah_app
  USING (app_org_chart_holder_writer(org_id)) WITH CHECK (app_org_chart_holder_writer(org_id));
--> statement-breakpoint
CREATE POLICY scoped_read ON org_chart_change_requests FOR SELECT TO selah_app USING (
  app_org_chart_firm_reader(org_id) OR (app_org_kind() = 'client' AND app_role() = 'client_admin' AND org_id = app_org())
);
--> statement-breakpoint
CREATE POLICY admin_insert ON org_chart_change_requests FOR INSERT TO selah_app
  WITH CHECK (app_org_kind() = 'client' AND app_role() = 'client_admin' AND org_id = app_org());
--> statement-breakpoint
CREATE POLICY editor_update ON org_chart_change_requests FOR UPDATE TO selah_app
  USING (app_org_chart_editor(org_id)) WITH CHECK (app_org_chart_editor(org_id));
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_org_chart_firm_reader(uuid), app_org_chart_editor(uuid), app_org_chart_publisher(uuid), app_org_chart_readable(uuid),
  app_org_chart_version_readable(uuid), app_org_chart_holder_writer(uuid), app_org_chart_lineage_published(uuid), app_org_chart_branch(uuid, uuid),
  app_org_chart_named_positions(uuid), app_org_chart_holders(uuid, date), app_my_manager(), app_start_org_chart(uuid),
  app_org_chart_snapshot_of(uuid), app_org_chart_copy(uuid, uuid), app_publish_org_chart(uuid, date, uuid),
  app_set_org_chart_show_names(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_org_chart_firm_reader(uuid), app_org_chart_editor(uuid), app_org_chart_publisher(uuid), app_org_chart_readable(uuid),
  app_org_chart_version_readable(uuid), app_org_chart_holder_writer(uuid), app_org_chart_lineage_published(uuid),
  app_org_chart_named_positions(uuid), app_org_chart_holders(uuid, date), app_my_manager(), app_start_org_chart(uuid),
  app_publish_org_chart(uuid, date, uuid), app_set_org_chart_show_names(uuid, boolean) TO selah_app;
--> statement-breakpoint
-- 6. Mail: a holder change and a suggestion are work mail to the lead and
--    deputy (lib/mail-templates.ts MAIL_KINDS, lib/mail-choices.ts WORK_MAIL_KINDS).
ALTER TABLE outbound_emails DROP CONSTRAINT outbound_kind;
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_kind CHECK (kind IN (
  'invitation', 'email_change.confirm', 'email_change.notice', 'access_review.due',
  'meeting.invite', 'meeting.cancel', 'password_reset', 'password_reset.notice', 'two_factor.reset',
  'inquiry.new', 'inquiry.received', 'inquiry.declined', 'action.assigned', 'action.revision_requested',
  'action.verified_complete', 'evidence.requested', 'action.commented', 'action.mentioned', 'follow_up.digest', 'client.archived',
  'pulse.requested', 'sign_in_link', 'info_request.upload_link', 'support.requested',
  'org_chart.holder_changed', 'org_chart.change_requested'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_work_mail_kinds() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT app_update_mail_kinds() || ARRAY['follow_up.digest', 'access_review.due', 'inquiry.new', 'pulse.requested', 'support.requested',
    'org_chart.holder_changed', 'org_chart.change_requested']
$$;
--> statement-breakpoint
-- 7. Masking: the typed names of people in the client's structure are masked
--    before a hosted model sees them, like contacts and action owners without
--    an account (people with accounts already are, through their
--    memberships). The project's names (latest definition: app_mask_names in
--    0089_mask_terms_in_text) gain them; app_mask_terms() and
--    app_mask_terms_in() read that list and are unchanged.
CREATE OR REPLACE FUNCTION app_mask_names(pid uuid) RETURNS TABLE (kind text, term text, entity text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH p AS (
    SELECT x.org_id, x.firm_org_id FROM projects x
    WHERE x.id = pid AND (session_user <> 'selah_app' OR app_can_see_project(pid))
  ), orgs AS (
    SELECT o.id, o.name, o.name_ar, o.display_alias, o.short_names FROM organizations o, p WHERE o.id IN (p.org_id, p.firm_org_id)
    UNION
    SELECT o.id, o.name, o.name_ar, o.display_alias, o.short_names FROM organizations o, p
    WHERE o.kind = 'client'
      AND (session_user <> 'selah_app' OR app_org() = p.firm_org_id)
      AND EXISTS (SELECT 1 FROM projects y WHERE y.org_id = o.id AND y.firm_org_id = p.firm_org_id)
  ), terms AS (
    SELECT 'ORG'::text AS kind, unnest(ARRAY[o.name, o.name_ar, o.display_alias] || o.short_names) AS term, 'org:' || o.id AS entity
      FROM orgs o
    UNION
    SELECT 'PERSON', unnest(ARRAY[u.name, u.name_alt]), 'user:' || u.id FROM "user" u JOIN org_memberships m ON m.user_id = u.id, p
      WHERE m.org_id IN (p.org_id, p.firm_org_id)
    UNION
    SELECT 'PERSON', unnest(ARRAY[c.name, c.name_alt]), 'contact:' || c.id FROM client_contacts c, p WHERE c.org_id = p.org_id
    UNION
    SELECT 'DEPT', unnest(ARRAY[d.name_ar, d.name_en]), 'dept:' || d.id FROM departments d, p WHERE d.org_id = p.org_id
    UNION
    -- Client people with no account, named as an action's owner ("ماجد الواحي (مدير المكتب)"): the name without the role.
    SELECT 'PERSON', n, 'owner:' || md5(n) FROM (
      SELECT DISTINCT btrim(regexp_replace(a.owner_name, '\s*\(.*\)\s*$', '')) AS n FROM actions a WHERE a.project_id = pid AND a.owner_name IS NOT NULL
    ) o
    UNION
    -- People typed into a position of the client's structure (org chart, migration 0100), current or past.
    SELECT 'PERSON', h.name, 'holder:' || md5(lower(btrim(h.name))) FROM position_holders h, p WHERE h.org_id = p.org_id AND h.name IS NOT NULL
  )
  SELECT DISTINCT t.kind, btrim(t.term), t.entity FROM terms t WHERE t.term IS NOT NULL AND length(btrim(t.term)) >= 2
$$;
