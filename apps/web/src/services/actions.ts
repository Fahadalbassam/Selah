import "server-only";
import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { actions, activityEvents, projects, evidenceSubmissions, notifications, reviews } from "@/db/schema";
import {
  assertAllowed,
  canTransition,
  ForbiddenError,
  transitionPermission,
  type ActionStatus,
  type Principal,
  type Resource,
} from "@/authz";
import { BadRequestError, ConflictError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";

async function loadAction(tx: Tx, id: string) {
  const [row] = await tx
    .select({ action: actions, firmOrgId: projects.firmOrgId })
    .from(actions)
    .innerJoin(projects, eq(projects.id, actions.projectId))
    .where(eq(actions.id, id))
    .limit(1);
  if (!row) return null;
  const resource: Resource & { type: "action" } = {
    type: "action",
    id: row.action.id,
    orgId: row.action.orgId,
    firmOrgId: row.firmOrgId,
    projectId: row.action.projectId,
    createdBy: row.action.createdBy,
    assignees: row.action.ownerUserId ? [row.action.ownerUserId] : [],
  };
  return { action: row.action, resource };
}

/** Load an action the user may read. Unknown and forbidden look the same (404). */
export async function getAction(tx: Tx, principal: Principal, id: string) {
  const loaded = await loadAction(tx, id);
  if (!loaded) throw new NotFoundError("action");
  assertAllowed(principal, "action.read", loaded.resource);
  return loaded.action;
}

export interface TransitionInput {
  to: ActionStatus;
  /** Required when blocking or requesting a revision. */
  reason?: string;
}

/**
 * Move an action to a new status. Who may make which move is decided by
 * canTransition(); the database trigger re-checks that the move exists and
 * that Verified Complete follows an accept review.
 */
export async function transitionAction(tx: Tx, principal: Principal, id: string, input: TransitionInput) {
  const loaded = await loadAction(tx, id);
  if (!loaded) throw new NotFoundError("action");
  const { action, resource } = loaded;
  assertAllowed(principal, "action.read", resource);

  const from = action.status;
  const decision = canTransition(principal, resource, from, input.to);
  if (!decision.allowed) {
    throw new ForbiddenError(transitionPermission(from, input.to) ?? "action.work", resource, decision.reason);
  }

  const patch: Partial<typeof actions.$inferInsert> = { status: input.to };

  if (input.to === "blocked") {
    if (!input.reason) throw new BadRequestError("a blocker needs a reason");
    patch.blockedReason = input.reason;
  }
  if (from === "blocked") patch.blockedReason = null;

  if (input.to === "awaiting_review") {
    // Submitting for review needs evidence submitted since the last review.
    const [lastReview] = await tx
      .select({ at: reviews.createdAt })
      .from(reviews)
      .where(eq(reviews.actionId, id))
      .orderBy(desc(reviews.createdAt))
      .limit(1);
    const [lastEvidence] = await tx
      .select({ at: evidenceSubmissions.submittedAt })
      .from(evidenceSubmissions)
      .where(eq(evidenceSubmissions.actionId, id))
      .orderBy(desc(evidenceSubmissions.submittedAt))
      .limit(1);
    if (!lastEvidence || (lastReview && lastEvidence.at <= lastReview.at)) {
      throw new BadRequestError("submit evidence before asking for review");
    }
  }

  if (input.to === "verified_complete" || input.to === "revision_requested") {
    if (input.to === "revision_requested" && !input.reason) throw new BadRequestError("a revision request needs a reason");
    const [evidence] = await tx
      .select({ id: evidenceSubmissions.id })
      .from(evidenceSubmissions)
      .where(eq(evidenceSubmissions.actionId, id))
      .orderBy(desc(evidenceSubmissions.submittedAt))
      .limit(1);
    await tx.insert(reviews).values({
      projectId: action.projectId,
      orgId: action.orgId,
      actionId: id,
      evidenceSubmissionId: evidence?.id,
      reviewerId: principal.userId,
      outcome: input.to === "verified_complete" ? "accept" : "revise",
      reason: input.reason,
    });
  }

  // Optimistic concurrency: only move from the status we checked.
  const updated = await tx
    .update(actions)
    .set(patch)
    .where(and(eq(actions.id, id), eq(actions.status, from)))
    .returning({ id: actions.id });
  if (updated.length === 0) throw new ConflictError("the action changed; reload and try again");

  await tx.insert(activityEvents).values({
    projectId: action.projectId,
    orgId: action.orgId,
    actorId: principal.userId,
    entityType: "action",
    entityId: id,
    event: "status_changed",
    fromState: from,
    toState: input.to,
  });

  if (action.ownerUserId && action.ownerUserId !== principal.userId) {
    await tx.insert(notifications).values({
      userId: action.ownerUserId,
      kind: `action.${input.to}`,
      entityType: "action",
      entityId: id,
    });
  }

  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "action.transition",
    resourceType: "action",
    resourceId: id,
    outcome: "allow",
    meta: { from, to: input.to },
  });

  return { id, from, to: input.to };
}
