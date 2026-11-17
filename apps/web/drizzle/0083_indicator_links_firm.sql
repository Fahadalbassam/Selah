-- Only firm staff link a business indicator to a recommendation (decision 1c,
-- product owner, 17 Nov 2026). The link is the consultant's statement that
-- the recommendation is expected to move the number, so the client's admin
-- no longer links or unlinks; the client still reads every link it may see
-- (policy scoped_read, unchanged) and still sets up and changes its own
-- indicators (app_kpi_changer, unchanged).
--
-- Who links, at the firm, is unchanged (decision D4, 0073 and 0075): the firm
-- admin, the client's lead or deputy, and a consultant staffed, not as an
-- observer, on one of the client's open projects (app_firm_changes_kpis).
-- Latest definitions: 0073_observer_indicators.
DROP POLICY writer_insert ON client_kpi_links;
--> statement-breakpoint
CREATE POLICY writer_insert ON client_kpi_links FOR INSERT TO selah_app
  WITH CHECK (app_firm_changes_kpis(org_id) AND EXISTS (SELECT 1 FROM recommendations r WHERE r.id = recommendation_id));
--> statement-breakpoint
DROP POLICY writer_delete ON client_kpi_links;
--> statement-breakpoint
CREATE POLICY writer_delete ON client_kpi_links FOR DELETE TO selah_app USING (app_firm_changes_kpis(org_id));
