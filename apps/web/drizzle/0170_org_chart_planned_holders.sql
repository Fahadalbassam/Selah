CREATE TABLE "org_chart_planned_holders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_chart_planned_holder_who" CHECK (num_nonnulls("org_chart_planned_holders"."user_id", "org_chart_planned_holders"."name") = 1),
	CONSTRAINT "org_chart_planned_holder_name" CHECK ("org_chart_planned_holders"."name" IS NULL OR char_length(btrim("org_chart_planned_holders"."name")) BETWEEN 2 AND 200)
);
--> statement-breakpoint
ALTER TABLE "org_chart_planned_holders" ADD CONSTRAINT "org_chart_planned_holders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_chart_planned_holders" ADD CONSTRAINT "org_chart_planned_holders_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_chart_planned_holders" ADD CONSTRAINT "org_chart_planned_holders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_chart_planned_holders" ADD CONSTRAINT "org_chart_planned_holders_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_chart_planned_holders_position_idx" ON "org_chart_planned_holders" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "org_chart_planned_holders_org_idx" ON "org_chart_planned_holders" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_chart_planned_holders_user_uq" ON "org_chart_planned_holders" USING btree ("position_id","user_id");--> statement-breakpoint
-- Planned holders (org chart, part 4; the coordinator's decision, 18 Nov
-- 2026, review B2). People are placed only on the live structure, so an
-- import's holder column never writes a holding into the draft: it writes a
-- plan, kept apart from the positions (clients read every column of a
-- published version's positions) and readable and writable by the draft's
-- editors only. Publishing (part 5) turns plans into holdings; until then a
-- plan stays with the position it was made for, and no client person ever
-- reads one.
--
-- 1. A plan: for a position of the draft only, at a client that keeps
--    names, naming one of the client's own active people or a typed name,
--    once per position. A plan is replaced, never changed: no update.
CREATE FUNCTION check_planned_holder() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  st org_chart_state;
  vorg uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'a planned holder is replaced, never changed' USING ERRCODE = 'check_violation';
  END IF;
  SELECT v.state, v.org_id INTO st, vorg
  FROM positions p JOIN org_chart_versions v ON v.id = p.version_id
  WHERE p.id = NEW.position_id
  FOR SHARE OF v;
  IF st IS NULL THEN
    RAISE EXCEPTION 'no such position' USING ERRCODE = 'check_violation';
  END IF;
  IF st <> 'draft' THEN
    RAISE EXCEPTION 'people are planned only for positions of the draft' USING ERRCODE = 'check_violation';
  END IF;
  NEW.org_id := vorg;
  IF coalesce((SELECT o.minimal_records FROM organizations o WHERE o.id = vorg), false) THEN
    RAISE EXCEPTION 'this client keeps minimal records: its structure has titles only, no names' USING ERRCODE = 'check_violation';
  END IF;
  NEW.name := nullif(btrim(NEW.name), '');
  IF NEW.user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM org_memberships m WHERE m.user_id = NEW.user_id AND m.org_id = vorg AND m.active) THEN
    RAISE EXCEPTION 'a planned holder is one of the client''s own active people, or a typed name' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('planned_holder'), hashtext(NEW.position_id::text));
  IF EXISTS (
    SELECT 1 FROM org_chart_planned_holders h
    WHERE h.position_id = NEW.position_id AND (h.user_id = NEW.user_id OR lower(h.name) = lower(NEW.name))) THEN
    RAISE EXCEPTION 'this person is already planned for the position' USING ERRCODE = 'check_violation';
  END IF;
  NEW.created_by := coalesce(app_uid(), NEW.created_by);
  NEW.created_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER planned_holder_rules BEFORE INSERT OR UPDATE ON org_chart_planned_holders FOR EACH ROW EXECUTE FUNCTION check_planned_holder();
