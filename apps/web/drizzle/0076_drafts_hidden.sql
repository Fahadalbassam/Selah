-- A client never sees a draft action until the firm releases it (decision D6,
-- product owner, 17 Nov 2026). This reverses the earlier behaviour: the read
-- rule on actions had no status check, so a client admin or manager could list
-- and open a draft, read what was under it and be told about it, while every
-- count left drafts out (page audit N2, B2).
--
-- A draft is an action with status 'draft'; the firm moves it to 'assigned'
-- with "release" (action.release). Firm roles see drafts exactly as before.
-- Client roles (client_admin, client_manager, action_owner) read neither the
-- draft nor anything under it. The rule is added as one RESTRICTIVE policy per
-- table, like the department and recommendation-label checks, so no existing
-- permissive rule is rewritten and no read or write path skips it.
--
-- 1. The check through an action: false only when a client person asks about a
--    draft. A missing or null action id passes, so rows that need not name an
--    action (a follow-up of a meeting) keep their own rules.
CREATE FUNCTION app_action_visible_to_client(aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(app_org_kind() = 'firm', false)
    OR coalesce((SELECT a.status <> 'draft' FROM actions a WHERE a.id = aid), true)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_action_visible_to_client(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_action_visible_to_client(uuid) TO selah_app;
--> statement-breakpoint
-- 2. The draft itself.
CREATE POLICY draft ON actions AS RESTRICTIVE FOR ALL TO selah_app
  USING (status <> 'draft' OR app_org_kind() = 'firm')
  WITH CHECK (status <> 'draft' OR app_org_kind() = 'firm');
--> statement-breakpoint
-- 3. Everything under it: progress, evidence and the evidence list, reviews
--    and sign-offs, risk acceptances, date requests, firm notes, the
--    discussion, due-date history, reminders, follow-ups, mail mutes and
--    closure items. (follow_up_log has no grant to the app at all.)
CREATE POLICY draft ON progress_updates AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_visible_to_client(action_id)) WITH CHECK (app_action_visible_to_client(action_id));
--> statement-breakpoint
CREATE POLICY draft ON evidence_submissions AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_visible_to_client(action_id)) WITH CHECK (app_action_visible_to_client(action_id));
--> statement-breakpoint
CREATE POLICY draft ON evidence_requests AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_visible_to_client(action_id)) WITH CHECK (app_action_visible_to_client(action_id));
--> statement-breakpoint
CREATE POLICY draft ON reviews AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_visible_to_client(action_id)) WITH CHECK (app_action_visible_to_client(action_id));
--> statement-breakpoint
CREATE POLICY draft ON review_signoffs AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_visible_to_client(action_id)) WITH CHECK (app_action_visible_to_client(action_id));
--> statement-breakpoint
CREATE POLICY draft ON risk_acceptances AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_visible_to_client(action_id)) WITH CHECK (app_action_visible_to_client(action_id));
--> statement-breakpoint
CREATE POLICY draft ON deadline_change_requests AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_visible_to_client(action_id)) WITH CHECK (app_action_visible_to_client(action_id));
--> statement-breakpoint
CREATE POLICY draft ON action_notes AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_visible_to_client(action_id)) WITH CHECK (app_action_visible_to_client(action_id));
--> statement-breakpoint
CREATE POLICY draft ON action_comments AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_visible_to_client(action_id)) WITH CHECK (app_action_visible_to_client(action_id));
--> statement-breakpoint
CREATE POLICY draft ON action_due_changes AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_visible_to_client(action_id)) WITH CHECK (app_action_visible_to_client(action_id));
--> statement-breakpoint
CREATE POLICY draft ON action_reminders AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_visible_to_client(action_id)) WITH CHECK (app_action_visible_to_client(action_id));
--> statement-breakpoint
CREATE POLICY draft ON follow_ups AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_visible_to_client(action_id)) WITH CHECK (app_action_visible_to_client(action_id));
--> statement-breakpoint
CREATE POLICY draft ON mail_mutes AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_visible_to_client(action_id)) WITH CHECK (app_action_visible_to_client(action_id));
--> statement-breakpoint
CREATE POLICY draft ON project_closure_items AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_visible_to_client(action_id)) WITH CHECK (app_action_visible_to_client(action_id));
--> statement-breakpoint
-- 4. What names the draft from elsewhere: the activity record, notifications
--    and translations of its text. (Its assistant passages are already read
--    only while the action itself can be read: the with_source policy on
--    ai_chunks looks the action up under the caller's own rules.)
CREATE POLICY draft ON activity_events AS RESTRICTIVE FOR ALL TO selah_app
  USING (entity_type <> 'action' OR app_action_visible_to_client(entity_id))
  WITH CHECK (entity_type <> 'action' OR app_action_visible_to_client(entity_id));
--> statement-breakpoint
CREATE POLICY draft ON content_translations AS RESTRICTIVE FOR ALL TO selah_app
  USING (entity_type <> 'action' OR app_action_visible_to_client(entity_id))
  WITH CHECK (entity_type <> 'action' OR app_action_visible_to_client(entity_id));
--> statement-breakpoint
-- Notifications are written past row-level security (by the server for other
-- people, and by jobs); the trigger below drops one about a draft for a client
-- person before it is stored or mailed. This policy hides any written before
-- from its reader while the action is a draft; nothing is deleted.
CREATE POLICY draft ON notifications AS RESTRICTIVE FOR SELECT TO selah_app
  USING (entity_type <> 'action' OR app_action_visible_to_client(entity_id));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION drop_hidden_action_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- About an action under a firm-only recommendation (0006), or a draft (D6):
  -- only the firm is told. Its owner hears of a draft when it is released.
  IF NEW.entity_type = 'action'
     AND EXISTS (SELECT 1 FROM actions a JOIN recommendations r ON r.id = a.recommendation_id
                 WHERE a.id = NEW.entity_id AND (r.visibility <> 'shared' OR a.status = 'draft'))
     AND NOT EXISTS (SELECT 1 FROM org_memberships m JOIN organizations o ON o.id = m.org_id
                     WHERE m.user_id = NEW.user_id AND o.kind = 'firm') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- 5. The functions that read actions past row-level security, where a client
--    can reach them.
--
-- Whether the caller can see an action: the guard of the reminder ladder, the
-- people on an action, due-date moves, refilings and the discussion.
CREATE OR REPLACE FUNCTION app_can_see_action(aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT app_can_see_project(a.project_id) AND app_recommendation_label_ok(a.recommendation_id) AND app_action_dept_ok(a.id)
      AND (a.status <> 'draft' OR app_org_kind() = 'firm')
    FROM actions a WHERE a.id = aid
  ), false)
