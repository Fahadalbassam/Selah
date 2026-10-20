import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  actionNotes,
  activityEvents,
  deadlineChangeRequests,
  evidenceRequests,
  notifications,
  reports,
  riskAcceptances,
  user,
} from "@/db/schema";
import { assertAllowed, type Principal, type Resource } from "@/authz";
import { firmToday } from "@/lib/dates";
import { BadRequestError, ConflictError, NotFoundError } from "@/server/errors";
import { loadAction } from "./actions";
import { audit } from "./audit";
import { loadProject } from "./staffing";

// What happens after the report is handed over: the evidence list for each
// action, the client's signed risk acceptances, the firm's own notes,
// deadline change requests, and the implementation progress. The database holds
// the same rules (drizzle/0011_follow_through_rules.sql); these checks give
// clear errors and keep the audit trail.

const isoDate = (d: Date | string) => (typeof d === "string" ? d : d.toISOString().slice(0, 10));

/** Load an action the user may read, and a resource for its child records. */
async function actionFor(tx: Tx, principal: Principal, actionId: string, type: Resource["type"]) {
  const loaded = await loadAction(tx, actionId);
  if (!loaded) throw new NotFoundError("action");
  assertAllowed(principal, "action.read", loaded.resource);
  return { action: loaded.action, resource: { ...loaded.resource, type, id: undefined } as Resource };
}

async function notify(tx: Tx, userId: string | null, principal: Principal, kind: string, actionId: string) {
  if (!userId || userId === principal.userId) return;
  await tx.insert(notifications).values({ userId, kind, entityType: "action", entityId: actionId });
}

async function activity(
  tx: Tx,
  principal: Principal,
  a: { projectId: string; orgId: string; id: string },
  event: string,
  meta = {},
) {
  await tx.insert(activityEvents).values({
    projectId: a.projectId,
    orgId: a.orgId,
    actorId: principal.userId,
    entityType: "action",
    entityId: a.id,
    event,
    meta,
  });
}

// ------------------------------------------------------- evidence lists

export async function listEvidenceRequests(tx: Tx, principal: Principal, actionId: string) {
  const { resource } = await actionFor(tx, principal, actionId, "evidence_request");
  assertAllowed(principal, "evidence_request.read", resource);
  return tx
    .select({
      id: evidenceRequests.id,
      title: evidenceRequests.title,
      description: evidenceRequests.description,
      dueDate: evidenceRequests.dueDate,
      status: evidenceRequests.status,
      decisionNote: evidenceRequests.decisionNote,
      decidedAt: evidenceRequests.decidedAt,
    })
    .from(evidenceRequests)
    .where(eq(evidenceRequests.actionId, actionId))
    .orderBy(asc(evidenceRequests.createdAt));
}

export async function addEvidenceRequest(
  tx: Tx,
  principal: Principal,
  actionId: string,
  input: { title: string; description?: string; dueDate?: string },
) {
  const { action, resource } = await actionFor(tx, principal, actionId, "evidence_request");
  assertAllowed(principal, "evidence_request.manage", resource);
  if (action.status === "verified_complete" || action.status === "closed") throw new BadRequestError("this action is finished");
  const [row] = await tx
    .insert(evidenceRequests)
    .values({ projectId: action.projectId, orgId: action.orgId, actionId, ...input, createdBy: principal.userId })
    .returning({ id: evidenceRequests.id });
  await activity(tx, principal, action, "evidence_requested", { title: input.title });
  await notify(tx, action.ownerUserId, principal, "evidence.requested", actionId);
  return row!;
}

export type EvidenceRequestDecision = "accepted" | "rejected" | "waived" | "open";

