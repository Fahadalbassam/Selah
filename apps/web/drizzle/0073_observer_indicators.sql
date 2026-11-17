-- An observer is read-only on the client's business indicators too (page
-- audit N4; decision D4).
--
-- Indicators belong to the client, not to a project, so the observer rule
-- (migration 0034, which looks at the project a row is in) never reached
-- them: a consultant who only observes had every indicator right a staffed
-- consultant has, and so did a consultant on the client's team who is
-- staffed on none of its projects.
--
-- The rule, written from the other side so it leaves no hole: a consultant
-- changes a client's indicators (enters or corrects a value, marks one
-- checked, adds, edits, pauses or deletes an indicator, links or unlinks a
-- recommendation, changes how the figures reach Selah) only when staffed,
-- not as an observer, on at least one of that client's projects, or when the
-- client's lead or deputy. Every other consultant who works with the client
-- reads. The firm admin and the client's own roles keep what they had.
CREATE FUNCTION app_firm_changes_kpis(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_firm_works_with(org) AND (
    app_role() = 'firm_admin'
    OR app_is_client_lead(org)
    OR EXISTS (
      SELECT 1 FROM project_members pm JOIN projects p ON p.id = pm.project_id
      WHERE pm.user_id = app_uid() AND NOT pm.observer AND p.org_id = org AND p.kind = 'client')
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_firm_changes_kpis(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_firm_changes_kpis(uuid) TO selah_app;
--> statement-breakpoint
-- app_kpi_writer() keeps deciding who READS the connections and imports
-- (every consultant who works with the client, and the client's admin).
-- Writing asks this instead.
CREATE FUNCTION app_kpi_changer(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_firm_changes_kpis(org) OR (app_role() = 'client_admin' AND org = app_org())
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_kpi_changer(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_kpi_changer(uuid) TO selah_app;
--> statement-breakpoint
-- Setting up, editing, pausing and deleting an indicator.
DROP POLICY writer_insert ON client_kpis;
--> statement-breakpoint
CREATE POLICY writer_insert ON client_kpis FOR INSERT TO selah_app WITH CHECK (app_kpi_changer(org_id));
--> statement-breakpoint
DROP POLICY writer_update ON client_kpis;
--> statement-breakpoint
CREATE POLICY writer_update ON client_kpis FOR UPDATE TO selah_app USING (app_kpi_changer(org_id)) WITH CHECK (app_kpi_changer(org_id));
--> statement-breakpoint
DROP POLICY writer_delete ON client_kpis;
--> statement-breakpoint
CREATE POLICY writer_delete ON client_kpis FOR DELETE TO selah_app USING (app_kpi_changer(org_id));
--> statement-breakpoint
-- Entering or correcting a value: the client's admins and managers for what
-- they read, and the firm's people who may change the client's indicators.
DROP POLICY report ON client_kpi_values;
--> statement-breakpoint
CREATE POLICY report ON client_kpi_values FOR INSERT TO selah_app WITH CHECK (
  entered_by = app_uid() AND app_kpi_id_readable(kpi_id)
  AND (app_role() IN ('client_admin', 'client_manager') OR app_firm_changes_kpis(org_id))
);
--> statement-breakpoint
-- Marking a value checked against the client's source.
DROP POLICY firm_check ON client_kpi_values;
--> statement-breakpoint
CREATE POLICY firm_check ON client_kpi_values FOR UPDATE TO selah_app
  USING (app_firm_changes_kpis(org_id)) WITH CHECK (app_firm_changes_kpis(org_id));
--> statement-breakpoint
-- Linking an indicator to a recommendation, and unlinking it.
DROP POLICY writer_insert ON client_kpi_links;
--> statement-breakpoint
CREATE POLICY writer_insert ON client_kpi_links FOR INSERT TO selah_app
  WITH CHECK (app_kpi_changer(org_id) AND EXISTS (SELECT 1 FROM recommendations r WHERE r.id = recommendation_id));
--> statement-breakpoint
DROP POLICY writer_delete ON client_kpi_links;
--> statement-breakpoint
CREATE POLICY writer_delete ON client_kpi_links FOR DELETE TO selah_app USING (app_kpi_changer(org_id));
--> statement-breakpoint
-- How the figures reach Selah (migration 0067): for a client with no
-- accounts the firm records the choice and connects the sources; that too is
-- a change. app_kpi_data_admin() also guards the connections, which
-- indicators they fill and how a run went.
CREATE OR REPLACE FUNCTION app_kpi_data_admin(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (app_role() = 'client_admin' AND org = app_org())
    OR (app_firm_changes_kpis(org) AND EXISTS (
      SELECT 1 FROM organizations o WHERE o.id = org AND o.kind = 'client' AND o.engagement_mode = 'consultant_managed'))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_propose_kpi_data_mode(org uuid, mode indicator_data_mode) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_org_kind() IS DISTINCT FROM 'firm' OR NOT app_firm_changes_kpis(org) THEN
    RAISE EXCEPTION 'no such client' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('selah.kpi_proposal', 'on', true);
  INSERT INTO client_indicator_settings (org_id, proposed_mode) VALUES (org, mode)
    ON CONFLICT (org_id) DO UPDATE SET proposed_mode = EXCLUDED.proposed_mode;
  PERFORM set_config('selah.kpi_proposal', 'off', true);
END $$;
--> statement-breakpoint
-- Importing figures from a file enters values, so it follows the same rule.
DROP POLICY report ON indicator_imports;
--> statement-breakpoint
CREATE POLICY report ON indicator_imports FOR INSERT TO selah_app WITH CHECK (
  by_user = app_uid() AND app_kpi_readable(org_id, NULL)
  AND (app_role() IN ('client_admin', 'client_manager') OR app_firm_changes_kpis(org_id))
);
