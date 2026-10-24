CREATE TABLE "pulse_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"met_agreement" integer NOT NULL,
	"responsive" integer NOT NULL,
	"self_reliant" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pulse_scores" CHECK (met_agreement BETWEEN 1 AND 5 AND responsive BETWEEN 1 AND 5 AND self_reliant BETWEEN 1 AND 5),
	CONSTRAINT "pulse_comment" CHECK (length(coalesce(comment, '')) <= 2000)
);
--> statement-breakpoint
ALTER TABLE "pulse_answers" ADD CONSTRAINT "pulse_answers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse_answers" ADD CONSTRAINT "pulse_answers_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pulse_answers_one" ON "pulse_answers" USING btree ("project_id","user_id");--> statement-breakpoint
-- ------------------------------------------------------- closing pulse
-- The closing pulse (F36; research: a three-question pulse, not an NPS
-- programme). When a client project closes, the client people who worked
-- on it are asked, in Selah and by mail: did the work meet what was agreed,
-- were the consultants responsive, can you carry on the work yourselves.
-- Each answers once, 1 to 5, with an optional comment, and may change the
-- answer while the pulse is open (30 days from closing; lib/pulse.ts). It is
-- optional and blocks nothing. Answers are the firm's: the firm admin and
-- the client's lead read them all, a client person only their own. A score
-- of 2 or less tells the client's lead (and deputy).
--
-- Not frozen by check_project_open(): the pulse is answered after closing.
CREATE FUNCTION app_pulse_days() RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$ SELECT 30 $$;
--> statement-breakpoint
CREATE FUNCTION app_pulse_low() RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$ SELECT 2 $$;
--> statement-breakpoint
-- Who is asked: the client's admins and managers staffed on the project, and
-- the sponsor and the coordinator when they can open it (a manager must be
-- staffed to see a project; an admin sees every one). Active accounts only.
-- More than the sponsor, whose answers alone lean positive.
CREATE FUNCTION app_pulse_invitees(pid uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT m.user_id FROM projects p
    JOIN org_memberships m ON m.org_id = p.org_id AND m.active AND m.role IN ('client_admin', 'client_manager')
  WHERE p.id = pid AND p.kind = 'client' AND (
    EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = pid AND pm.user_id = m.user_id)
    OR (m.role = 'client_admin' AND EXISTS (
      SELECT 1 FROM project_client_roles r WHERE r.project_id = pid AND r.user_id = m.user_id AND r.role IN ('sponsor', 'coordinator'))))
