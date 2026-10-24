CREATE TABLE "client_group_viewers" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_group_viewers_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "client_group_members" ADD COLUMN "is_holding" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "client_group_viewers" ADD CONSTRAINT "client_group_viewers_group_id_client_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."client_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_group_viewers" ADD CONSTRAINT "client_group_viewers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_group_viewers" ADD CONSTRAINT "client_group_viewers_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_group_viewers_user_idx" ON "client_group_viewers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_group_members_one_holding" ON "client_group_members" USING btree ("group_id") WHERE "client_group_members"."is_holding";--> statement-breakpoint
-- ------------------------------------------ the group's viewers (F34 part 2)
-- The firm admin names the group's holding (one member client) and grants
-- named people of the holding, its admins or managers, the group's roll-up:
-- the pooled counts per member company and nothing to open. A linked
-- client's own records stay behind its own row-level security, and the
-- people of every other member never see the group or their siblings.
GRANT UPDATE (is_holding) ON client_group_members TO selah_app;
--> statement-breakpoint
CREATE POLICY admin_update ON client_group_members FOR UPDATE TO selah_app
  USING (app_role() = 'firm_admin' AND app_firm_works_with(client_org_id))
  WITH CHECK (app_role() = 'firm_admin' AND app_firm_works_with(client_org_id));
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON client_group_viewers TO selah_app;
--> statement-breakpoint
ALTER TABLE client_group_viewers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The viewer sees their own grant; firm staff see the grants of a group
-- they see, for a holding they work with.
CREATE POLICY scoped_read ON client_group_viewers FOR SELECT TO selah_app USING (
  user_id = app_uid()
  OR (app_sees_client_group(group_id) AND app_firm_works_with(app_user_org(user_id)))
);
--> statement-breakpoint
CREATE POLICY admin_insert ON client_group_viewers FOR INSERT TO selah_app
  WITH CHECK (app_role() = 'firm_admin' AND app_sees_client_group(group_id));
--> statement-breakpoint
CREATE POLICY admin_delete ON client_group_viewers FOR DELETE TO selah_app
  USING (app_role() = 'firm_admin' AND app_sees_client_group(group_id));
--> statement-breakpoint
-- A viewer is an active admin or manager of the group's holding.
CREATE FUNCTION check_client_group_viewer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM client_group_members h
    JOIN org_memberships m ON m.org_id = h.client_org_id AND m.user_id = NEW.user_id AND m.active
    WHERE h.group_id = NEW.group_id AND h.is_holding AND m.role IN ('client_admin', 'client_manager')
  ) THEN
    RAISE EXCEPTION 'a group''s viewers are admins or managers of its holding' USING ERRCODE = 'check_violation';
  END IF;
  NEW.granted_by := app_uid();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER client_group_viewer_rules BEFORE INSERT ON client_group_viewers
  FOR EACH ROW EXECUTE FUNCTION check_client_group_viewer();
--> statement-breakpoint
-- When the holding changes or leaves the group, its people's grants end.
CREATE FUNCTION viewers_follow_holding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.is_holding AND (TG_OP = 'DELETE' OR NOT NEW.is_holding) THEN
    DELETE FROM client_group_viewers v
    WHERE v.group_id = OLD.group_id
      AND EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = v.user_id AND m.org_id = OLD.client_org_id);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER viewers_follow_holding AFTER UPDATE OF is_holding OR DELETE ON client_group_members
  FOR EACH ROW EXECUTE FUNCTION viewers_follow_holding();
