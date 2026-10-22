-- Names in both languages, for masking before a hosted model (docs/assistant.md).
-- The GPT-OSS test run (2026-10-22) found people registered in Arabic going
-- out unmasked where an English file spelled them, short company names
-- ("Al-Nukhba") going out, and another client's name typed into a question
-- going out. 0049 added the columns; these are their rules.

-- ---------------------------------------------------------- people

ALTER TABLE "user" ADD CONSTRAINT user_name_alt_len CHECK (name_alt IS NULL OR length(btrim(name_alt)) BETWEEN 2 AND 120);
--> statement-breakpoint
ALTER TABLE client_contacts ADD CONSTRAINT contact_name_alt_len CHECK (name_alt IS NULL OR length(btrim(name_alt)) BETWEEN 2 AND 200);
--> statement-breakpoint
GRANT SELECT (name_alt) ON "user" TO selah_app;
--> statement-breakpoint

-- Set by the same admins who may change the person's address
-- (app_can_change_email): the firm admin, or the client admin for the
-- client's other people. Empty clears it. Logged.
CREATE FUNCTION app_set_name_alt(target uuid, val text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app_can_change_email(target) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE "user" SET name_alt = nullif(btrim(val), ''), updated_at = now() WHERE id = target;
  INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome)
    VALUES (app_uid(), app_user_org(target), 'user.name_alt', 'user', target, 'allow');
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_set_name_alt(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_set_name_alt(uuid, text) TO selah_app;
--> statement-breakpoint

-- Erasure (app_erase_user) replaces the name and address; the other-language name goes too.
CREATE FUNCTION erase_name_alt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email LIKE 'erased-%@erased.invalid' THEN
    NEW.name_alt := NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER erase_name_alt BEFORE UPDATE OF email ON "user" FOR EACH ROW EXECUTE FUNCTION erase_name_alt();
--> statement-breakpoint

-- ---------------------------------------------------------- companies

-- At most 6 short names of 2 to 100 characters, set by the firm admin only.
CREATE FUNCTION check_short_names() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.short_names IS DISTINCT FROM OLD.short_names AND app_uid() IS NOT NULL AND app_role() IS DISTINCT FROM 'firm_admin' THEN
    RAISE EXCEPTION 'only the firm admin changes short names' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF cardinality(NEW.short_names) > 6
     OR EXISTS (SELECT 1 FROM unnest(NEW.short_names) s WHERE length(btrim(s)) NOT BETWEEN 2 AND 100) THEN
    RAISE EXCEPTION 'up to 6 short names of 2 to 100 characters' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER short_names BEFORE UPDATE OF short_names ON organizations FOR EACH ROW EXECUTE FUNCTION check_short_names();
--> statement-breakpoint

-- ---------------------------------------------------------- what is masked

-- The project's client and firm with every name they go by, their people and
-- the client's contacts in both languages, action owners without an account,
-- the client's departments, and,
-- for firm staff, the names of every other client of the firm: a name typed
-- into a question about another client is masked too. Firm staff already see
-- client names (they may ask to join a client), so this shows them nothing
-- new; other clients' people are not included, since staff only see the
-- people of clients they work on. The list never reaches the browser.
DROP FUNCTION app_mask_terms(uuid);
--> statement-breakpoint
CREATE FUNCTION app_mask_terms(pid uuid) RETURNS TABLE (kind text, term text, entity text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH p AS (
    SELECT org_id, firm_org_id FROM projects
    WHERE id = pid AND (session_user <> 'selah_app' OR app_can_see_project(pid))
  ), orgs AS (
    SELECT o.id, o.name, o.name_ar, o.display_alias, o.short_names FROM organizations o, p WHERE o.id IN (p.org_id, p.firm_org_id)
    UNION
    SELECT o.id, o.name, o.name_ar, o.display_alias, o.short_names FROM organizations o, p
    WHERE o.kind = 'client'
      AND (session_user <> 'selah_app' OR app_org() = p.firm_org_id)
      AND EXISTS (SELECT 1 FROM projects x WHERE x.org_id = o.id AND x.firm_org_id = p.firm_org_id)
  ), terms AS (
    SELECT 'ORG' AS kind, unnest(ARRAY[o.name, o.name_ar, o.display_alias] || o.short_names) AS term, 'org:' || o.id AS entity
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
  )
  SELECT DISTINCT kind, btrim(term), entity FROM terms WHERE term IS NOT NULL AND length(btrim(term)) >= 2
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_mask_terms(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_mask_terms(uuid) TO selah_app;