$$;
--> statement-breakpoint
-- Whether someone else can see an action: who may be mentioned and told in
-- its discussion, and who is offered as "the people on it". Nobody at the
-- client, for a draft.
CREATE OR REPLACE FUNCTION app_user_sees_action(target uuid, act uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT CASE
      WHEN o.kind = 'firm' THEN
        o.id = p.firm_org_id
        AND coalesce(r.visibility::text, 'shared') IN ('shared', 'firm_private')
        AND (m.role = 'firm_admin'
          OR (m.role = 'consultant' AND (
            EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = target)
            OR (p.kind = 'client' AND EXISTS (
              SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = p.org_id AND ca.user_id = target AND ca.is_lead)))))
      ELSE
        o.id = p.org_id AND p.kind = 'client' AND p.state::text <> 'draft'
        AND a.status <> 'draft'
        AND coalesce(r.visibility::text, 'shared') IN ('shared', 'client_private')
        AND (m.role = 'client_admin'
          OR (m.role = 'client_manager' AND EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = target))
          OR (m.role = 'action_owner' AND a.owner_user_id = target))
        AND (a.department_id IS NULL OR m.role = 'client_admin' OR a.owner_user_id = target
          OR NOT o.departments_enabled
          OR EXISTS (SELECT 1 FROM department_members dm WHERE dm.department_id = a.department_id AND dm.user_id = target))
    END
    FROM actions a
    JOIN projects p ON p.id = a.project_id
    LEFT JOIN recommendations r ON r.id = a.recommendation_id
    JOIN org_memberships m ON m.user_id = target AND m.active AND m.org_id IN (p.firm_org_id, p.org_id)
    JOIN organizations o ON o.id = m.org_id
    WHERE a.id = act
    LIMIT 1
  ), false)