--> statement-breakpoint
-- Is the caller a viewer of this group: granted, still an active admin or
-- manager, of the client that is still its holding.
CREATE FUNCTION app_is_group_viewer(grp uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_org_kind() = 'client' AND app_role() IN ('client_admin', 'client_manager') AND EXISTS (
    SELECT 1 FROM client_group_viewers v
    JOIN client_group_members h ON h.group_id = v.group_id AND h.is_holding
    WHERE v.group_id = grp AND v.user_id = app_uid() AND h.client_org_id = app_org()
  )
$$;
--> statement-breakpoint
-- The groups the caller may view, by name only (never the firm's notes).
CREATE FUNCTION app_my_client_groups()
RETURNS TABLE (id uuid, name_ar text, name_en text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT g.id, g.name_ar, g.name_en FROM client_groups g
  WHERE EXISTS (SELECT 1 FROM client_group_viewers v WHERE v.group_id = g.id AND v.user_id = app_uid()) AND app_is_group_viewer(g.id)
  ORDER BY g.name_ar
$$;
--> statement-breakpoint
-- The roll-up a viewer reads: one row per active member client (its work
-- outside its companies) and one per company inside a client, with the same
-- counts as app_client_progress. It counts only what the firm and the
-- client both see: released actions, on projects past draft, under shared
-- recommendations. Never a record, a title or a person: counts only.
CREATE FUNCTION app_client_group_rollup(grp uuid, today date)
RETURNS TABLE (
  client_org_id uuid, client_name text, client_name_ar text, department_id uuid, unit_name_ar text, unit_name_en text,
  total integer, verified integer, partially integer, risk_accepted integer, not_applicable integer,
  superseded integer, open integer, overdue integer, awaiting_review integer, blocked integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH members AS (
    SELECT o.id, o.name, o.name_ar FROM client_group_members m JOIN organizations o ON o.id = m.client_org_id
    WHERE m.group_id = grp AND o.status = 'active' AND app_is_group_viewer(grp)
  ),
  keys AS (
    SELECT mm.id AS org_id, NULL::uuid AS unit FROM members mm
    UNION ALL
    SELECT d.org_id, d.id FROM departments d JOIN members mm ON mm.id = d.org_id WHERE d.is_company
  ),
  a AS (
    SELECT a.org_id, CASE WHEN d.is_company THEN a.department_id END AS unit, a.status, a.closure_outcome, a.due_date
    FROM actions a
    JOIN members mm ON mm.id = a.org_id
    JOIN projects p ON p.id = a.project_id AND p.kind = 'client' AND p.state::text <> 'draft'
    JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
    LEFT JOIN departments d ON d.id = a.department_id
    WHERE a.status <> 'draft'
  )
  SELECT k.org_id, mm.name, mm.name_ar, k.unit, d.name_ar, d.name_en,
    count(a.org_id)::int,
    count(a.org_id) FILTER (WHERE a.status = 'verified_complete')::int,
    count(a.org_id) FILTER (WHERE a.closure_outcome = 'partially_implemented')::int,
    count(a.org_id) FILTER (WHERE a.closure_outcome = 'risk_accepted')::int,
    count(a.org_id) FILTER (WHERE a.closure_outcome = 'not_applicable')::int,
    count(a.org_id) FILTER (WHERE a.closure_outcome = 'superseded')::int,
    count(a.org_id) FILTER (WHERE a.closure_outcome IS NULL AND a.status <> 'verified_complete')::int,
    count(a.org_id) FILTER (WHERE a.closure_outcome IS NULL AND a.status <> 'verified_complete' AND a.due_date < today)::int,
    count(a.org_id) FILTER (WHERE a.status = 'awaiting_review')::int,
    count(a.org_id) FILTER (WHERE a.status = 'blocked')::int
  FROM keys k
  JOIN members mm ON mm.id = k.org_id
  LEFT JOIN departments d ON d.id = k.unit
  LEFT JOIN a ON a.org_id = k.org_id AND a.unit IS NOT DISTINCT FROM k.unit
  GROUP BY k.org_id, mm.name, mm.name_ar, k.unit, d.name_ar, d.name_en
  ORDER BY mm.name, k.unit NULLS LAST
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_is_group_viewer(uuid), app_my_client_groups(), app_client_group_rollup(uuid, date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_is_group_viewer(uuid), app_my_client_groups(), app_client_group_rollup(uuid, date) TO selah_app;