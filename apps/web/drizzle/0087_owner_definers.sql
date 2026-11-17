-- Every definer function an action owner can call refuses, or answers
-- nothing, for an action (or a meeting) she may not read (the lead's ruling
-- on the review of 1b, 17 Nov 2026). An owner can learn a colleague's action
-- id (an old link, a file's history), and these answered about it. None is
-- reachable through a route with a colleague's id; this closes the database
-- side too. Every other role gets the same answers as before.
--
-- 1. Telling the firm's team about an action (latest: baseline): only for
--    an action the caller can see. It wrote "awaiting review" notices from
--    an owner about a colleague's action, and its refusal said whether that
--    action was waiting.
CREATE OR REPLACE FUNCTION app_notify_project_team(act uuid, note_kind text, skip uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pid uuid; st action_status; n integer;
BEGIN
  SELECT a.project_id, a.status INTO pid, st FROM actions a WHERE a.id = act;
  IF pid IS NULL OR NOT app_can_see_project(pid) OR NOT app_can_see_action(act) THEN
    RAISE EXCEPTION 'action not visible' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (
    (note_kind = 'action.awaiting_review' AND st = 'awaiting_review')
    OR (note_kind = 'risk.accepted' AND EXISTS (
      SELECT 1 FROM risk_acceptances ra WHERE ra.action_id = act AND ra.accepted_by = app_uid()))
    OR (note_kind = 'deadline.requested' AND EXISTS (
      SELECT 1 FROM deadline_change_requests d WHERE d.action_id = act AND d.requested_by = app_uid() AND d.status = 'pending'))
  ) THEN
    RAISE EXCEPTION 'notification does not match the action' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT u, note_kind, 'action', act FROM app_project_audience(pid) u
    WHERE u <> app_uid() AND NOT (u = ANY (coalesce(skip, '{}')));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
-- 2. The yes/no helpers the row policies use, and two the services ask:
--    false for an owner about an action that is not hers. (They are AND-ed
--    into policies that the owner rule already restricts, so no row changes
--    for anyone.) Latest: app_action_dept_ok 0046, app_action_label_ok 0006,
--    app_action_visible_to_client 0078, app_can_extend 0047,
--    app_evidence_accepted baseline.
CREATE OR REPLACE FUNCTION app_action_dept_ok(act uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT app_dept_ok(a.department_id, a.org_id) OR coalesce(a.owner_user_id = app_uid(), false)
    FROM actions a WHERE a.id = act
  ), true) AND app_owner_reads_action(act)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_action_label_ok(act uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT app_recommendation_label_ok(a.recommendation_id) FROM actions a WHERE a.id = act), true)
    AND app_owner_reads_action(act)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_action_visible_to_client(aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (coalesce(app_org_kind() = 'firm', false)
    OR aid IS NULL
    OR EXISTS (SELECT 1 FROM actions a WHERE a.id = aid AND a.status <> 'draft'))
    AND app_owner_reads_action(aid)
$$;
--> statement-breakpoint
-- (Outside the firm, only about an action the caller can see at all, so a
-- draft and a missing id answer the same, as D6 requires.)
CREATE OR REPLACE FUNCTION app_can_extend(act uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (coalesce(app_org_kind() = 'firm', false) OR app_can_see_action(act)) AND (
    app_action_extensions(act) < app_extensions_before_lead()
    OR app_role() = 'firm_admin'
    OR EXISTS (SELECT 1 FROM actions a JOIN projects p ON p.id = a.project_id WHERE a.id = act
               AND ((p.kind = 'client' AND app_is_client_lead(p.org_id)) OR (p.kind = 'internal' AND app_is_project_lead(p.id))))
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_evidence_accepted(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM evidence_submissions es
    JOIN reviews r ON r.action_id = es.action_id
    WHERE es.document_id = doc AND r.outcome = 'accept' AND es.id = ANY (r.evidence_submission_ids)
      AND app_owner_reads_action(es.action_id)
  )
$$;
--> statement-breakpoint
-- 3. The names to mask before text reaches a hosted model (latest:
--    baseline). It lists every person of the client and the firm and the
--    typed owners of every action of the project. Action owners never have
--    the assistant: refused for them.
CREATE OR REPLACE FUNCTION app_mask_terms(pid uuid) RETURNS TABLE (kind text, term text, entity text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF session_user = 'selah_app' AND app_role() = 'action_owner' THEN
    RAISE EXCEPTION 'the masking list is not for action owners' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
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
  )
  SELECT DISTINCT t.kind, btrim(t.term), t.entity FROM terms t WHERE t.term IS NOT NULL AND length(btrim(t.term)) >= 2;
END $$;
--> statement-breakpoint
-- 4. The invite list (latest: 0084), with each person's departments and
--    whether they could open a whole-project meeting: only for people who may
--    book (the firm, the client's admins and managers), as meeting.book says.
CREATE OR REPLACE FUNCTION app_meeting_invitees(pid uuid)
RETURNS TABLE (user_id uuid, name text, firm boolean, whole_project boolean, departments uuid[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.name, mo.org_id = p.firm_org_id,
    mo.role = 'action_owner' OR app_user_sees_whole_project(u.id, pid),
    coalesce((SELECT array_agg(d.id ORDER BY d.id) FROM department_members dm JOIN departments d ON d.id = dm.department_id
              WHERE dm.user_id = u.id AND d.org_id = p.org_id AND d.active AND mo.org_id = p.org_id), '{}')
  FROM projects p
  JOIN org_memberships mo ON mo.active AND mo.org_id IN (p.firm_org_id, p.org_id)
  JOIN "user" u ON u.id = mo.user_id
  WHERE p.id = pid AND app_can_see_project(pid) AND app_user_sees_project(u.id, pid)
    AND (app_org_kind() = 'firm' OR app_role() IN ('client_admin', 'client_manager'))
    AND (app_org_kind() = 'firm' OR mo.org_id = app_org()
         OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = pid AND pm.user_id = u.id))
  ORDER BY mo.org_id = p.firm_org_id DESC, u.name
$$;
