import "server-only";
import { and, asc, desc, eq, gt, gte, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  actions,
  activityEvents,
  documents,
  evidenceRequests,
  evidenceSubmissions,
  notifications,
  organizations,
  progressUpdates,
  projects,
  recommendations,
  reviews,
  riskAcceptances,
} from "@/db/schema";
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

export async function loadAction(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      action: actions,
      firmOrgId: projects.firmOrgId,
      projectKind: projects.kind,
      projectState: projects.state,
      engagementMode: organizations.engagementMode,
      label: recommendations.visibility,
    })
    .from(actions)
    .innerJoin(projects, eq(projects.id, actions.projectId))
    .innerJoin(recommendations, eq(recommendations.id, actions.recommendationId))
    .leftJoin(organizations, eq(organizations.id, actions.orgId))
    .where(eq(actions.id, id))
    .limit(1);
  if (!row) return null;
  const resource: Resource & { type: "action" } = {
    type: "action",
    id: row.action.id,
    orgId: row.action.orgId,
    firmOrgId: row.firmOrgId,
    projectId: row.action.projectId,
    projectKind: row.projectKind,
    projectState: row.projectState,
    engagementMode: row.engagementMode,
    createdBy: row.action.createdBy,
    assignees: row.action.ownerUserId ? [row.action.ownerUserId] : [],
    // An action takes its recommendation's label: a firm-only recommendation
    // keeps its actions firm-only (0006).
    visibility: row.label,
  };
  return { action: row.action, resource };
}

/** Who submitted evidence, or recorded progress for the client, since the action's last review (the round under review). */
export async function roundSubmitters(tx: Tx, actionId: string): Promise<string[]> {
  const [previous] = await tx
    .select({ at: reviews.createdAt })
    .from(reviews)
    .where(eq(reviews.actionId, actionId))
    .orderBy(desc(reviews.createdAt))
    .limit(1);
  const rows = await tx
    .selectDistinct({ userId: evidenceSubmissions.submittedBy })
    .from(evidenceSubmissions)
    .where(and(eq(evidenceSubmissions.actionId, actionId), previous ? gt(evidenceSubmissions.submittedAt, previous.at) : undefined));
  // Progress recorded on the client's behalf counts too (baseline: Engagement).
  const recorders = await tx
    .selectDistinct({ userId: progressUpdates.authorId })
    .from(progressUpdates)
    .where(
      and(
        eq(progressUpdates.actionId, actionId),
        eq(progressUpdates.source, "consultant_recorded"),
        previous ? gt(progressUpdates.createdAt, previous.at) : undefined,
      ),
    );
  return [...new Set([...rows, ...recorders].map((r) => r.userId))];
}

/** Load an action the user may read. Unknown and forbidden look the same (404). */
export async function getAction(tx: Tx, principal: Principal, id: string) {
  const loaded = await loadAction(tx, id);
  if (!loaded) throw new NotFoundError("action");
  assertAllowed(principal, "action.read", loaded.resource);
  return loaded.action;
}

export type ClosureOutcome = "partially_implemented" | "risk_accepted" | "not_applicable" | "superseded";

export interface TransitionInput {
  to: ActionStatus;
  /** Required when blocking, requesting a revision or reopening. */
  reason?: string;
  /** Required when closing. */
  closure?: { outcome: ClosureOutcome; note: string; supersededBy?: string };
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
  const decision = canTransition(principal, resource, from, input.to, await roundSubmitters(tx, id));
  if (!decision.allowed) {
    throw new ForbiddenError(transitionPermission(from, input.to) ?? "action.work", resource, decision.reason);
  }

  const patch: Partial<typeof actions.$inferInsert> = { status: input.to };

  if (input.to === "blocked") {
    if (!input.reason) throw new BadRequestError("a blocker needs a reason");
    patch.blockedReason = input.reason;
  }
  if (from === "blocked") patch.blockedReason = null;

