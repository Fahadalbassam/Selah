import "server-only";
import { and, asc, desc, eq, ne, notInArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  actionNotes,
  activityEvents,
  deadlineChangeRequests,
  documents,
  evidenceRequests,
  evidenceSubmissions,
  metricSnapshots,
  notifications,
  reports,
  actions,
  riskAcceptances,
  user,
} from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Resource } from "@/authz";
import { firmToday } from "@/lib/dates";
import type { LadderAudience } from "@/lib/mail-choices";
import { BadRequestError, ConflictError, NotFoundError } from "@/server/errors";
import { loadAction } from "./actions";
import { audit } from "./audit";
import { loadProject } from "./staffing";

// What happens after the report is handed over: the evidence list for each
// action, the client's signed risk acceptances, the firm's own notes,
// deadline change requests, and the implementation progress. The database holds
// the same rules (baseline: Follow-through); these checks give
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

/**
 * The firm's decisions on an evidence item, and the states each may be made
 * from. check_evidence_request() allows the same moves (tests/db/rule-parity.test.ts).
 */
export const EVIDENCE_REQUEST_MOVES: Record<EvidenceRequestDecision, readonly string[]> = {
  accepted: ["submitted"],
  rejected: ["submitted"],
  waived: ["open", "submitted", "rejected"],
  open: ["rejected"],
};

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
  if (!EVIDENCE_REQUEST_MOVES[input.status].includes(item.status)) throw new ConflictError(`the item is ${item.status}`);
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

/**
 * How the action ended (when it was closed), the client's signed risk
 * acceptances, and what this user may do: sign one, or close the action
 * (with the actions in the project that could replace it).
 */
