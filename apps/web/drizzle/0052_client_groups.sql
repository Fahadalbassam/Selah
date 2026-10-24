CREATE TABLE "client_group_members" (
	"client_org_id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_org_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "is_company" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "client_group_members" ADD CONSTRAINT "client_group_members_client_org_id_organizations_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_group_members" ADD CONSTRAINT "client_group_members_group_id_client_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."client_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_group_members" ADD CONSTRAINT "client_group_members_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_groups" ADD CONSTRAINT "client_groups_firm_org_id_organizations_id_fk" FOREIGN KEY ("firm_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_groups" ADD CONSTRAINT "client_groups_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_group_members_group_idx" ON "client_group_members" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_groups_name_uq" ON "client_groups" USING btree ("firm_org_id","name_ar");--> statement-breakpoint
-- ------------------------------------------------- client groups (F34)
-- A holding group (decision D4) is a record of its own, kept by the firm
-- admin. Each member company is either its own linked client (a row in
-- client_group_members: its data stays apart, as for a listed subsidiary)
-- or a unit inside one member client (departments.is_company: it shares that
-- client's people and files, and its numbers roll up into the client's). The
-- client stays the tenant boundary: a group pools counts and opens nothing.
--
-- The firm admin sees and keeps every group. A consultant sees a group only
-- while assigned to one of its member clients, and sees only those members.
-- The client side never reads these tables.
CREATE FUNCTION app_sees_client_group(grp uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM client_groups g
    WHERE g.id = grp AND g.firm_org_id = app_org() AND app_org_kind() = 'firm' AND (
      app_role() = 'firm_admin'
      OR EXISTS (SELECT 1 FROM client_group_members m WHERE m.group_id = g.id AND app_firm_works_with(m.client_org_id))
    )
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_sees_client_group(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_sees_client_group(uuid) TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON client_groups TO selah_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON client_group_members TO selah_app;
--> statement-breakpoint
ALTER TABLE client_groups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_group_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY firm_read ON client_groups FOR SELECT TO selah_app USING (app_sees_client_group(id));
--> statement-breakpoint
CREATE POLICY admin_insert ON client_groups FOR INSERT TO selah_app
  WITH CHECK (app_role() = 'firm_admin' AND app_org_kind() = 'firm' AND firm_org_id = app_org());
--> statement-breakpoint
CREATE POLICY admin_update ON client_groups FOR UPDATE TO selah_app
  USING (app_role() = 'firm_admin' AND firm_org_id = app_org())
  WITH CHECK (app_role() = 'firm_admin' AND firm_org_id = app_org());
--> statement-breakpoint
CREATE POLICY admin_delete ON client_groups FOR DELETE TO selah_app
  USING (app_role() = 'firm_admin' AND firm_org_id = app_org());
--> statement-breakpoint
CREATE POLICY firm_read ON client_group_members FOR SELECT TO selah_app USING (app_firm_works_with(client_org_id));
--> statement-breakpoint
CREATE POLICY admin_insert ON client_group_members FOR INSERT TO selah_app
  WITH CHECK (app_role() = 'firm_admin' AND app_firm_works_with(client_org_id)
    AND EXISTS (SELECT 1 FROM client_groups g WHERE g.id = group_id AND g.firm_org_id = app_org()));
--> statement-breakpoint
CREATE POLICY admin_delete ON client_group_members FOR DELETE TO selah_app
  USING (app_role() = 'firm_admin' AND app_firm_works_with(client_org_id));
--> statement-breakpoint
-- Who made the group; it stays with its firm.
CREATE FUNCTION check_client_group() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := app_uid();
  ELSIF NEW.firm_org_id <> OLD.firm_org_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'a group keeps its firm and its creator' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER client_group_rules BEFORE INSERT OR UPDATE ON client_groups FOR EACH ROW EXECUTE FUNCTION check_client_group();
--> statement-breakpoint
-- A member is a client (the primary key keeps it in one group at most).
CREATE FUNCTION check_client_group_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = NEW.client_org_id AND o.kind = 'client') THEN
    RAISE EXCEPTION 'a group''s members are clients' USING ERRCODE = 'check_violation';
  END IF;
  NEW.added_by := app_uid();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER client_group_member_rules BEFORE INSERT ON client_group_members
  FOR EACH ROW EXECUTE FUNCTION check_client_group_member();
--> statement-breakpoint
-- A client that leaves its group turns its companies back into plain departments.
CREATE FUNCTION client_left_group() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE departments SET is_company = false WHERE org_id = OLD.client_org_id AND is_company;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER client_left_group AFTER DELETE ON client_group_members FOR EACH ROW EXECUTE FUNCTION client_left_group();
--> statement-breakpoint
-- A unit inside a client is marked by the firm admin, and only while the
-- client is in a group. The client's admin keeps naming its departments.
CREATE FUNCTION check_department_company() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.is_company = (TG_OP = 'UPDATE' AND OLD.is_company) THEN
    RETURN NEW;
  END IF;
  -- Leaving the group clears the mark (client_left_group()).
  IF NOT NEW.is_company AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF NOT coalesce(app_role() = 'firm_admin', false) THEN
    RAISE EXCEPTION 'only the firm admin marks a member company' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.is_company AND NOT EXISTS (SELECT 1 FROM client_group_members m WHERE m.client_org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'add the client to a group first' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER department_company BEFORE INSERT OR UPDATE OF is_company ON departments
  FOR EACH ROW EXECUTE FUNCTION check_department_company();