$$;
--> statement-breakpoint
-- Owning an action under a recommendation opens the recommendation past the
-- department rule (and counts it as readable in "N more" and the status
-- pack's indicators). A draft the caller is named on does not, for a client.
CREATE OR REPLACE FUNCTION app_owns_action_under(rec uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM actions a WHERE a.recommendation_id = rec AND a.owner_user_id = app_uid()
                 AND (a.status <> 'draft' OR app_org_kind() = 'firm'))
$$;
--> statement-breakpoint
-- The second sign-off state of an action, for a client: nothing about a draft.
CREATE OR REPLACE FUNCTION app_second_review_state(aid uuid)
RETURNS TABLE (required boolean, reason text, rule second_review_rule, flagged boolean, revisions integer,
               signed_by uuid, signed_by_name text, signed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_action_needs_second_review(a.id),
    CASE
      WHEN NOT app_action_needs_second_review(a.id) THEN NULL
      WHEN a.second_review THEN 'flag'
      WHEN s.rule = 'all' THEN 'all'
      WHEN s.rule = 'high_priority' AND r.priority IN ('high', 'critical') THEN 'high_priority'
      ELSE 'repeat_revisions'
    END,
    CASE WHEN p.kind = 'client' THEN coalesce(s.rule, 'off') END,
    a.second_review,
    rev.n::int,
    so.reviewer_id, u.name, so.created_at
  FROM actions a
    JOIN projects p ON p.id = a.project_id
    JOIN recommendations r ON r.id = a.recommendation_id
    LEFT JOIN client_review_settings s ON s.client_org_id = a.org_id AND p.kind = 'client'
    CROSS JOIN LATERAL (
      SELECT count(*) AS n FROM reviews v
      WHERE v.action_id = a.id AND v.outcome = 'revise' AND v.created_at >= coalesce(a.reopened_at, '-infinity')
    ) rev
    LEFT JOIN LATERAL (
      SELECT x.reviewer_id, x.created_at FROM review_signoffs x
      WHERE x.action_id = a.id AND a.status = 'awaiting_review' AND x.created_at >= coalesce(a.awaiting_review_at, '-infinity')
      ORDER BY x.created_at DESC LIMIT 1
    ) so ON true
    LEFT JOIN "user" u ON u.id = so.reviewer_id
  WHERE a.id = aid AND app_can_see_project(a.project_id)
    AND (a.status <> 'draft' OR app_org_kind() = 'firm')
$$;
--> statement-breakpoint
-- Closing: a client admin or sponsor names who sustains a handed-over action
-- only when they can read it, and a draft they cannot.
CREATE OR REPLACE FUNCTION app_name_sustainer(act uuid, s_user uuid, s_contact uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a actions;
  ok boolean;
BEGIN
  SELECT * INTO a FROM actions WHERE id = act;
  -- The action must be one the caller can see.
  IF a.id IS NULL OR NOT app_can_see_project(a.project_id)
     OR NOT EXISTS (SELECT 1 FROM project_closure_items i WHERE i.action_id = act AND i.closure_id = app_open_closure(a.project_id)
                    AND i.disposition = 'handed_over') THEN
    RAISE EXCEPTION 'no such handed-over action' USING ERRCODE = 'insufficient_privilege';
  END IF;
  ok := app_org_kind() = 'firm'
    OR (app_role() = 'client_admin' AND a.org_id = app_org())
    OR EXISTS (SELECT 1 FROM project_client_roles r WHERE r.project_id = a.project_id AND r.role = 'sponsor' AND r.user_id = app_uid());
  IF NOT ok THEN
    RAISE EXCEPTION 'the client''s admin or sponsor names who sustains it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- A client user may only name someone for an action they can read.
  IF app_org_kind() = 'client' AND NOT EXISTS (
    SELECT 1 FROM actions x JOIN recommendations rec ON rec.id = x.recommendation_id
    WHERE x.id = act AND app_label_ok(rec.visibility, rec.org_id, rec.created_by) AND x.status <> 'draft'
  ) THEN
    RAISE EXCEPTION 'no such handed-over action' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT state::text FROM projects WHERE id = a.project_id) <> 'closing' THEN
    RAISE EXCEPTION 'this project is not closing' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM app_check_sustainer(a.org_id, s_user, s_contact);
  UPDATE project_closure_items SET sustainer_user_id = s_user, sustainer_contact_id = s_contact, updated_at = now()
    WHERE action_id = act AND closure_id = app_open_closure(a.project_id);
END $$;
--> statement-breakpoint
-- 6. The departing-person report (0027). A draft the person is named on is the
--    firm's work, not the client's: it is listed, and blocks the switch-off,
--    only when someone at the firm asks (the firm admin, as before). A client
--    admin is neither shown its title nor stopped by it, and their hand-over
--    leaves it where it is. The firm settles it before release (below).
CREATE OR REPLACE FUNCTION app_person_holdings_of(uid uuid)
RETURNS TABLE (kind text, entity_id uuid, project_id uuid, org_id uuid, title text, detail text, blocking boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- open actions they own (a draft only for the firm)
  SELECT 'action', a.id, a.project_id, a.org_id, a.title, a.status::text, true
  FROM actions a JOIN projects p ON p.id = a.project_id
  WHERE a.owner_user_id = uid AND a.status NOT IN ('verified_complete', 'closed') AND p.state <> 'closed'
    AND (a.status <> 'draft' OR app_org_kind() = 'firm')
  UNION ALL
  -- clients they lead (prospects included: whoever pitched leads them)
  SELECT 'client_lead', o.id, NULL, o.id, o.name, o.name_ar, true
  FROM client_assignments ca JOIN organizations o ON o.id = ca.client_org_id
  WHERE ca.user_id = uid AND ca.is_lead AND o.status = 'active'
  UNION ALL
  -- projects they lead
  SELECT 'project_lead', p.id, p.id, p.org_id, p.title, p.state::text, true
  FROM project_members pm JOIN projects p ON p.id = pm.project_id
  WHERE pm.user_id = uid AND pm.is_lead AND p.state <> 'closed'
  UNION ALL
  -- work waiting for review that only they can do: they are staffed on the
  -- project or lead its client, and no other active firm person is (being
  -- on the client's team alone does not open its projects)
  SELECT 'review', a.id, a.project_id, a.org_id, a.title, NULL, true
  FROM actions a JOIN projects p ON p.id = a.project_id
  WHERE a.status = 'awaiting_review' AND p.state <> 'closed'
    AND EXISTS (
      SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = uid AND NOT pm.observer
      UNION ALL
      SELECT 1 FROM client_assignments ca WHERE ca.client_org_id = p.org_id AND ca.user_id = uid AND ca.is_lead AND p.kind = 'client'
    )
    AND NOT EXISTS (
      SELECT 1 FROM (
        SELECT pm.user_id FROM project_members pm WHERE pm.project_id = p.id AND NOT pm.observer
        UNION
        SELECT ca.user_id FROM client_assignments ca WHERE ca.client_org_id = p.org_id AND ca.is_lead AND p.kind = 'client'
      ) other
      JOIN org_memberships m ON m.user_id = other.user_id AND m.org_id = p.firm_org_id AND m.active
      WHERE other.user_id <> uid
    )
  UNION ALL
  -- named client roles (sponsor, coordinator, ...)
  SELECT 'client_role', r.id, r.project_id, r.org_id, p.title, r.role::text, false
  FROM project_client_roles r JOIN projects p ON p.id = r.project_id
  WHERE r.user_id = uid AND p.state <> 'closed'
  UNION ALL
  -- departments they head
  SELECT 'department_head', d.id, NULL, d.org_id, coalesce(d.name_en, d.name_ar), d.name_ar, false
  FROM department_members dm JOIN departments d ON d.id = dm.department_id
  WHERE dm.user_id = uid AND dm.is_head
$$;
--> statement-breakpoint
-- 7. So a draft is never released to someone who has gone (a client admin may
--    now switch its owner off, and taking someone off the project never waited
--    for drafts): releasing checks the owner as naming one does.
CREATE OR REPLACE FUNCTION check_action_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  releasing boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    releasing := OLD.status = 'draft' AND NEW.status <> 'draft';
  END IF;
  IF app_uid() IS NULL OR NEW.owner_user_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id AND NOT releasing) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM org_memberships m JOIN project_members pm ON pm.user_id = m.user_id AND pm.project_id = NEW.project_id AND NOT pm.observer
    WHERE m.user_id = NEW.owner_user_id AND m.org_id = NEW.org_id AND m.active
  ) THEN
    RAISE EXCEPTION 'the owner must be an active member of the project team' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER action_owner ON actions;
--> statement-breakpoint
CREATE TRIGGER action_owner BEFORE INSERT OR UPDATE OF owner_user_id, status ON actions
  FOR EACH ROW EXECUTE FUNCTION check_action_owner();