export async function actionClosure(tx: Tx, principal: Principal, actionId: string) {
  const { action, resource } = await actionFor(tx, principal, actionId, "risk_acceptance");
  const acceptances = await listRiskAcceptances(tx, principal, actionId);
  // Only a signature since the last reopen counts (baseline: Follow-through).
  const reopened = action.reopenedAt;
  const signed = acceptances.some((a) => !reopened || a.at >= reopened);
  const [closedBy] = action.closedBy ? await tx.select({ name: user.name }).from(user).where(eq(user.id, action.closedBy)) : [];
  const [successor] = action.supersededBy
    ? await tx.select({ id: actions.id, title: actions.title }).from(actions).where(eq(actions.id, action.supersededBy))
    : [];
  const canClose = !FINISHED.has(action.status) && authorize(principal, "action.close", { ...resource, type: "action" }).allowed;
  const replacements = canClose
    ? await tx
        .select({ id: actions.id, title: actions.title })
        .from(actions)
        .where(and(eq(actions.projectId, action.projectId), ne(actions.id, actionId), notInArray(actions.status, ["closed"])))
        .orderBy(asc(actions.title))
    : [];
  return {
    closure:
      action.status === "closed"
        ? {
            outcome: action.closureOutcome,
            note: action.closureNote,
            by: closedBy?.name ?? null,
            at: action.closedAt,
            supersededBy: successor ?? null,
          }
        : null,
    acceptances: acceptances.map((a) => ({ ...a, current: !reopened || a.at >= reopened })),
    signed,
    replacements,
    can: {
      sign: !FINISHED.has(action.status) && authorize(principal, "risk.accept", resource).allowed,
      close: canClose,
    },
  };
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

// ---------------------------------------------- on the action's page

const FINISHED = new Set(["verified_complete", "closed"]);

/**
 * The action's evidence list, with the files sent for each item, and its
 * deadline change requests, as this user may see them, plus what they may
 * do with them. The checks are the same as the routes'.
 */
export async function actionFollowThrough(tx: Tx, principal: Principal, actionId: string) {
  const { action, resource } = await actionFor(tx, principal, actionId, "evidence_request");
  const deadlineResource = { ...resource, type: "deadline_request" } as Resource;
  const finished = FINISHED.has(action.status);
  const readItems = authorize(principal, "evidence_request.read", resource).allowed;
  const items = readItems ? await listEvidenceRequests(tx, principal, actionId) : [];
  // Row-level security leaves out files this user can't see.
  const files = items.length
    ? await tx
        .select({
          requestId: evidenceSubmissions.evidenceRequestId,
          documentId: documents.id,
          title: documents.title,
          submittedAt: evidenceSubmissions.submittedAt,
        })
        .from(evidenceSubmissions)
        .innerJoin(documents, eq(documents.id, evidenceSubmissions.documentId))
        .where(eq(evidenceSubmissions.actionId, actionId))
        .orderBy(asc(evidenceSubmissions.submittedAt))
    : [];
  const deadlines = authorize(principal, "deadline_request.read", deadlineResource).allowed
    ? await tx
        .select({
          id: deadlineChangeRequests.id,
          proposedDueDate: deadlineChangeRequests.proposedDueDate,
          reason: deadlineChangeRequests.reason,
          status: deadlineChangeRequests.status,
          requestedBy: user.name,
          createdAt: deadlineChangeRequests.createdAt,
          decidedAt: deadlineChangeRequests.decidedAt,
        })
        .from(deadlineChangeRequests)
        .leftJoin(user, eq(user.id, deadlineChangeRequests.requestedBy))
        .where(eq(deadlineChangeRequests.actionId, actionId))
        .orderBy(desc(deadlineChangeRequests.createdAt))
    : [];
  return {
    items: items.map((i) => ({
      ...i,
      files: files
        .filter((f) => f.requestId === i.id)
        .map((f) => ({ documentId: f.documentId, title: f.title, submittedAt: f.submittedAt })),
    })),
    deadlines,
    can: {
      manageItems: !finished && authorize(principal, "evidence_request.manage", resource).allowed,
      requestDeadline:
        !finished &&
        !deadlines.some((d) => d.status === "pending") &&
        authorize(principal, "deadline_request.create", deadlineResource).allowed,
      decideDeadline: authorize(principal, "deadline_request.decide", deadlineResource).allowed,
    },
  };
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

function reportResource(resource: Resource, row: { id: string; visibility: Resource["visibility"]; generatedBy: string }): Resource {
  return { ...resource, type: "report", id: row.id, visibility: row.visibility, createdBy: row.generatedBy };
}

/** The project's reports, newest first. Clients see only the ones shared with them. */
export async function listReports(tx: Tx, principal: Principal, projectId: string) {
  const { resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "report.read", { ...resource, type: "report" });
  const rows = await tx
    .select({
      id: reports.id,
      title: reports.title,
      periodStart: reports.periodStart,
      periodEnd: reports.periodEnd,
      visibility: reports.visibility,
      sharedAt: reports.sharedAt,
      createdAt: reports.createdAt,
      generatedBy: reports.generatedBy,
      author: user.name,
    })
    .from(reports)
    .leftJoin(user, eq(user.id, reports.generatedBy))
    .where(eq(reports.projectId, projectId))
    .orderBy(desc(reports.createdAt));
  const visible = rows.filter((r) => authorize(principal, "report.read", reportResource(resource, r)).allowed);
  return {
    reports: visible.map(({ generatedBy, ...r }) => (void generatedBy, r)),
    can: { write: authorize(principal, "report.write", { ...resource, type: "report" }).allowed },
  };
}

/** One report with its frozen numbers. */
export async function getReport(tx: Tx, principal: Principal, id: string) {
  const [row] = await tx
    .select({
      id: reports.id,
      projectId: reports.projectId,
      title: reports.title,
      bodyMd: reports.bodyMd,
      periodStart: reports.periodStart,
      periodEnd: reports.periodEnd,
      visibility: reports.visibility,
      sharedAt: reports.sharedAt,
      createdAt: reports.createdAt,
      generatedBy: reports.generatedBy,
      author: user.name,
      metrics: reports.metrics,
    })
    .from(reports)
    .leftJoin(user, eq(user.id, reports.generatedBy))
    .where(eq(reports.id, id))
    .limit(1);
  if (!row) throw new NotFoundError("report");
  const { resource } = await loadProject(tx, principal, row.projectId);
  const rr = reportResource(resource, row);
  if (!authorize(principal, "report.read", rr).allowed) throw new NotFoundError("report");
  const { generatedBy, metrics, ...report } = row;
  void generatedBy;
  return {
    report: { ...report, metrics: metrics as Progress | null },
    can: { share: row.visibility !== "shared" && authorize(principal, "report.share", rr).allowed },
  };
}

/** Share a firm-private report with the client. One way: a shared report stays shared. */
export async function shareReport(tx: Tx, principal: Principal, id: string) {
  const [row] = await tx
    .select({ id: reports.id, projectId: reports.projectId, visibility: reports.visibility, generatedBy: reports.generatedBy })
    .from(reports)
    .where(eq(reports.id, id))
    .limit(1);
  if (!row) throw new NotFoundError("report");
  const { resource } = await loadProject(tx, principal, row.projectId);
  const rr = reportResource(resource, row);
  if (!authorize(principal, "report.read", rr).allowed) throw new NotFoundError("report");
  assertAllowed(principal, "report.share", rr);
  if (row.visibility === "shared") throw new ConflictError("the report is already shared");
  await tx.update(reports).set({ visibility: "shared", sharedAt: new Date() }).where(eq(reports.id, id));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "report.share",
    resourceType: "report",
    resourceId: id,
    outcome: "allow",
  });
  return { id, visibility: "shared" as const };
}

