import "server-only";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { actions, activityEvents, findings, notifications, recommendations } from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Resource } from "@/authz";
import { BadRequestError, ConflictError, NotFoundError } from "@/server/errors";
import { transitionAction } from "./actions";
import { audit } from "./audit";
import { checkRecommendationScope } from "./plan";
import { loadProject } from "./staffing";

// Correcting, releasing, withdrawing and deleting findings and
// recommendations (journey-map gap N1). The database holds the rules
// (migration recommendation_changes: check_releasable_change, check_releasable_delete,
// refuse_withdrawn_recommendation); these calls give clear errors, do the
// steps a withdrawal needs in order, and keep the activity history.
//
// - Correct: the firm edits the text while the record is live.
// - Release: a firm-only record is shared with the client, one way.
// - Withdraw: the firm takes a record back with a reason. It stays, marked,
//   and a recommendation's open actions are closed as not applicable.
// - Delete: only what the client never saw.

type Kind = "finding" | "recommendation";

const OPEN = ["draft", "verified_complete", "closed"] as const;

async function loadRecord(tx: Tx, principal: Principal, kind: Kind, id: string) {
  const table = kind === "finding" ? findings : recommendations;
  const [row] = await tx
    .select({
      id: table.id,
      projectId: table.projectId,
      orgId: table.orgId,
      visibility: table.visibility,
      createdBy: table.createdBy,
      releasedAt: table.releasedAt,
      withdrawnAt: table.withdrawnAt,
      // Recommendations only (F31); null for findings.
      departmentId: kind === "finding" ? sql<string | null>`null` : recommendations.departmentId,
      accountableUserId: kind === "finding" ? sql<string | null>`null` : recommendations.accountableUserId,
    })
    .from(table)
    .where(eq(table.id, id))
    .limit(1);
  // Row-level security hides a firm-only record from the client: unknown and hidden look the same.
  if (!row) throw new NotFoundError(kind);
  const { project, resource: projectResource } = await loadProject(tx, principal, row.projectId);
  const resource: Resource = {
    ...projectResource,
    type: kind,
    id: row.id,
    visibility: row.visibility,
    createdBy: row.createdBy,
  };
  assertAllowed(principal, `${kind}.read`, resource);
  return { row, project, resource };
}

async function record(tx: Tx, principal: Principal, kind: Kind, row: { id: string; projectId: string; orgId: string }, event: string, meta: Record<string, string | number | boolean | null> = {}, label: "shared" | "firm_private" = "shared") {
  await tx.insert(activityEvents).values({
    projectId: row.projectId,
    orgId: row.orgId,
    actorId: principal.userId,
    entityType: kind,
    entityId: row.id,
    event,
    // A firm-only record's history is firm-only too.
    visibility: label,
    meta,
  });
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: `${kind}.${event}`,
    resourceType: kind,
    resourceId: row.id,
    outcome: "allow",
    meta,
  });
}

function live(row: { withdrawnAt: Date | null }) {
  if (row.withdrawnAt) throw new ConflictError("it was withdrawn");
}

/** What the firm may do to each record: the same rules as the recommendation_changes migration, so the screen offers only what will work. */
export function recordControls(
  principal: Principal,
  resource: Resource,
  row: { visibility: string; releasedAt: Date | null; withdrawnAt: Date | null },
  blockers: { releasedActions?: number; liveRecommendations?: number },
) {
  const write = authorize(principal, `${resource.type as Kind}.write`, resource).allowed;
  const isLive = !row.withdrawnAt;
  const neverSeen = row.visibility === "firm_private" && !row.releasedAt;
  return {
    edit: write && isLive,
    release: write && isLive && row.visibility === "firm_private",
    withdraw: write && isLive && !neverSeen && (blockers.liveRecommendations ?? 0) === 0,
    delete: write && neverSeen && (blockers.releasedActions ?? 0) === 0 && (blockers.liveRecommendations ?? 0) === 0,
  };
}

export interface FindingChange {
  title?: string;
  description?: string | null;
}

/** Correct a live finding. */
export async function updateFinding(tx: Tx, principal: Principal, id: string, input: FindingChange) {
  const { row, resource } = await loadRecord(tx, principal, "finding", id);
  assertAllowed(principal, "finding.write", resource);
  live(row);
  await tx.update(findings).set(input).where(eq(findings.id, id));
  await record(tx, principal, "finding", row, "updated", { fields: Object.keys(input).join(",") }, row.visibility === "firm_private" ? "firm_private" : "shared");
  return { id };
}

export interface RecommendationChange {
  title?: string;
  findingId?: string | null;
  rationale?: string | null;
  targetOutcome?: string | null;
  priority?: "low" | "medium" | "high" | "critical";
  dueDate?: string | null;
  requiredEvidence?: string | null;
  /** Refiling under another department moves its actions with it; null makes it company-wide (F31). */
  departmentId?: string | null;
  accountableUserId?: string | null;
}

