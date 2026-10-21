import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { assertAllowed, type Principal } from "@/authz";
import { loadProject } from "./staffing";

// Read-only views over a project (drizzle/0027_insight_rules.sql). Both run
// with the caller's rights, so what they cannot see is simply not there.

export interface TraceRow {
  nodeType: "objective" | "kpi" | "finding" | "recommendation" | "action" | "evidence" | "review";
  nodeId: string;
  parentType: TraceRow["nodeType"] | null;
  parentId: string | null;
  label: string | null;
  state: string | null;
}

/**
 * The project as one tree: objective <- KPI, finding <- recommendation <-
 * action <- evidence | review, KPI <- recommendation (meant to move it),
 * and action <- action (the node supersedes its parent). One row per edge.
 */
export async function projectTrace(tx: Tx, principal: Principal, projectId: string) {
  const { resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "recommendation.read", { ...resource, type: "recommendation" });
  const { rows } = await tx.execute<{
    node_type: TraceRow["nodeType"];
    node_id: string;
    parent_type: TraceRow["nodeType"] | null;
    parent_id: string | null;
    label: string | null;
    state: string | null;
  }>(sql`select * from app_trace(${projectId}::uuid)`);
  return rows.map(
    (r): TraceRow => ({
      nodeType: r.node_type,
      nodeId: r.node_id,
      parentType: r.parent_type,
      parentId: r.parent_id,
      label: r.label,
      state: r.state,
    }),
  );
}

/**
 * Actions that moved since this person last opened the project (a status
 * or plan change, progress, evidence or a review). The first visit counts
 * the last 7 days. markVisited() moves the mark to now.
 */
export async function sinceLastVisit(tx: Tx, principal: Principal, projectId: string) {
  const { resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "action.read", { ...resource, type: "action" });
  const { rows: seen } = await tx.execute<{ at: string }>(
    sql`select last_seen_at as at from project_visits where user_id = ${principal.userId}::uuid and project_id = ${projectId}::uuid`,
  );
  const since = seen[0] ? new Date(seen[0].at) : new Date(Date.now() - 7 * 86_400_000);
  const { rows } = await tx.execute<{ action_id: string; title: string; status: string; changed_at: string }>(
    sql`select * from app_changed_actions(${projectId}::uuid, ${since.toISOString()}::timestamptz) limit 50`,
  );
  return {
    since,
    firstVisit: !seen[0],
    changes: rows.map((r) => ({ actionId: r.action_id, title: r.title, status: r.status, changedAt: new Date(r.changed_at) })),
  };
}

export async function markVisited(tx: Tx, principal: Principal, projectId: string) {
  await loadProject(tx, principal, projectId);
  await tx.execute(sql`
    insert into project_visits (user_id, project_id) values (${principal.userId}::uuid, ${projectId}::uuid)
    on conflict (user_id, project_id) do update set last_seen_at = now()`);
  return { ok: true };
}