$$;
--> statement-breakpoint
-- Until when a closed client project's pulse takes answers (null: not open).
CREATE FUNCTION app_pulse_until(pid uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.closed_at + make_interval(days => app_pulse_days())
  FROM projects p JOIN project_closures c ON c.id = app_open_closure(p.id)
  WHERE p.id = pid AND p.kind = 'client' AND p.state::text = 'closed' AND c.closed_at IS NOT NULL
$$;
--> statement-breakpoint
-- Whether the caller is asked and may answer (or change their answer) now.
CREATE FUNCTION app_can_answer_pulse(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = pid AND app_org_kind() = 'client' AND p.org_id = app_org() AND app_is_active_client(p.org_id)
      AND app_can_see_project(pid) AND app_uid() IN (SELECT app_pulse_invitees(pid))
      AND now() < app_pulse_until(pid)
  )
$$;
--> statement-breakpoint
-- Who reads every answer: the firm admin, and the client's lead (or deputy).
CREATE FUNCTION app_can_read_pulse(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = pid AND p.kind = 'client' AND app_org_kind() = 'firm' AND p.firm_org_id = app_org()
      AND app_can_see_project(pid) AND (app_role() = 'firm_admin' OR app_is_client_lead(p.org_id))
  )
$$;
--> statement-breakpoint
-- How many are asked, for those who read the answers.
CREATE FUNCTION app_pulse_invited(pid uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN app_can_read_pulse(pid) THEN (SELECT count(*)::integer FROM app_pulse_invitees(pid)) END
$$;
--> statement-breakpoint
-- Answer, or change the answer while the pulse is open.
CREATE FUNCTION app_answer_pulse(pid uuid, p_met integer, p_responsive integer, p_self integer, p_comment text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  p projects;
  was_low boolean;
  row_id uuid;
BEGIN
  SELECT * INTO p FROM projects WHERE id = pid;
  IF p.id IS NULL OR NOT app_can_see_project(pid) THEN
    RAISE EXCEPTION 'no such project' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT app_can_answer_pulse(pid) THEN
    RAISE EXCEPTION 'this pulse is not open to you' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_met IS NULL OR p_responsive IS NULL OR p_self IS NULL
     OR p_met NOT BETWEEN 1 AND 5 OR p_responsive NOT BETWEEN 1 AND 5 OR p_self NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'answer each question from 1 to 5' USING ERRCODE = 'check_violation';
  END IF;
  IF length(coalesce(p_comment, '')) > 2000 THEN
    RAISE EXCEPTION 'the comment is too long' USING ERRCODE = 'check_violation';
  END IF;
  SELECT least(a.met_agreement, a.responsive, a.self_reliant) <= app_pulse_low() INTO was_low
    FROM pulse_answers a WHERE a.project_id = pid AND a.user_id = app_uid();
  INSERT INTO pulse_answers (project_id, org_id, user_id, met_agreement, responsive, self_reliant, comment)
  VALUES (pid, p.org_id, app_uid(), p_met, p_responsive, p_self, nullif(btrim(p_comment), ''))
  ON CONFLICT (project_id, user_id) DO UPDATE SET met_agreement = EXCLUDED.met_agreement, responsive = EXCLUDED.responsive,
    self_reliant = EXCLUDED.self_reliant, comment = EXCLUDED.comment, updated_at = now()
  RETURNING id INTO row_id;
  -- A score that turns low tells the client's lead; the deputy gets a copy (copy_lead_alert).
  IF least(p_met, p_responsive, p_self) <= app_pulse_low() AND NOT coalesce(was_low, false) THEN
    INSERT INTO notifications (user_id, kind, entity_type, entity_id)
      SELECT ca.user_id, 'pulse.low_score', 'project', pid FROM client_assignments ca
        JOIN org_memberships m ON m.user_id = ca.user_id AND m.org_id = p.firm_org_id AND m.active
      WHERE ca.client_org_id = p.org_id AND ca.is_lead;
  END IF;
  RETURN row_id;
END $$;
--> statement-breakpoint
-- Closing a client project asks for the pulse, in Selah and by mail.
CREATE FUNCTION ask_pulse() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO notifications (user_id, kind, entity_type, entity_id)
    SELECT u, 'pulse.requested', 'project', NEW.id FROM app_pulse_invitees(NEW.id) u
    WHERE NOT EXISTS (SELECT 1 FROM pulse_answers a WHERE a.project_id = NEW.id AND a.user_id = u);
  INSERT INTO outbound_emails (to_email, kind, link)
    SELECT x.email, 'pulse.requested', '/projects/' || NEW.id || '?tab=closing' FROM app_pulse_invitees(NEW.id) u
      JOIN "user" x ON x.id = u
    WHERE app_can_reset_password(u)
      AND NOT EXISTS (SELECT 1 FROM pulse_answers a WHERE a.project_id = NEW.id AND a.user_id = u);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER ask_pulse AFTER UPDATE OF state ON projects FOR EACH ROW
  WHEN (NEW.state::text = 'closed' AND OLD.state::text <> 'closed' AND NEW.kind = 'client')
  EXECUTE FUNCTION ask_pulse();
--> statement-breakpoint
ALTER TABLE pulse_answers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON pulse_answers TO selah_app;
--> statement-breakpoint
-- A client person reads their own answer; the firm admin and the client's lead read all.
CREATE POLICY pulse_read ON pulse_answers FOR SELECT TO selah_app
  USING (user_id = app_uid() OR app_can_read_pulse(project_id));
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_pulse_days(), app_pulse_low(), app_pulse_invitees(uuid), app_pulse_until(uuid), app_can_answer_pulse(uuid),
  app_can_read_pulse(uuid), app_pulse_invited(uuid), app_answer_pulse(uuid, integer, integer, integer, text), ask_pulse() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_pulse_days(), app_pulse_low(), app_pulse_until(uuid), app_can_answer_pulse(uuid), app_can_read_pulse(uuid),
  app_pulse_invited(uuid), app_answer_pulse(uuid, integer, integer, integer, text) TO selah_app;
--> statement-breakpoint
-- The pulse mail is work mail: it waits for the reader's sending hours.
ALTER TABLE outbound_emails DROP CONSTRAINT outbound_kind;
--> statement-breakpoint
ALTER TABLE outbound_emails ADD CONSTRAINT outbound_kind CHECK (kind IN (
  'invitation', 'email_change.confirm', 'email_change.notice', 'access_review.due',
  'meeting.invite', 'meeting.cancel', 'password_reset', 'password_reset.notice', 'two_factor.reset',
  'inquiry.new', 'inquiry.received', 'inquiry.declined', 'action.assigned', 'action.revision_requested',
  'action.verified_complete', 'evidence.requested', 'action.commented', 'action.mentioned', 'follow_up.digest', 'client.archived',
  'pulse.requested'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_work_mail_kinds() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
  SELECT app_update_mail_kinds() || ARRAY['follow_up.digest', 'access_review.due', 'inquiry.new', 'pulse.requested']
$$;
--> statement-breakpoint
-- A low pulse score is a lead alert: the deputy gets it too.
CREATE OR REPLACE FUNCTION app_lead_alert_kind(k text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT k LIKE 'follow\_up.%' OR k LIKE 'info\_request.%' OR k IN ('project.client_quiet', 'report.pack_drafted', 'pulse.low_score')
$$;