/** Accept, reject or waive an item; "open" asks again after a rejection. */
export async function decideEvidenceRequest(
  tx: Tx,
  principal: Principal,
  requestId: string,
  input: { status: EvidenceRequestDecision; note?: string },
) {
  const [item] = await tx.select().from(evidenceRequests).where(eq(evidenceRequests.id, requestId)).limit(1);
  if (!item) throw new NotFoundError("evidence request");
  const { action, resource } = await actionFor(tx, principal, item.actionId, "evidence_request");
  assertAllowed(principal, "evidence_request.manage", resource);
  if ((input.status === "rejected" || input.status === "waived") && !input.note) {
    throw new BadRequestError("say why the item was rejected or waived");
  }
  const allowed: Record<EvidenceRequestDecision, string[]> = {
    accepted: ["submitted"],
    rejected: ["submitted"],
    waived: ["open", "submitted", "rejected"],
    open: ["rejected"],
  };
  if (!allowed[input.status].includes(item.status)) throw new ConflictError(`the item is ${item.status}`);
  await tx
    .update(evidenceRequests)
    .set({ status: input.status, decisionNote: input.note ?? null })
    .where(and(eq(evidenceRequests.id, requestId), eq(evidenceRequests.status, item.status)));
  await activity(tx, principal, action, `evidence_request_${input.status}`, { requestId });
  await notify(tx, action.ownerUserId, principal, `evidence_request.${input.status}`, action.id);
  return { id: requestId, status: input.status };
}

// ---------------------------------------------------- risk acceptances

/** A client admin or manager signs that they accept the risk of not acting. */
export async function signRiskAcceptance(tx: Tx, principal: Principal, actionId: string, input: { statement: string }) {
  const { action, resource } = await actionFor(tx, principal, actionId, "risk_acceptance");
  assertAllowed(principal, "risk.accept", resource);
  if (action.status === "verified_complete" || action.status === "closed") throw new BadRequestError("this action is finished");
  const [row] = await tx
    .insert(riskAcceptances)
    .values({
      projectId: action.projectId,
      orgId: action.orgId,
      actionId,
      acceptedBy: principal.userId,
      statement: input.statement,
    })
    .returning({ id: riskAcceptances.id });
  await activity(tx, principal, action, "risk_accepted");
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "risk.accept",
    resourceType: "action",
    resourceId: actionId,
    outcome: "allow",
  });
  await tx.execute(sql`select app_notify_project_team(${actionId}::uuid, 'risk.accepted', '{}'::uuid[])`);
  return row!;
}

export async function listRiskAcceptances(tx: Tx, principal: Principal, actionId: string) {
  await actionFor(tx, principal, actionId, "risk_acceptance");
  return tx
    .select({ id: riskAcceptances.id, statement: riskAcceptances.statement, by: user.name, at: riskAcceptances.createdAt })
    .from(riskAcceptances)
    .innerJoin(user, eq(user.id, riskAcceptances.acceptedBy))
    .where(eq(riskAcceptances.actionId, actionId))
    .orderBy(asc(riskAcceptances.createdAt));
}

// --------------------------------------------------- firm notes

export async function listActionNotes(tx: Tx, principal: Principal, actionId: string) {
  const { resource } = await actionFor(tx, principal, actionId, "action_note");
  assertAllowed(principal, "action_note.read", resource);
  return tx
    .select({ id: actionNotes.id, body: actionNotes.body, author: user.name, at: actionNotes.createdAt })
    .from(actionNotes)
    .innerJoin(user, eq(user.id, actionNotes.authorId))
    .where(eq(actionNotes.actionId, actionId))
    .orderBy(desc(actionNotes.createdAt));
}

export async function addActionNote(tx: Tx, principal: Principal, actionId: string, input: { body: string }) {
  const { action, resource } = await actionFor(tx, principal, actionId, "action_note");
  assertAllowed(principal, "action_note.create", resource);
  const [row] = await tx
    .insert(actionNotes)
    .values({ projectId: action.projectId, orgId: action.orgId, actionId, authorId: principal.userId, body: input.body })
    .returning({ id: actionNotes.id });
  return row!;
}

// --------------------------------------------- deadline change requests