/** Correct a live recommendation. Its source and label are not edits: release changes the label. */
export async function updateRecommendation(tx: Tx, principal: Principal, id: string, input: RecommendationChange) {
  const { row, project, resource } = await loadRecord(tx, principal, "recommendation", id);
  assertAllowed(principal, "recommendation.write", resource);
  live(row);
  if (input.findingId) {
    const [f] = await tx
      .select({ projectId: findings.projectId, withdrawnAt: findings.withdrawnAt })
      .from(findings)
      .where(eq(findings.id, input.findingId))
      .limit(1);
    if (!f || f.projectId !== row.projectId) throw new BadRequestError("the finding is not in this project");
    if (f.withdrawnAt) throw new BadRequestError("that finding was withdrawn");
  }
  // Only what changes is checked: a department switched off since keeps what is already filed under it.
  const refiled = input.departmentId !== undefined && input.departmentId !== row.departmentId;
  const reassigned = input.accountableUserId !== undefined && input.accountableUserId !== row.accountableUserId;
  await checkRecommendationScope(tx, project, {
    departmentId: refiled ? input.departmentId : undefined,
    accountableUserId: reassigned ? input.accountableUserId : undefined,
  });
  await tx.update(recommendations).set(input).where(eq(recommendations.id, id));
  await record(tx, principal, "recommendation", row, "updated", { fields: Object.keys(input).join(",") }, row.visibility === "firm_private" ? "firm_private" : "shared");
  // A newly accountable person hears of it, as when it is added.
  if (reassigned && input.accountableUserId && row.visibility === "shared" && input.accountableUserId !== principal.userId) {
    await tx.insert(notifications).values({ userId: input.accountableUserId, kind: "recommendation.accountable", entityType: "project", entityId: row.projectId });
  }
  return { id };
}

/** Share a firm-only record with the client. One way: the client may have read it since. */
export async function releaseRecord(tx: Tx, principal: Principal, kind: Kind, id: string) {
  const { row, resource } = await loadRecord(tx, principal, kind, id);
  assertAllowed(principal, `${kind}.write`, resource);
  live(row);
  if (row.visibility !== "firm_private") throw new ConflictError("it is already shared");
  const table = kind === "finding" ? findings : recommendations;
  await tx.update(table).set({ visibility: "shared" }).where(eq(table.id, id));
  await record(tx, principal, kind, row, "released");
  // The client now answers it (F10): its admins, and the sponsor in a full engagement, are told.
  if (kind === "recommendation") await tx.execute(sql`select app_notify_recommendation(${id}::uuid, 'recommendation.released')`);
  return { id };
}

/**
 * Take a record back, with the reason. A recommendation's draft actions are
 * deleted and its open ones closed as not applicable (their owners are told,
 * as for any closure); verified and closed ones stay as they are. A finding
 * is withdrawn once no live recommendation answers it.
 */
export async function withdrawRecord(tx: Tx, principal: Principal, kind: Kind, id: string, input: { reason: string }) {
  const { row, resource } = await loadRecord(tx, principal, kind, id);
  assertAllowed(principal, `${kind}.write`, resource);
  live(row);
  if (row.visibility === "firm_private" && !row.releasedAt) {
    // The client never saw it: there is nothing to keep on record.
    throw new ConflictError("a record the client never saw is deleted, not withdrawn");
  }
  let closed = 0;
  let deleted = 0;
  if (kind === "recommendation") {
    const drafts = await tx
      .delete(actions)
      .where(and(eq(actions.recommendationId, id), eq(actions.status, "draft")))
      .returning({ id: actions.id });
    deleted = drafts.length;
    const open = await tx
      .select({ id: actions.id })
      .from(actions)
      .where(and(eq(actions.recommendationId, id), notInArray(actions.status, [...OPEN])));
    for (const a of open) {
      await transitionAction(tx, principal, a.id, { to: "closed", closure: { outcome: "not_applicable", note: input.reason } });
    }
    closed = open.length;
  } else {
    const [answered] = await tx
      .select({ id: recommendations.id })
      .from(recommendations)
      .where(and(eq(recommendations.findingId, id), isNull(recommendations.withdrawnAt)))
      .limit(1);
    if (answered) throw new ConflictError("withdraw the recommendations that answer this finding first");
  }
  const table = kind === "finding" ? findings : recommendations;
  await tx
    .update(table)
    .set({ withdrawnAt: new Date(), withdrawnBy: principal.userId, withdrawnReason: input.reason })
    .where(eq(table.id, id));
  await record(tx, principal, kind, row, "withdrawn", { closedActions: closed, deletedDrafts: deleted });
  return { id, closedActions: closed, deletedDrafts: deleted };
}

/** Delete a firm-only record the client never saw (a recommendation's draft actions go with it). */
export async function deleteRecord(tx: Tx, principal: Principal, kind: Kind, id: string) {
  const { row, resource } = await loadRecord(tx, principal, kind, id);
  assertAllowed(principal, `${kind}.write`, resource);
  if (row.visibility !== "firm_private" || row.releasedAt) throw new ConflictError("a released record is withdrawn, not deleted");
  if (kind === "recommendation") {
    const [released] = await tx
      .select({ id: actions.id })
      .from(actions)
      .where(and(eq(actions.recommendationId, id), inArray(actions.status, ["assigned", "in_progress", "blocked", "awaiting_review", "revision_requested", "verified_complete", "closed"])))
      .limit(1);
    if (released) throw new ConflictError("a recommendation with released actions is withdrawn, not deleted");
    await tx.delete(actions).where(eq(actions.recommendationId, id));
    await tx.delete(recommendations).where(eq(recommendations.id, id));
  } else {
    const [answered] = await tx.select({ id: recommendations.id }).from(recommendations).where(eq(recommendations.findingId, id)).limit(1);
    if (answered) throw new ConflictError("a finding with recommendations cannot be deleted");
    await tx.delete(findings).where(eq(findings.id, id));
  }
  // The record is gone; the security log keeps that it was deleted, and by whom.
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: `${kind}.deleted`,
    resourceType: kind,
    resourceId: id,
    outcome: "allow",
    meta: { projectId: row.projectId },
  });
  return { ok: true };
}
