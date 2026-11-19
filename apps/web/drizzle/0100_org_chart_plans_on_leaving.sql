-- Plans and leaving (org chart, part 4; the coordinator's decision of 19 Nov
-- 2026 after the privacy recheck, N-N2): a plan is the firm's working note,
-- not a record, so when a planned person leaves the client (their account
-- switched off) they are no longer planned anywhere in its draft: audited as
-- a plan change, with the count, never the name. The leaving list says so to
-- the firm (services/accounts.ts personHoldings).
CREATE FUNCTION drop_plans_on_leaving() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM organizations o WHERE o.id = NEW.org_id AND o.status = 'archived') THEN
    RETURN NULL;
  END IF;
  WITH gone AS (
    DELETE FROM org_chart_planned_holders h WHERE h.user_id = NEW.user_id AND h.org_id = NEW.org_id RETURNING 1
  ) SELECT count(*) INTO n FROM gone;
  IF n > 0 THEN
    INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
      VALUES (app_uid(), coalesce(app_org(), NEW.org_id), 'org_chart.plan', 'org_chart', NEW.org_id, 'allow',
        jsonb_build_object('client', NEW.org_id, 'removed', n, 'leaving', true));
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER planned_holders_leaving AFTER UPDATE OF active ON org_memberships
  FOR EACH ROW WHEN (OLD.active AND NOT NEW.active) EXECUTE FUNCTION drop_plans_on_leaving();
