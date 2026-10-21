-- Gaps from the vision summary (2026-10-21, research section 11).
--
--   a. Verified on whose evidence: an action verified on what the client
--      submitted in Selah is counted apart from one verified on what a
--      consultant recorded for the client. The two are never mixed.
--   c. Minimal records, for consultant-managed clients that want the firm to
--      keep as little as possible: an alias instead of the name, no files,
--      contacts or assistant index, and free text purged after handover.
--   d. The trace: objectives, KPIs, findings, recommendations, actions,
--      evidence and reviews as one tree, read with the caller's rights.
--   e. "Since your last visit": the same change list a meeting agenda uses,
--      from when the person last opened the project.

-- ------------------------------------------------- a. verified on whose evidence

-- The basis of an action's verification: the sources of what the accepting
-- review covered (the submissions it names, or else those of its round;
-- with no evidence at all, the round's progress updates).
--   client_evidence      everything came from the client in Selah
--   consultant_recorded  everything was recorded by a consultant for the client
--   mixed                some of each
--   internal             an internal project (staff's own work)
-- Null when the action is not verified or nothing was recorded.
-- Runs with the caller's rights.
CREATE FUNCTION app_verified_basis(aid uuid) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH acc AS (
    SELECT r.created_at, r.evidence_submission_ids,
      coalesce((SELECT max(r2.created_at) FROM reviews r2 WHERE r2.action_id = aid AND r2.created_at < r.created_at), '-infinity') AS round_start
    FROM actions a JOIN reviews r ON r.action_id = a.id AND r.outcome = 'accept'
    WHERE a.id = aid AND a.status = 'verified_complete'
    ORDER BY r.created_at DESC, r.id DESC LIMIT 1
  ),
  covered AS (
    SELECT es.source FROM acc JOIN evidence_submissions es ON es.action_id = aid
      AND CASE WHEN cardinality(acc.evidence_submission_ids) > 0 THEN es.id = ANY (acc.evidence_submission_ids)
               ELSE es.created_at > acc.round_start AND es.created_at <= acc.created_at END
  ),
  basis AS (
    SELECT source FROM covered
    UNION ALL
    SELECT pu.source FROM acc JOIN progress_updates pu
      ON pu.action_id = aid AND pu.created_at > acc.round_start AND pu.created_at <= acc.created_at
    WHERE NOT EXISTS (SELECT 1 FROM covered)
  )
  SELECT CASE
    WHEN count(*) = 0 THEN NULL
    WHEN bool_and(source = 'internal') THEN 'internal'
    WHEN bool_and(source = 'consultant_recorded') THEN 'consultant_recorded'
    WHEN bool_and(source <> 'consultant_recorded') THEN 'client_evidence'
    ELSE 'mixed'
  END
  FROM basis
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_verified_basis(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_verified_basis(uuid) TO selah_app;
--> statement-breakpoint
-- As in 0015, plus verified actions split by basis (snapshots pick the new
-- columns up on their own).
CREATE OR REPLACE VIEW v_project_metrics WITH (security_invoker = true) AS
  WITH a AS (
    SELECT a.*,
      a.status <> 'verified_complete' AND a.closure_outcome IS NULL AS is_open,
      (SELECT max(r.created_at) FROM reviews r WHERE r.action_id = a.id AND r.outcome = 'accept') AS verified_at,
      greatest(a.updated_at,
        (SELECT max(pu.created_at) FROM progress_updates pu WHERE pu.action_id = a.id),
        (SELECT max(es.created_at) FROM evidence_submissions es WHERE es.action_id = a.id)) AS last_touched,
      CASE WHEN a.status = 'verified_complete' THEN app_verified_basis(a.id) END AS basis
    FROM actions a WHERE a.status <> 'draft'
  )
  SELECT
    p.id AS project_id,
    p.org_id,
    count(a.id)::int AS actions_total,
    count(a.id) FILTER (WHERE a.status = 'verified_complete')::int AS verified,
    count(a.id) FILTER (WHERE a.status = 'awaiting_review')::int AS awaiting_review,
    count(a.id) FILTER (WHERE a.status = 'blocked')::int AS blocked,
    count(a.id) FILTER (WHERE a.is_open AND a.due_date < (now() AT TIME ZONE 'Asia/Riyadh')::date)::int AS overdue,
    round(100.0 * count(a.id) FILTER (
        WHERE a.status = 'verified_complete' AND (a.verified_at AT TIME ZONE 'Asia/Riyadh')::date <= a.baseline_due_date)
      / nullif(count(a.id) FILTER (WHERE a.status = 'verified_complete' AND a.baseline_due_date IS NOT NULL), 0), 1) AS on_time_rate,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM now() - a.awaiting_review_at) / 86400)
      FILTER (WHERE a.status = 'awaiting_review'))::numeric, 1) AS median_days_awaiting_review,
    (SELECT count(*) FROM deadline_change_requests d WHERE d.project_id = p.id AND d.status = 'approved')::int AS deadline_slips,
    (SELECT round(100.0 * count(*) FILTER (WHERE r.outcome = 'revise') / nullif(count(*), 0), 1)
       FROM reviews r WHERE r.project_id = p.id) AS revision_rate,
    count(a.id) FILTER (WHERE a.is_open AND a.last_touched < now() - make_interval(days => app_stale_days(p.id)))::int AS stale_actions,
    count(a.id) FILTER (WHERE a.basis = 'client_evidence')::int AS verified_client_evidence,
    count(a.id) FILTER (WHERE a.basis = 'consultant_recorded')::int AS verified_consultant_recorded,
    count(a.id) FILTER (WHERE a.basis = 'mixed')::int AS verified_mixed
  FROM projects p LEFT JOIN a ON a.project_id = p.id
  GROUP BY p.id, p.org_id;
