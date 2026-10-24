-- Custom SQL migration file, put your code below! --
-- Restructures (F31 of the full picture). When a client reorganises, the
-- firm admin moves a department's unfinished work to another of the client's
-- departments and may switch the old one off. Finished work stays filed where
-- it was done, so the record still says which department did it.
--   * A recommendation with unfinished work, or none planned yet, moves whole;
--     its actions follow it (recommendation_refiled).
--   * An unfinished action under a company-wide recommendation moves alone.
--   * The evidence files of moved actions follow them.
--   * A closed project is frozen and keeps its filing; a withdrawn
--     recommendation is final.
-- Each project touched gets one activity event naming both departments and
-- the actions moved (each action's history shows it), and the move is
-- audited. Meetings keep their department (a meeting is booked for one).
--
-- Only the firm admin: refiling recommendations and actions is the firm's
-- work (clients move actions only through their workflow). With dry_run it
-- only counts, for the dialog; dst may then be null.
CREATE FUNCTION app_move_department_work(src uuid, dst uuid, switch_off boolean, dry_run boolean)
RETURNS TABLE (recommendations int, actions int, files int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  org uuid := (SELECT d.org_id FROM departments d WHERE d.id = src);
  recs uuid[];
  acts uuid[];
  docs uuid[];
BEGIN
  IF org IS NULL OR app_role() IS DISTINCT FROM 'firm_admin' OR NOT app_can_see_org(org) THEN
    RAISE EXCEPTION 'only the firm admin moves a department''s work' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT dry_run AND (dst IS NULL OR dst = src OR NOT EXISTS (SELECT 1 FROM departments d WHERE d.id = dst AND d.org_id = org AND d.active)) THEN
    RAISE EXCEPTION 'move the work to another active department of the same client' USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(array_agg(r.id), '{}') INTO recs
  FROM recommendations r JOIN projects p ON p.id = r.project_id
  WHERE r.department_id = src AND p.state::text <> 'closed'
    -- Read through jsonb so the rule holds whether or not withdrawal (N1) has its column yet.
    AND (to_jsonb(r) ->> 'withdrawn_at') IS NULL
    AND (EXISTS (SELECT 1 FROM actions a WHERE a.recommendation_id = r.id AND a.status NOT IN ('verified_complete', 'closed'))
      OR NOT EXISTS (SELECT 1 FROM actions a WHERE a.recommendation_id = r.id));
  SELECT coalesce(array_agg(a.id), '{}') INTO acts
  FROM actions a JOIN projects p ON p.id = a.project_id
  WHERE a.department_id = src AND p.state::text <> 'closed'
    AND (a.recommendation_id = ANY (recs) OR a.status NOT IN ('verified_complete', 'closed'));
  SELECT coalesce(array_agg(DISTINCT d.id), '{}') INTO docs
  FROM documents d JOIN evidence_submissions e ON e.document_id = d.id
  WHERE e.action_id = ANY (acts) AND d.department_id = src;

  IF NOT dry_run THEN
    UPDATE recommendations r SET department_id = dst WHERE r.id = ANY (recs);
    UPDATE actions a SET department_id = dst WHERE a.id = ANY (acts) AND a.department_id = src;
    UPDATE documents d SET department_id = dst WHERE d.id = ANY (docs);
    INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, meta)
    SELECT x.project_id, org, app_uid(), 'project', x.project_id, 'department_moved',
      jsonb_build_object('from', src, 'to', dst, 'actions',
        coalesce((SELECT jsonb_agg(a.id) FROM actions a WHERE a.project_id = x.project_id AND a.id = ANY (acts)), '[]'::jsonb))
    FROM (SELECT r.project_id FROM recommendations r WHERE r.id = ANY (recs)
          UNION SELECT a.project_id FROM actions a WHERE a.id = ANY (acts)) x;
    INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
    VALUES (app_uid(), org, 'department.move_work', 'department', src, 'allow', jsonb_build_object(
      'to', dst, 'recommendations', cardinality(recs), 'actions', cardinality(acts), 'files', cardinality(docs), 'switchedOff', switch_off));
    IF switch_off THEN
      UPDATE departments SET active = false WHERE id = src;
    END IF;
  END IF;
  RETURN QUERY SELECT cardinality(recs), cardinality(acts), cardinality(docs);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_move_department_work(uuid, uuid, boolean, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_move_department_work(uuid, uuid, boolean, boolean) TO selah_app;
