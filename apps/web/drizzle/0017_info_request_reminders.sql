CREATE TABLE "info_request_reminders" (
	"request_id" uuid NOT NULL,
	"kind" "follow_up_kind" NOT NULL,
	"level" integer NOT NULL,
	"due_date" date NOT NULL,
	"recipients" uuid[] NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "info_request_reminders_request_id_kind_level_due_date_pk" PRIMARY KEY("request_id","kind","level","due_date")
);
--> statement-breakpoint
ALTER TABLE "info_request_reminders" ADD CONSTRAINT "info_request_reminders_request_id_info_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."info_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Nobody reads or writes the log through the app; the reminder job does.
ALTER TABLE info_request_reminders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Information requests still waiting on the client, due soon or overdue, with
-- who to tell (the daily job, as the schema owner). The project's own
-- reminder and escalation days apply, as for actions:
--   due soon and overdue: the item's owner, or the client admins when no
--     active owner is named;
--   overdue past the level 2 days: also the client managers on the project
--     and the firm-side team, who can chase it.
-- Each step is sent once per due date (info_request_reminders).
CREATE FUNCTION app_info_requests_due(today date)
RETURNS TABLE (request_id uuid, project_id uuid, kind follow_up_kind, level integer, due_date date, recipients uuid[])
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH waiting AS (
    SELECT r.id, r.project_id, r.org_id, r.due_date, p.firm_org_id, p.remind_days_before, p.escalate_level2_days,
           CASE WHEN EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = r.owner_user_id AND m.org_id = r.org_id AND m.active)
             THEN r.owner_user_id END AS owner,
           today - r.due_date AS days_over
    FROM info_requests r JOIN projects p ON p.id = r.project_id
    WHERE r.status = 'requested' AND r.due_date IS NOT NULL AND p.state IN ('planned', 'active')
  ),
  steps AS (
    SELECT w.*, 'due_soon'::follow_up_kind AS kind, 0 AS level FROM waiting w WHERE w.days_over BETWEEN -w.remind_days_before AND 0
    UNION ALL
    SELECT w.*, 'overdue'::follow_up_kind, CASE WHEN w.days_over >= w.escalate_level2_days THEN 2 ELSE 1 END
    FROM waiting w WHERE w.days_over > 0
  ),
  people AS (
    SELECT s.id, s.kind, s.level, s.owner AS u FROM steps s WHERE s.owner IS NOT NULL
    UNION
    SELECT s.id, s.kind, s.level, m.user_id FROM steps s
      JOIN org_memberships m ON m.org_id = s.org_id AND m.active AND m.role = 'client_admin'
      WHERE s.owner IS NULL
    UNION
    SELECT s.id, s.kind, s.level, pm.user_id FROM steps s
      JOIN project_members pm ON pm.project_id = s.project_id
      JOIN org_memberships m ON m.user_id = pm.user_id AND m.org_id = s.org_id AND m.active AND m.role = 'client_manager'
      WHERE s.level >= 2
    UNION
    -- the firm-side team: the client's lead consultant and the firm's people on the project
    SELECT s.id, s.kind, s.level, ca.user_id FROM steps s
      JOIN client_assignments ca ON ca.client_org_id = s.org_id AND ca.is_lead
      JOIN org_memberships m ON m.user_id = ca.user_id AND m.org_id = s.firm_org_id AND m.active
      WHERE s.level >= 2
    UNION
    SELECT s.id, s.kind, s.level, pm.user_id FROM steps s
      JOIN project_members pm ON pm.project_id = s.project_id
      JOIN org_memberships m ON m.user_id = pm.user_id AND m.org_id = s.firm_org_id AND m.active
      WHERE s.level >= 2
  )
  SELECT s.id, s.project_id, s.kind, s.level, s.due_date,
         coalesce((SELECT array_agg(DISTINCT p.u ORDER BY p.u) FROM people p WHERE p.id = s.id AND p.kind = s.kind AND p.level = s.level), '{}')
  FROM steps s
  WHERE NOT EXISTS (
    SELECT 1 FROM info_request_reminders l
    WHERE l.request_id = s.id AND l.kind = s.kind AND l.level = s.level AND l.due_date = s.due_date
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_info_requests_due(date) FROM PUBLIC;