--> statement-breakpoint

-- ------------------------------------------------- c. minimal records

ALTER TABLE firm_settings ADD CONSTRAINT minimal_purge_days_range CHECK (minimal_purge_days BETWEEN 0 AND 3650);
--> statement-breakpoint
-- Only for consultant-managed clients, with an alias, set by the firm admin.
-- The alias replaces the name, so the client's name is not kept here. It is
-- switched on before anything is filed: contacts and files must not exist.
CREATE FUNCTION check_minimal_records() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE switched boolean := TG_OP = 'INSERT' OR NEW.minimal_records IS DISTINCT FROM OLD.minimal_records
  OR NEW.display_alias IS DISTINCT FROM OLD.display_alias;
BEGIN
  IF switched AND app_uid() IS NOT NULL AND app_role() IS DISTINCT FROM 'firm_admin' THEN
    RAISE EXCEPTION 'only the firm admin sets minimal records' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT NEW.minimal_records THEN
    RETURN NEW;
  END IF;
  IF NEW.engagement_mode IS DISTINCT FROM 'consultant_managed' THEN
    RAISE EXCEPTION 'minimal records are for clients the firm manages' USING ERRCODE = 'check_violation';
  END IF;
  IF nullif(trim(NEW.display_alias), '') IS NULL THEN
    RAISE EXCEPTION 'give the client an alias' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' OR NOT OLD.minimal_records THEN
    IF EXISTS (SELECT 1 FROM client_contacts c WHERE c.org_id = NEW.id) OR EXISTS (SELECT 1 FROM documents d WHERE d.org_id = NEW.id) THEN
      RAISE EXCEPTION 'remove the client''s contacts and files before switching to minimal records' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.display_alias := trim(NEW.display_alias);
  NEW.name := NEW.display_alias;
  NEW.name_ar := NEW.display_alias;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER minimal_records BEFORE INSERT OR UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION check_minimal_records();
--> statement-breakpoint
-- What a minimal-records client never has: files (so no evidence uploads),
-- contacts, assistant chunks, or an account as an action's owner (the
-- owner's name holds a job title instead).
CREATE FUNCTION refuse_minimal_records() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT coalesce((SELECT o.minimal_records FROM organizations o WHERE o.id = NEW.org_id), false) THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'actions' THEN
    IF NEW.owner_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'this client keeps minimal records: give the owner''s job title instead' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'this client keeps minimal records: no % here', CASE TG_TABLE_NAME
    WHEN 'documents' THEN 'files' WHEN 'client_contacts' THEN 'contacts' ELSE 'assistant index' END
    USING ERRCODE = 'check_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER minimal_records BEFORE INSERT ON documents FOR EACH ROW EXECUTE FUNCTION refuse_minimal_records();
