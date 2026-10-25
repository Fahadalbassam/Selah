import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { assertAllowed, type Principal } from "@/authz";

/**
 * What waits on each colleague, for the firm admin's staffing view
 * (research-team.md §2, lifecycle gaps C.3): the reviews they could do and
 * how long the oldest has waited, second sign-offs waiting on them, and the
 * work due on the projects they work on. Counts from the work itself, by
 * name, never a score.
 *
 * Someone works on a project they are staffed on (observers not) and on
 * every project of a client they lead or deputise for; closed projects are
 * left out. A review is theirs to do unless they own the action, submitted
 * evidence in the round, or gave its first sign-off.
 */
export async function teamLoad(tx: Tx, principal: Principal) {
  assertAllowed(principal, "team_metrics.read", { type: "org_user", orgId: principal.orgId, firmOrgId: principal.orgId, projectId: null });
  const { rows } = await tx.execute<{
    user_id: string;
    backlog: number;
    oldest: Date | string | null;
    second: number;
    overdue: number;
    due7: number;
    due30: number;
    accepting: boolean;
  }>(sql`
    WITH staff AS (
      SELECT m.user_id FROM org_memberships m
      WHERE m.org_id = ${principal.orgId}::uuid AND m.active AND m.role IN ('firm_admin', 'consultant')
    ),
    reach AS (
      SELECT pm.user_id, p.id AS project_id FROM project_members pm JOIN projects p ON p.id = pm.project_id
      WHERE NOT pm.observer AND p.state::text <> 'closed' AND p.firm_org_id = ${principal.orgId}::uuid
      UNION
      SELECT ca.user_id, p.id FROM client_assignments ca
        JOIN projects p ON p.org_id = ca.client_org_id AND p.kind = 'client' AND p.state::text <> 'closed'
      WHERE (ca.is_lead OR ca.is_deputy) AND p.firm_org_id = ${principal.orgId}::uuid
    ),
    waiting AS (
      SELECT a.id, a.project_id, a.owner_user_id, a.awaiting_review_at, s.required, s.signed_by,
        coalesce((SELECT max(r.created_at) FROM reviews r WHERE r.action_id = a.id), '-infinity') AS since
      FROM actions a CROSS JOIN LATERAL app_second_review_state(a.id) s
      WHERE a.status = 'awaiting_review'
    ),
    mine AS (
      SELECT r.user_id, w.* FROM reach r JOIN waiting w ON w.project_id = r.project_id
      WHERE w.owner_user_id IS DISTINCT FROM r.user_id AND w.signed_by IS DISTINCT FROM r.user_id
        AND NOT EXISTS (
          SELECT 1 FROM evidence_submissions es
          WHERE es.action_id = w.id AND es.submitted_by = r.user_id AND es.created_at > w.since)
    ),
    due AS (
      SELECT r.user_id, a.due_date FROM reach r JOIN actions a ON a.project_id = r.project_id
      WHERE app_action_open(a.status) AND a.due_date IS NOT NULL
    )
    SELECT s.user_id,
      (SELECT count(*) FROM mine x WHERE x.user_id = s.user_id)::int AS backlog,
      (SELECT min(x.awaiting_review_at) FROM mine x WHERE x.user_id = s.user_id) AS oldest,
      (SELECT count(*) FROM mine x WHERE x.user_id = s.user_id AND x.required AND x.signed_by IS NOT NULL)::int AS second,
      (SELECT count(*) FROM due d WHERE d.user_id = s.user_id AND d.due_date < app_firm_today())::int AS overdue,
      (SELECT count(*) FROM due d WHERE d.user_id = s.user_id AND d.due_date BETWEEN app_firm_today() AND app_firm_today() + 7)::int AS due7,
      (SELECT count(*) FROM due d WHERE d.user_id = s.user_id AND d.due_date BETWEEN app_firm_today() AND app_firm_today() + 30)::int AS due30,
      coalesce((SELECT c.accepting_new_clients FROM consultant_profiles c WHERE c.user_id = s.user_id), true) AS accepting
    FROM staff s`);
  const now = Date.now();
  return new Map(
    rows.map((r) => {
      const oldest = r.oldest ? new Date(r.oldest) : null;
      return [
        r.user_id,
        {
          backlog: Number(r.backlog),
          oldestDays: oldest ? Math.max(0, Math.floor((now - oldest.getTime()) / 86_400_000)) : null,
          second: Number(r.second),
          overdue: Number(r.overdue),
          due7: Number(r.due7),
          due30: Number(r.due30),
          accepting: r.accepting,
        },
      ];
    }),
  );
}

export type TeamLoad = Awaited<ReturnType<typeof teamLoad>>;
