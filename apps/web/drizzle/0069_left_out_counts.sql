-- Privacy batch 0 (page audit N1, N3; decision D8): a person never sees, by
-- title, work they may not open. Where a list leaves something out, the
-- screen says how many, never what. A reader's own row-level security hides
-- the rows, so the count has to come from a function that reads past it and
-- returns a number only.
--
-- 1. The recommendation page lists the actions the reader may open. This is
--    how many more there are under the recommendation: the actions not in
--    `shown`. Only for a reader who can read the recommendation itself (the
--    same three checks as its row policies: project, label, department), so
--    an id that is not theirs answers 0, like a recommendation with nothing
--    left out. A draft is the firm's until it is released, so a client is not
--    told about one, not even as a number.
CREATE FUNCTION app_actions_left_out(rec uuid, shown uuid[]) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int
  FROM actions a JOIN recommendations r ON r.id = a.recommendation_id
  WHERE r.id = rec
    AND app_can_see_project(r.project_id) AND app_label_ok(r.visibility, r.org_id, r.created_by)
    AND (app_dept_ok(r.department_id, r.org_id) OR r.accountable_user_id = app_uid() OR app_owns_action_under(r.id))
    AND NOT (a.id = ANY (coalesce(shown, '{}'::uuid[])))
    AND (a.status <> 'draft' OR app_org_kind() = 'firm')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_actions_left_out(uuid, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_actions_left_out(uuid, uuid[]) TO selah_app;
--> statement-breakpoint
-- 2. The plan said "no recommendation yet" under a finding whose
--    recommendation is filed under a department the reader is not in. Per
--    finding of the project: how many live recommendations answer it that the
--    department check (and nothing else) hides from the caller. Recommendations
--    the label hides (the firm's own drafts) are not counted: the client has
--    not been told about those.
CREATE FUNCTION app_findings_answered_elsewhere(pid uuid) RETURNS TABLE (finding_id uuid, n integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.finding_id, count(*)::int
  FROM recommendations r JOIN findings f ON f.id = r.finding_id
  WHERE r.project_id = pid AND r.withdrawn_at IS NULL
    AND app_can_see_project(pid)
    AND app_label_ok(f.visibility, f.org_id, f.created_by)
    AND app_label_ok(r.visibility, r.org_id, r.created_by)
    AND NOT (app_dept_ok(r.department_id, r.org_id) OR coalesce(r.accountable_user_id = app_uid(), false) OR app_owns_action_under(r.id))
  GROUP BY r.finding_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_findings_answered_elsewhere(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_findings_answered_elsewhere(uuid) TO selah_app;