--> statement-breakpoint
CREATE TRIGGER minimal_records BEFORE INSERT ON client_contacts FOR EACH ROW EXECUTE FUNCTION refuse_minimal_records();
--> statement-breakpoint
CREATE TRIGGER minimal_records BEFORE INSERT ON ai_chunks FOR EACH ROW EXECUTE FUNCTION refuse_minimal_records();
--> statement-breakpoint
CREATE TRIGGER minimal_records BEFORE INSERT OR UPDATE OF owner_user_id ON actions FOR EACH ROW EXECUTE FUNCTION refuse_minimal_records();
--> statement-breakpoint
-- Append-only tables stay append-only for the app. Only the purge job,
-- running as the schema owner with selah.purge set, may blank their text.
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('selah.purge', true) = 'on' AND current_user NOT IN ('selah_app', 'selah_auth') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
-- After handover plus firm_settings.minimal_purge_days, blank the free text
-- of a minimal-records client's progress updates, notes, meeting notes,
-- decisions and summaries. Statuses, dates, who and when are kept. Once per
-- project; run daily as the schema owner (npm run job:purge-minimal).
CREATE FUNCTION app_purge_minimal_records(today date) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  pid uuid;
  n integer := 0;
  gone constant text := '—';
BEGIN
  PERFORM set_config('selah.purge', 'on', true);
  FOR pid IN
    SELECT p.id FROM projects p
      JOIN organizations o ON o.id = p.org_id AND o.minimal_records
      LEFT JOIN firm_settings fs ON fs.org_id = p.firm_org_id
    WHERE p.handover_on IS NOT NULL AND p.minimal_purged_at IS NULL
      AND p.handover_on + coalesce(fs.minimal_purge_days, 90) <= today
  LOOP
    UPDATE progress_updates SET body = gone WHERE project_id = pid AND body <> gone;
    UPDATE action_notes SET body = gone WHERE project_id = pid AND body <> gone;
    UPDATE meeting_notes SET body = gone WHERE project_id = pid AND body <> gone;
    UPDATE meeting_decisions SET text = gone WHERE project_id = pid AND text <> gone;
    UPDATE meeting_summaries SET main_points_md = gone WHERE project_id = pid AND main_points_md <> gone;
    UPDATE projects SET minimal_purged_at = now() WHERE id = pid;
    n := n + 1;
  END LOOP;
  PERFORM set_config('selah.purge', 'off', true);
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_purge_minimal_records(date) FROM PUBLIC;
--> statement-breakpoint

-- ------------------------------------------------- d. the trace