export async function requestDeadlineChange(
  tx: Tx,
  principal: Principal,
  actionId: string,
  input: { proposedDueDate: string; reason: string },
) {
  const { action, resource } = await actionFor(tx, principal, actionId, "deadline_request");
  assertAllowed(principal, "deadline_request.create", resource);
  if (action.status === "verified_complete" || action.status === "closed") throw new BadRequestError("this action is finished");
  if (action.dueDate && isoDate(action.dueDate) === input.proposedDueDate)
    throw new BadRequestError("that is already the due date");
  if (input.proposedDueDate < firmToday()) throw new BadRequestError("the new date is in the past");
  const [pending] = await tx
    .select({ id: deadlineChangeRequests.id })
    .from(deadlineChangeRequests)
    .where(and(eq(deadlineChangeRequests.actionId, actionId), eq(deadlineChangeRequests.status, "pending")))
    .limit(1);
  if (pending) throw new ConflictError("a request for this action is already waiting");
  const [row] = await tx
    .insert(deadlineChangeRequests)
    .values({ projectId: action.projectId, orgId: action.orgId, actionId, requestedBy: principal.userId, ...input })
    .returning({ id: deadlineChangeRequests.id });
  await activity(tx, principal, action, "deadline_change_requested", { proposedDueDate: input.proposedDueDate });
  await tx.execute(sql`select app_notify_project_team(${actionId}::uuid, 'deadline.requested', '{}'::uuid[])`);
  return row!;
}

/** The firm approves (the due date moves) or rejects. Decided once. */
export async function decideDeadlineChange(tx: Tx, principal: Principal, requestId: string, input: { approve: boolean }) {
  const [req] = await tx.select().from(deadlineChangeRequests).where(eq(deadlineChangeRequests.id, requestId)).limit(1);
  if (!req) throw new NotFoundError("deadline request");
  const { action, resource } = await actionFor(tx, principal, req.actionId, "deadline_request");
  assertAllowed(principal, "deadline_request.decide", resource);
  if (req.status !== "pending") throw new ConflictError("this request was already decided");
  const status = input.approve ? "approved" : "rejected";
  await tx.update(deadlineChangeRequests).set({ status }).where(eq(deadlineChangeRequests.id, requestId));
  await activity(tx, principal, action, `deadline_change_${status}`, {
    from: action.dueDate ? isoDate(action.dueDate) : null,
    to: req.proposedDueDate,
  });
  await notify(tx, req.requestedBy, principal, `deadline.${status}`, action.id);
  return { id: requestId, status };
}

// --------------------------------------------- implementation progress

export interface Progress {
  total: number;
  verified: number;
  partially: number;
  riskAccepted: number;
  notApplicable: number;
  superseded: number;
  open: number;
  overdue: number;
  /** Null when no released action still applies. */
  implementedPct: number | null;
}

/** The project's numbers, computed in Postgres under the caller's row-level security. */
export async function projectProgress(tx: Tx, principal: Principal, projectId: string, today?: string): Promise<Progress> {
  await loadProject(tx, principal, projectId);
  const day = today ?? firmToday();
  const { rows } = await tx.execute<Record<string, string | number | null>>(
    sql`select * from app_project_progress(${projectId}::uuid, ${day}::date)`,
  );
  const r = rows[0]!;
  return {
    total: Number(r.total),
    verified: Number(r.verified),
    partially: Number(r.partially),
    riskAccepted: Number(r.risk_accepted),
    notApplicable: Number(r.not_applicable),
    superseded: Number(r.superseded),
    open: Number(r.open),
    overdue: Number(r.overdue),
    implementedPct: r.implemented_pct === null ? null : Number(r.implemented_pct),
  };
}

/**
 * A periodic report: freeze the progress numbers for a period so later
 * reports can show the trend. Starts firm-private; sharing is a separate step.
 */
export async function snapshotReport(
  tx: Tx,
  principal: Principal,
  projectId: string,
  input: { title: string; periodStart: string; periodEnd: string; bodyMd?: string },
) {
  const { project, resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "report.write", { ...resource, type: "report" });
  if (input.periodEnd < input.periodStart) throw new BadRequestError("the period ends before it starts");
  const metrics = await projectProgress(tx, principal, projectId, input.periodEnd);
  const [row] = await tx
    .insert(reports)
    .values({
      projectId,
      orgId: project.orgId,
      title: input.title,
      bodyMd: input.bodyMd ?? "",
      generatedBy: principal.userId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      metrics,
    })
    .returning({ id: reports.id });
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "report.snapshot",
    resourceType: "report",
    resourceId: row!.id,
    outcome: "allow",
  });
  return { id: row!.id, metrics };
}
