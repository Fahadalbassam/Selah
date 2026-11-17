-- The shared status pack, in the database (privacy review #2; decision D8).
--
-- An issued pack freezes its lists in reports.pack, every department's work
-- by title. The service left out, for a reader with department limits, the
-- items of departments they may not open; but the app role read the column
-- itself, so any query could hand the whole pack to that reader. As for the
-- meeting agenda (0072), the app role no longer reads the column, and the
-- pack is handed out by one function that applies the reader's limits.
--
-- 1. The only way the app reads a pack. NULL for a report the caller cannot
--    read (the scoped_read policy on reports), for an action owner (they do
--    not read reports: report.read in policy.ts), and for a report without a
--    pack. The firm and the client's admin get it whole. A client manager
--    gets every list without the items of departments that fail the
--    department check, and is told how many each list left out (leftOut),
--    never which. The numbers ("moved") stay whole: a person at the firm
--    chose to share the report. An indicator of a hidden department is left
--    out; an indicator's linked recommendations were frozen by title, and
--    only those the reader can open today are named (a title that cannot be
--    matched, another department's or one renamed since, is counted in
--    recommendationsLeftOut).
CREATE FUNCTION app_report_pack_for(rid uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  rep record;
  hidden uuid[];
  result jsonb;
  kept jsonb;
  counts jsonb := '{}'::jsonb;
  k text;
BEGIN
  SELECT r.pack, r.org_id INTO rep FROM reports r
  WHERE r.id = rid AND app_can_see_project(r.project_id) AND app_label_ok(r.visibility, r.org_id, r.generated_by)
    AND ((app_org_kind() = 'firm' AND app_role() IS NOT NULL) OR app_role() IN ('client_admin', 'client_manager'));
  IF NOT FOUND OR rep.pack IS NULL THEN RETURN NULL; END IF;
  IF app_org_kind() = 'firm' OR app_role() = 'client_admin' THEN RETURN rep.pack; END IF;

  SELECT coalesce(array_agg(d.id), '{}') INTO hidden FROM departments d WHERE d.org_id = rep.org_id AND NOT app_dept_ok(d.id, d.org_id);
  -- No department is closed to this reader: departments are off, or they are in all of them.
  IF cardinality(hidden) = 0 THEN RETURN rep.pack; END IF;

  result := rep.pack;
  FOREACH k IN ARRAY ARRAY['decisions', 'overdue', 'slipped', 'riskAccepted', 'verified'] LOOP
    SELECT coalesce(jsonb_agg(x.i ORDER BY x.o), '[]'::jsonb) INTO kept
    FROM jsonb_array_elements(coalesce(rep.pack -> k, '[]'::jsonb)) WITH ORDINALITY x(i, o)
    WHERE x.i ->> 'departmentId' IS NULL OR NOT ((x.i ->> 'departmentId')::uuid = ANY (hidden));
    result := jsonb_set(result, ARRAY[k], kept);
    counts := counts || jsonb_build_object(k, jsonb_array_length(coalesce(rep.pack -> k, '[]'::jsonb)) - jsonb_array_length(kept));
  END LOOP;
  result := result || jsonb_build_object('leftOut', counts);

  IF jsonb_typeof(rep.pack -> 'indicators') = 'array' THEN
    SELECT coalesce(jsonb_agg(s.ind ORDER BY s.o), '[]'::jsonb) INTO kept FROM (
      SELECT x.o, x.i || jsonb_build_object('recommendations', n.named,
               'recommendationsLeftOut', jsonb_array_length(coalesce(x.i -> 'recommendations', '[]'::jsonb)) - jsonb_array_length(n.named)) AS ind
      FROM jsonb_array_elements(rep.pack -> 'indicators') WITH ORDINALITY x(i, o)
      CROSS JOIN LATERAL (
        SELECT coalesce(jsonb_agg(t.title ORDER BY t.o), '[]'::jsonb) AS named
        FROM jsonb_array_elements_text(coalesce(x.i -> 'recommendations', '[]'::jsonb)) WITH ORDINALITY t(title, o)
        -- The recommendation read rule (scoped_read and department on recommendations), for this reader.
        WHERE EXISTS (
          SELECT 1 FROM client_kpi_links l JOIN recommendations r ON r.id = l.recommendation_id
          WHERE l.kpi_id = (x.i ->> 'id')::uuid AND r.title = t.title
            AND app_can_see_project(r.project_id) AND app_label_ok(r.visibility, r.org_id, r.created_by)
            AND (app_dept_ok(r.department_id, r.org_id) OR r.accountable_user_id = app_uid() OR app_owns_action_under(r.id)))
      ) n
      WHERE x.i ->> 'departmentId' IS NULL OR NOT ((x.i ->> 'departmentId')::uuid = ANY (hidden))
    ) s;
    result := jsonb_set(result, '{indicators}', kept);
  END IF;
  RETURN result;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_report_pack_for(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_report_pack_for(uuid) TO selah_app;
--> statement-breakpoint
-- 2. The app role no longer reads the column itself. It still writes it (the
--    firm issues a pack, check_status_pack guards how). A column added to
--    reports later needs its own GRANT SELECT (column) here;
--    tests/db/privacy-leaks.test.ts fails by name until it has one.
REVOKE SELECT ON reports FROM selah_app;
--> statement-breakpoint
GRANT SELECT (id, project_id, org_id, title, body_md, visibility, generated_by, shared_at, period_start, period_end, metrics, created_at, kind)
  ON reports TO selah_app;