-- One row per edge (node, its parent), read with the caller's rights, so a
-- hidden record (a firm-private finding, another department's action) and
-- every link to it are simply absent. Edges:
--   objective (root) <- kpi
--   finding (root) <- recommendation <- action <- evidence | review
--   kpi <- recommendation      the recommendation is meant to move the KPI
--   action <- action           the node supersedes its parent
-- A recommendation whose finding the caller cannot see is a root.
CREATE FUNCTION app_trace(pid uuid)
RETURNS TABLE (node_type text, node_id uuid, parent_type text, parent_id uuid, label text, state text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT 'objective', o.id, NULL, NULL::uuid, coalesce(o.title_ar, o.title_en), o.perspective::text
    FROM strategic_objectives o WHERE o.project_id = pid
  UNION ALL
  SELECT 'kpi', k.id, 'objective', o.id, coalesce(k.name_ar, k.name_en), CASE WHEN k.active THEN 'active' ELSE 'inactive' END
    FROM kpis k LEFT JOIN strategic_objectives o ON o.id = k.objective_id WHERE k.project_id = pid
  UNION ALL
  SELECT 'finding', f.id, NULL, NULL, f.title, NULL FROM findings f WHERE f.project_id = pid
  UNION ALL
  SELECT 'recommendation', r.id, CASE WHEN f.id IS NOT NULL THEN 'finding' END, f.id, r.title, r.priority::text
    FROM recommendations r LEFT JOIN findings f ON f.id = r.finding_id WHERE r.project_id = pid
  UNION ALL
  SELECT 'recommendation', r.id, 'kpi', k.id, r.title, r.priority::text
    FROM recommendation_kpis rk JOIN recommendations r ON r.id = rk.recommendation_id JOIN kpis k ON k.id = rk.kpi_id
    WHERE rk.project_id = pid
  UNION ALL
  SELECT 'action', a.id, CASE WHEN r.id IS NOT NULL THEN 'recommendation' END, r.id, a.title, a.status::text
    FROM actions a LEFT JOIN recommendations r ON r.id = a.recommendation_id WHERE a.project_id = pid
  UNION ALL
  SELECT 'action', n.id, 'action', old.id, n.title, n.status::text
    FROM actions old JOIN actions n ON n.id = old.superseded_by WHERE old.project_id = pid
  UNION ALL
  SELECT 'evidence', es.id, 'action', a.id, d.title, es.source::text
    FROM evidence_submissions es JOIN actions a ON a.id = es.action_id LEFT JOIN documents d ON d.id = es.document_id
    WHERE es.project_id = pid
  UNION ALL
  SELECT 'review', rv.id, 'action', a.id, NULL, rv.outcome::text
    FROM reviews rv JOIN actions a ON a.id = rv.action_id WHERE rv.project_id = pid
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_trace(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_trace(uuid) TO selah_app;
--> statement-breakpoint

-- ------------------------------------------------- e. since your last visit

-- Released actions that moved since a time: a status or plan change, a
-- progress update, evidence or a review. With the caller's rights.
CREATE FUNCTION app_changed_actions(pid uuid, since timestamptz)
RETURNS TABLE (action_id uuid, title text, status text, changed_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.title, a.status::text, c.at FROM actions a,
    LATERAL (SELECT greatest(a.updated_at,
      (SELECT max(pu.created_at) FROM progress_updates pu WHERE pu.action_id = a.id),
      (SELECT max(es.created_at) FROM evidence_submissions es WHERE es.action_id = a.id),
      (SELECT max(r.created_at) FROM reviews r WHERE r.action_id = a.id)) AS at) c
  WHERE a.project_id = pid AND a.status <> 'draft' AND c.at > since
  ORDER BY c.at DESC
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_changed_actions(uuid, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_changed_actions(uuid, timestamptz) TO selah_app;
--> statement-breakpoint
-- The agenda's "changed since the last meeting" now uses the same list.
CREATE OR REPLACE FUNCTION app_meeting_agenda(pid uuid, before timestamptz, lang text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  last_held timestamptz := (SELECT max(m.starts_at) FROM meetings m WHERE m.project_id = pid AND m.status = 'held' AND m.starts_at < before);
  out text := '';
  part text;
  en boolean := lang = 'en';
BEGIN
  SELECT string_agg('- ' || a.title || CASE WHEN en THEN ' (due ' ELSE ' (الاستحقاق ' END || a.due_date || ')', E'\n' ORDER BY a.due_date) INTO part FROM (
    SELECT title, due_date FROM actions
    WHERE project_id = pid AND due_date < today AND status::text NOT IN ('draft', 'verified_complete', 'closed')
    ORDER BY due_date LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Overdue\n' ELSE E'## متأخرة\n' END || part || E'\n\n'; END IF;
  SELECT string_agg('- ' || a.title, E'\n' ORDER BY a.title) INTO part FROM (
    SELECT title FROM actions WHERE project_id = pid AND status = 'awaiting_review' ORDER BY title LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Awaiting review\n' ELSE E'## بانتظار المراجعة\n' END || part || E'\n\n'; END IF;
  SELECT string_agg('- ' || a.title || coalesce(': ' || a.blocked_reason, ''), E'\n' ORDER BY a.title) INTO part FROM (
    SELECT title, blocked_reason FROM actions WHERE project_id = pid AND status = 'blocked' ORDER BY title LIMIT 20) a;
  IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Blocked\n' ELSE E'## متوقفة\n' END || part || E'\n\n'; END IF;
  IF last_held IS NOT NULL THEN
    SELECT string_agg('- ' || c.title || ' (' || c.status || ')', E'\n' ORDER BY c.title) INTO part FROM (
      SELECT * FROM app_changed_actions(pid, last_held) ORDER BY title LIMIT 20) c;
    IF part IS NOT NULL THEN out := out || CASE WHEN en THEN E'## Changed since the last meeting\n' ELSE E'## ما تغيّر منذ الاجتماع السابق\n' END || part || E'\n\n'; END IF;
  END IF;
  RETURN nullif(rtrim(out, E'\n'), '');
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON project_visits TO selah_app;
--> statement-breakpoint
ALTER TABLE project_visits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY own ON project_visits FOR ALL TO selah_app
  USING (user_id = app_uid() AND app_can_see_project(project_id))
  WITH CHECK (user_id = app_uid() AND app_can_see_project(project_id));