  // Ending without verification. The database re-checks each rule
  // (baseline: Follow-through) and records who closed it.
  if (input.to === "closed") {
    const closure = input.closure;
    if (!closure) throw new BadRequestError("closing needs an outcome and a note");
    if (closure.outcome === "superseded" && !closure.supersededBy) throw new BadRequestError("name the action that replaces this one");
    if (closure.outcome !== "superseded" && closure.supersededBy) throw new BadRequestError("only a superseded action names a successor");
    if (closure.outcome === "risk_accepted") {
      // Signed since the last reopen; the database also checks the signer is still an admin or manager.
      const [signed] = await tx
        .select({ id: riskAcceptances.id })
        .from(riskAcceptances)
        .where(and(eq(riskAcceptances.actionId, id), action.reopenedAt ? gte(riskAcceptances.createdAt, action.reopenedAt) : undefined))
        .limit(1);
      if (!signed) throw new BadRequestError("the client has not signed a risk acceptance for this action");
    }
    patch.closureOutcome = closure.outcome;
    patch.closureNote = closure.note;
    patch.supersededBy = closure.supersededBy ?? null;
  }
  const reopening = from === "verified_complete" || from === "closed";
  if (reopening && !input.reason) throw new BadRequestError("reopening needs a reason");

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

  if (input.to === "verified_complete") {
    // Work that needs two sign-offs (F22): the first is recorded by
    // app_sign_off() and leaves the action waiting; only someone else's
    // accept verifies it. The database checks the same (check_second_review).
    const { rows } = await tx.execute<{ required: boolean; signed_by: string | null }>(
      sql`select required, signed_by from app_second_review_state(${id}::uuid)`,
    );
    const state = rows[0];
    if (state?.required && !state.signed_by) throw new BadRequestError("this work needs two sign-offs; sign off first");
    if (state?.required && state.signed_by === principal.userId) {
      throw new ForbiddenError("action.review", resource, "workflow:second-reviewer");
    }
  }

  if (input.to === "verified_complete" || input.to === "revision_requested") {
    if (input.to === "revision_requested" && !input.reason) throw new BadRequestError("a revision request needs a reason");
    // Record exactly what was reviewed: every submission since the previous
    // review, with each file's hash (stored files never change).
    const [previous] = await tx
      .select({ at: reviews.createdAt })
      .from(reviews)
      .where(eq(reviews.actionId, id))
      .orderBy(desc(reviews.createdAt))
      .limit(1);
    const seen = await tx
      .select({ id: evidenceSubmissions.id, sha256: documents.sha256 })
      .from(evidenceSubmissions)
      .innerJoin(documents, eq(documents.id, evidenceSubmissions.documentId))
      .where(
        and(eq(evidenceSubmissions.actionId, id), previous ? gt(evidenceSubmissions.submittedAt, previous.at) : undefined),
      )
      .orderBy(asc(evidenceSubmissions.submittedAt));
    await tx.insert(reviews).values({
      projectId: action.projectId,
      orgId: action.orgId,
      actionId: id,
      evidenceSubmissionId: seen.at(-1)?.id,
      evidenceSubmissionIds: seen.map((e) => e.id),
      evidenceSha256: seen.map((e) => e.sha256),
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

  // One submission, one decision (review M01): asking for a revision answers
  // the items still waiting with the same reason, so they don't keep offering
  // accept and not-accepted. Items already accepted stay accepted.
  if (input.to === "revision_requested") {
    await tx
      .update(evidenceRequests)
      .set({ status: "rejected", decisionNote: input.reason })
      .where(and(eq(evidenceRequests.actionId, id), eq(evidenceRequests.status, "submitted")));
  }

  await tx.insert(activityEvents).values({
    projectId: action.projectId,
    orgId: action.orgId,
    actorId: principal.userId,
    entityType: "action",
    entityId: id,
    event: "status_changed",
    fromState: from,
    toState: input.to,
    meta: input.closure || reopening ? { closure: input.closure, reason: reopening ? input.reason : undefined } : undefined,
  });

  if (action.ownerUserId && action.ownerUserId !== principal.userId) {
    await tx.insert(notifications).values({
      userId: action.ownerUserId,
      kind: `action.${input.to}`,
      entityType: "action",
      entityId: id,
    });
  }

  // Work waiting for review goes to the project's firm-side audience: the
  // client's lead and the staff on the project (an internal project's leads),
  // plus admins watching it (baseline: Staffed visibility).
  if (input.to === "awaiting_review") {
    const skip = `{${action.ownerUserId ?? ""}}`; // uuid[] literal: the owner was told above
    await tx.execute(sql`select app_notify_project_team(${id}::uuid, 'action.awaiting_review', ${skip}::uuid[])`);
  }

  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "action.transition",
    resourceType: "action",
    resourceId: id,
    outcome: "allow",
    meta: { from, to: input.to, outcome: input.closure?.outcome ?? null },
  });

  return { id, from, to: input.to };
}