// -------------------------------------------- implementation metrics

/** The project's live metrics (docs/metrics.md) and its monthly history. */
export async function projectMetrics(tx: Tx, principal: Principal, projectId: string) {
  const { resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "metrics.read", resource);
  const { rows } = await tx.execute<Record<string, string | number | null>>(
    sql`select * from v_project_metrics where project_id = ${projectId}::uuid`,
  );
  const history = await tx
    .select({ metric: metricSnapshots.metric, value: metricSnapshots.value, asOf: metricSnapshots.asOf })
    .from(metricSnapshots)
    .where(eq(metricSnapshots.projectId, projectId))
    .orderBy(asc(metricSnapshots.asOf), asc(metricSnapshots.metric));
  const live = { ...rows[0] };
  delete live.project_id;
  delete live.org_id;
  return { live, history };
}

/** The firm admin's view of the team: each colleague's load (sorted by name), and team totals. */
export async function teamMetrics(tx: Tx, principal: Principal, since: string) {
  assertAllowed(principal, "team_metrics.read", { type: "org_user", orgId: principal.orgId, firmOrgId: principal.orgId, projectId: null });
  const workload = await tx.execute(sql`select * from app_team_workload()`);
  const totals = await tx.execute(sql`select * from app_team_metrics(${since}::date)`);
  return { workload: workload.rows, totals: totals.rows[0] };
}

export interface LadderStep {
  kind: "due_soon" | "overdue";
  level: number;
  onDate: string;
  audience: LadderAudience[];
  sentAt: Date | null;
}

/**
 * The reminder ladder of an action for its current due date (migration
 * 0016): each step, the day it fires, who it reaches and when it went out.
 * Empty when the action has no due date or nobody to remind.
 */
export async function actionLadder(tx: Tx, principal: Principal, actionId: string) {
  await loadAction(tx, actionId);
  const { rows } = await tx.execute<{
    kind: LadderStep["kind"];
    level: number;
    on_date: string;
    audience: LadderAudience[];
    sent_at: Date | string | null;
    running: boolean;
  }>(sql`SELECT kind, level, on_date::text, audience, sent_at, running FROM app_action_ladder(${actionId})`);
  return {
    running: rows[0]?.running ?? false,
    steps: rows.map(
      (r): LadderStep => ({
        kind: r.kind,
        level: r.level,
        onDate: r.on_date,
        audience: r.audience,
        sentAt: r.sent_at ? new Date(r.sent_at) : null,
      }),
    ),
  };
}

/** People whose mail isn't getting through, for firm staff (empty for anyone else). */
export async function mailFailing(tx: Tx, principal: Principal, userIds: string[]) {
  const ids = [...new Set(userIds)];
  if (principal.orgKind !== "firm" || ids.length === 0) return new Map<string, Date>();
  const { rows } = await tx.execute<{ user_id: string; since: Date | string }>(
    sql`SELECT user_id, since FROM app_mail_failing(${`{${ids.join(",")}}`}::uuid[])`,
  );
  return new Map(rows.map((r) => [r.user_id, new Date(r.since)]));
}
