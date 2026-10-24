-- A firm-only recommendation keeps its actions firm-only (journey-map gap N2,
-- 2026-10-24). The recommendation's own policies checked its label, but its
-- actions and every record under them (progress, evidence, reviews, risk
-- acceptances, deadline requests, notes, follow-ups) were checked against
-- the project only. A client on the project could read an action the firm
-- was still drafting privately, its evidence list and its reviews.
--
-- 1. The label check, through a recommendation and through an action.
CREATE FUNCTION app_recommendation_label_ok(rec uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT app_label_ok(r.visibility, r.org_id, r.created_by) FROM recommendations r WHERE r.id = rec), true)
$$;
--> statement-breakpoint
CREATE FUNCTION app_action_label_ok(act uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT app_recommendation_label_ok(a.recommendation_id) FROM actions a WHERE a.id = act), true)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_recommendation_label_ok(uuid), app_action_label_ok(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_recommendation_label_ok(uuid), app_action_label_ok(uuid) TO selah_app;
--> statement-breakpoint
-- 2. Restrictive, like the department check: added to every existing policy
--    on these tables, so no read or write path skips it.
CREATE POLICY recommendation_label ON actions AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_recommendation_label_ok(recommendation_id)) WITH CHECK (app_recommendation_label_ok(recommendation_id));
--> statement-breakpoint
CREATE POLICY recommendation_label ON progress_updates AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_label_ok(action_id)) WITH CHECK (app_action_label_ok(action_id));
--> statement-breakpoint
CREATE POLICY recommendation_label ON evidence_submissions AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_label_ok(action_id)) WITH CHECK (app_action_label_ok(action_id));
--> statement-breakpoint
CREATE POLICY recommendation_label ON evidence_requests AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_label_ok(action_id)) WITH CHECK (app_action_label_ok(action_id));
--> statement-breakpoint
CREATE POLICY recommendation_label ON reviews AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_label_ok(action_id)) WITH CHECK (app_action_label_ok(action_id));
--> statement-breakpoint
CREATE POLICY recommendation_label ON risk_acceptances AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_label_ok(action_id)) WITH CHECK (app_action_label_ok(action_id));
--> statement-breakpoint
CREATE POLICY recommendation_label ON deadline_change_requests AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_label_ok(action_id)) WITH CHECK (app_action_label_ok(action_id));
--> statement-breakpoint
CREATE POLICY recommendation_label ON action_notes AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_label_ok(action_id)) WITH CHECK (app_action_label_ok(action_id));
--> statement-breakpoint
-- A follow-up has its own label; one tied to a hidden action is hidden too.
CREATE POLICY recommendation_label ON follow_ups AS RESTRICTIVE FOR ALL TO selah_app
  USING (app_action_label_ok(action_id)) WITH CHECK (app_action_label_ok(action_id));
--> statement-breakpoint
-- 3. Notifications are written by the server and by jobs, past row-level
--    security. One about an action the recipient can't see is dropped, before
--    it can be mailed (this trigger runs before mail_action_notification).
CREATE FUNCTION drop_hidden_action_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.entity_type = 'action'
     AND EXISTS (SELECT 1 FROM actions a JOIN recommendations r ON r.id = a.recommendation_id
                 WHERE a.id = NEW.entity_id AND r.visibility <> 'shared')
     AND NOT EXISTS (SELECT 1 FROM org_memberships m JOIN organizations o ON o.id = m.org_id
                     WHERE m.user_id = NEW.user_id AND o.kind = 'firm') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION drop_hidden_action_notification() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER hide_private_action BEFORE INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION drop_hidden_action_notification();
--> statement-breakpoint
-- 4. A meeting's agenda is written into the meeting, which the client may
--    see, by a function that runs past row-level security. It lists only
--    actions under shared recommendations.
CREATE OR REPLACE FUNCTION app_meeting_agenda(pid uuid, before timestamptz, lang text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  today date := app_firm_today();
  last_held timestamptz := (SELECT max(m.starts_at) FROM meetings m WHERE m.project_id = pid AND m.status = 'held' AND m.starts_at < before);
  out text := '';
  part text;
  en boolean := lang = 'en';
BEGIN
  SELECT string_agg('- ' || a.title || CASE WHEN en THEN ' (due ' ELSE ' (الاستحقاق ' END || a.due_date || ')', E'\n' ORDER BY a.due_date) INTO part FROM (
    SELECT a.title, a.due_date FROM actions a JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
    WHERE a.project_id = pid AND a.due_date < today AND app_action_open(a.status)
    ORDER BY a.due_date LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Overdue\n' ELSE E'## متأخرة\n' END || part || E'\n\n'; END IF;
  SELECT string_agg('- ' || a.title, E'\n' ORDER BY a.title) INTO part FROM (
    SELECT a.title FROM actions a JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
    WHERE a.project_id = pid AND a.status = 'awaiting_review' ORDER BY a.title LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Awaiting review\n' ELSE E'## بانتظار المراجعة\n' END || part || E'\n\n'; END IF;
  SELECT string_agg('- ' || a.title || coalesce(': ' || a.blocked_reason, ''), E'\n' ORDER BY a.title) INTO part FROM (
    SELECT a.title, a.blocked_reason FROM actions a JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
    WHERE a.project_id = pid AND a.status = 'blocked' ORDER BY a.title LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Blocked\n' ELSE E'## متوقفة\n' END || part || E'\n\n'; END IF;
  IF last_held IS NOT NULL THEN
    SELECT string_agg('- ' || c.title || ' (' || c.status || ')', E'\n' ORDER BY c.title) INTO part FROM (
      SELECT c.* FROM app_changed_actions(pid, last_held) c
        JOIN actions a ON a.id = c.action_id JOIN recommendations r ON r.id = a.recommendation_id AND r.visibility = 'shared'
      ORDER BY c.title LIMIT 20) c;
    IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Changed since the last meeting\n' ELSE E'## ما تغيّر منذ الاجتماع السابق\n' END || part || E'\n\n'; END IF;
  END IF;
  RETURN nullif(rtrim(out, E'\n'), '');
END $$;
