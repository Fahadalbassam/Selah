-- One placeholder per company, person or department, whatever language its
-- name is written in. Without this, "Al-Nukhba Holding" and "شركة النخبة
-- القابضة" became [ORG_1] and [ORG_2], and the hosted model answered as if
-- they were two companies (GPT-OSS test run, 2026-10-22). The entity column
-- groups the names of one record; the web app gives each group one placeholder.
DROP FUNCTION app_mask_terms(uuid);
--> statement-breakpoint
CREATE FUNCTION app_mask_terms(pid uuid) RETURNS TABLE (kind text, term text, entity text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH p AS (
    SELECT org_id, firm_org_id FROM projects
    WHERE id = pid AND (session_user <> 'selah_app' OR app_can_see_project(pid))
  ), terms AS (
    SELECT 'ORG' AS kind, unnest(ARRAY[o.name, o.name_ar, o.display_alias]) AS term, 'org:' || o.id AS entity
      FROM organizations o, p WHERE o.id IN (p.org_id, p.firm_org_id)
    UNION
    SELECT 'PERSON', u.name, 'user:' || u.id FROM "user" u JOIN org_memberships m ON m.user_id = u.id, p
      WHERE m.org_id IN (p.org_id, p.firm_org_id)
    UNION
    SELECT 'PERSON', c.name, 'contact:' || c.id FROM client_contacts c, p WHERE c.org_id = p.org_id
    UNION
    SELECT 'DEPT', unnest(ARRAY[d.name_ar, d.name_en]), 'dept:' || d.id FROM departments d, p WHERE d.org_id = p.org_id
  )
  SELECT DISTINCT kind, btrim(term), entity FROM terms WHERE term IS NOT NULL AND length(btrim(term)) >= 2
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_mask_terms(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_mask_terms(uuid) TO selah_app;