--> statement-breakpoint
-- An archived client's plans freeze with the rest of its structure (lib/offboarding.ts CLIENT_FROZEN_TABLES).
CREATE TRIGGER client_open BEFORE INSERT OR UPDATE OR DELETE ON org_chart_planned_holders FOR EACH ROW EXECUTE FUNCTION check_client_open();
--> statement-breakpoint
-- 2. The draft's editors only (the firm admin, the lead, the deputy and
--    consultants staffed, not observing, on an open project of the client):
--    they read, add and remove plans. Observers, the client's admins and
--    managers, action owners and anyone of another client read none.
GRANT SELECT, INSERT, DELETE ON org_chart_planned_holders TO selah_app;
--> statement-breakpoint
ALTER TABLE org_chart_planned_holders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY editor_read ON org_chart_planned_holders FOR SELECT TO selah_app USING (app_org_chart_editor(org_id));
--> statement-breakpoint
CREATE POLICY editor_insert ON org_chart_planned_holders FOR INSERT TO selah_app WITH CHECK (app_org_chart_editor(org_id));
--> statement-breakpoint
CREATE POLICY editor_delete ON org_chart_planned_holders FOR DELETE TO selah_app USING (app_org_chart_editor(org_id));
--> statement-breakpoint
-- 3. Minimal records (latest definition: 0091_org_chart): a client is
--    switched to minimal records only while its structure holds nobody's
--    name, now, in the past or planned. Unchanged otherwise.
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
    IF EXISTS (SELECT 1 FROM position_holders h WHERE h.org_id = NEW.id)
       OR EXISTS (SELECT 1 FROM org_chart_planned_holders h WHERE h.org_id = NEW.id) THEN
      RAISE EXCEPTION 'remove the names of people from the client''s structure before switching to minimal records' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.display_alias := trim(NEW.display_alias);
  NEW.name := NEW.display_alias;
  NEW.name_ar := NEW.display_alias;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- 4. Masking: a typed name planned for the draft is masked before a hosted
--    model sees it, like a typed holder's (latest definition of the project's
--    names: app_mask_names in 0091_org_chart). It carries its own record
--    ("planned:"), so the whole list (app_mask_terms) gives it only to the
--    draft's editors, who may read plans; app_mask_terms_in() keeps it for
--    anyone, since it gives only the names written in the text itself.
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
    -- People typed into a position of the client's structure (org chart, migration 0091), current or past.
    SELECT 'PERSON', h.name, 'holder:' || md5(lower(btrim(h.name))) FROM position_holders h, p WHERE h.org_id = p.org_id AND h.name IS NOT NULL
    UNION
    -- People typed in as planned for a position of the draft (this migration): the firm's alone.
    SELECT 'PERSON', h.name, 'planned:' || md5(lower(btrim(h.name))) FROM org_chart_planned_holders h, p WHERE h.org_id = p.org_id AND h.name IS NOT NULL
  )
  SELECT DISTINCT t.kind, btrim(t.term), t.entity FROM terms t WHERE t.term IS NOT NULL AND length(btrim(t.term)) >= 2
$$;
--> statement-breakpoint
-- The whole list (latest definition: 0091_org_chart), still refused to
-- action owners, with typed holder names as before, and planned names only
-- for the draft's editors: a client person, an observer, never.
CREATE OR REPLACE FUNCTION app_mask_terms(pid uuid) RETURNS TABLE (kind text, term text, entity text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE client uuid := (SELECT x.org_id FROM projects x WHERE x.id = pid);
BEGIN
  IF session_user = 'selah_app' AND app_role() = 'action_owner' THEN
    RAISE EXCEPTION 'the masking list is not for action owners' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY SELECT n.kind, n.term, n.entity FROM app_mask_names(pid) n
    WHERE (n.entity NOT LIKE 'planned:%' OR session_user <> 'selah_app' OR app_org_chart_editor(client))
      AND (n.entity NOT LIKE 'holder:%' OR session_user <> 'selah_app' OR app_org_chart_full_reader(client)
        OR lower(n.term) IN (
          SELECT lower(btrim(h.name)) FROM org_chart_versions v CROSS JOIN LATERAL app_org_chart_holders(v.id, app_firm_today()) h
          WHERE v.org_id = client AND v.state = 'published' AND h.named AND h.name IS NOT NULL));
END $$;
