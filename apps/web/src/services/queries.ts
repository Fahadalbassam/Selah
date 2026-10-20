import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  actions,
  activityEvents,
  clientAssignments,
  documents,
  evidenceSubmissions,
  orgMemberships,
  organizations,
  progressUpdates,
  projectMembers,
  projects,
  recommendations,
  reviews,
  user,
} from "@/db/schema";
import { authorize, canTransition, TRANSITIONS, type ActionStatus, type Permission, type Principal, type Resource } from "@/authz";
import { loadAction, roundSubmitters } from "./actions";
import { firmToday } from "@/lib/dates";
import { NotFoundError } from "@/server/errors";

// Read services for the pages. Rows come back already filtered by RLS; each
// one is then checked with authorize(), so pages show exactly what the API
// would allow. Nothing here trusts the caller to filter.

function visible<T>(principal: Principal, permission: Permission, rows: T[], toResource: (row: T) => Resource): T[] {
  return rows.filter((row) => authorize(principal, permission, toResource(row)).allowed);
}

const OPEN_STATUSES = ["assigned", "in_progress", "blocked", "awaiting_review", "revision_requested"] as const;

export type ActionRow = Awaited<ReturnType<typeof listActions>>[number];

export async function getViewer(tx: Tx, principal: Principal) {
  const [row] = await tx
    .select({ name: user.name, email: user.email, orgName: organizations.name, orgNameAr: organizations.nameAr })
    .from(user)
    .innerJoin(orgMemberships, eq(orgMemberships.userId, user.id))
    .innerJoin(organizations, eq(organizations.id, orgMemberships.orgId))
    .where(eq(user.id, principal.userId))
    .limit(1);
  if (!row) throw new NotFoundError("user");
  return { ...row, role: principal.role, orgKind: principal.orgKind };
}

export async function listProjects(tx: Tx, principal: Principal) {
  const rows = await tx
    .select({
      id: projects.id,
      kind: projects.kind,
      title: projects.title,
      state: projects.state,
      endDate: projects.endDate,
      orgId: projects.orgId,
      firmOrgId: projects.firmOrgId,
      orgName: organizations.name,
      orgNameAr: organizations.nameAr,
    })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .orderBy(asc(projects.title));
  const allowed = visible(principal, "project.read", rows, (r) => ({
    type: "project",
    id: r.id,
    orgId: r.orgId,
    firmOrgId: r.firmOrgId,
    projectId: r.id,
  }));

  // Counts come from the actions this user may read, so an action owner
  // does not learn how many actions other people have.
  const readable = allowed.length ? await listActions(tx, principal) : [];
  return allowed.map((p) => {
    const mine = readable.filter((a) => a.projectId === p.id);
    return {
      ...p,
      actionCount: mine.length,
      verifiedCount: mine.filter((a) => a.status === "verified_complete").length,
      awaitingReviewCount: mine.filter((a) => a.status === "awaiting_review").length,
    };
  });
}

export async function listActions(tx: Tx, principal: Principal, filter: { projectId?: string; mineOnly?: boolean } = {}) {
  const conditions = [];
  if (filter.projectId) conditions.push(eq(actions.projectId, filter.projectId));
  if (filter.mineOnly) conditions.push(eq(actions.ownerUserId, principal.userId));
  const rows = await tx
    .select({
      id: actions.id,
      title: actions.title,
      status: actions.status,
      dueDate: actions.dueDate,
      ownerUserId: actions.ownerUserId,
      ownerName: user.name,
      createdBy: actions.createdBy,
      projectId: actions.projectId,
      orgId: actions.orgId,
      projectTitle: projects.title,
      projectKind: projects.kind,
      firmOrgId: projects.firmOrgId,
      recommendationId: actions.recommendationId,
      recommendationTitle: recommendations.title,
    })
    .from(actions)
    .innerJoin(projects, eq(projects.id, actions.projectId))
    .innerJoin(recommendations, eq(recommendations.id, actions.recommendationId))
    .leftJoin(user, eq(user.id, actions.ownerUserId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(actions.dueDate));
  return visible(principal, "action.read", rows, (r) => ({
    type: "action",
    id: r.id,
    orgId: r.orgId,
    firmOrgId: r.firmOrgId,
    projectId: r.projectId,
    createdBy: r.createdBy,
    assignees: r.ownerUserId ? [r.ownerUserId] : [],
  }));
}

export function isOverdue(row: Pick<ActionRow, "status" | "dueDate">, today = firmToday()) {
  return row.dueDate !== null && row.dueDate < today && (OPEN_STATUSES as readonly string[]).includes(row.status);
}

/**
 * Dashboard numbers, computed from the same rows the user can open.
 * Claimed, submitted and verified are kept apart on purpose: a client's
 * "in progress" or "submitted" is never counted as done.
 */
export async function dashboard(tx: Tx, principal: Principal) {
  const mineOnly = principal.role === "action_owner";
  const rows = await listActions(tx, principal, { mineOnly });
  const by = (s: string) => rows.filter((r) => r.status === s).length;
  const attention = rows.filter(
    (r) =>
      isOverdue(r) ||
      (principal.orgKind === "firm" ? r.status === "awaiting_review" : ["revision_requested", "blocked"].includes(r.status)),
  );
  return {
    total: rows.length,
    inProgress: by("in_progress") + by("assigned") + by("revision_requested"),
    blocked: by("blocked"),
    awaitingReview: by("awaiting_review"),
    verified: by("verified_complete"),
    overdue: rows.filter((r) => isOverdue(r)).length,
    attention: attention.slice(0, 10),
  };
}

export async function getProject(tx: Tx, principal: Principal, id: string) {
  const [p] = await tx
    .select({
      id: projects.id,
      kind: projects.kind,
      title: projects.title,
      description: projects.description,
      state: projects.state,
      startDate: projects.startDate,
      endDate: projects.endDate,
      orgId: projects.orgId,
      firmOrgId: projects.firmOrgId,
      orgName: organizations.name,
      orgNameAr: organizations.nameAr,
    })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .where(eq(projects.id, id))
    .limit(1);
  if (!p) throw new NotFoundError("project");
  const projectResource: Resource = { type: "project", id: p.id, orgId: p.orgId, firmOrgId: p.firmOrgId, projectId: p.id };
  if (!authorize(principal, "project.read", projectResource).allowed) throw new NotFoundError("project");

  const recs = await tx
    .select()
    .from(recommendations)
    .where(eq(recommendations.projectId, id))
    .orderBy(asc(recommendations.createdAt));
  const projectActions = await listActions(tx, principal, { projectId: id });
  const recResource = (r: (typeof recs)[number]): Resource => ({
    type: "recommendation",
    id: r.id,
    orgId: r.orgId,
    firmOrgId: p.firmOrgId,
    projectId: r.projectId,
    visibility: r.visibility,
    createdBy: r.createdBy,
    assignees: projectActions.filter((a) => a.recommendationId === r.id && a.ownerUserId).map((a) => a.ownerUserId!),
  });

  const docs = await tx
    .select({
      id: documents.id,
      title: documents.title,
      visibility: documents.visibility,
      version: documents.version,
      aiIndexable: documents.aiIndexable,
      purpose: documents.purpose,
      createdAt: documents.createdAt,
      uploadedBy: documents.uploadedBy,
      ownerOrgId: documents.ownerOrgId,
      orgId: documents.orgId,
      projectId: documents.projectId,
    })
    .from(documents)
    .where(and(eq(documents.projectId, id)))
    .orderBy(desc(documents.createdAt));

  const activity = await tx
    .select({
      id: activityEvents.id,
      event: activityEvents.event,
      fromState: activityEvents.fromState,
      toState: activityEvents.toState,
      createdAt: activityEvents.createdAt,
      actorName: user.name,
    })
    .from(activityEvents)
    .leftJoin(user, eq(user.id, activityEvents.actorId))
    .where(eq(activityEvents.projectId, id))
    .orderBy(desc(activityEvents.createdAt))
    .limit(20);

  return {
    project: p,
    recommendations: visible(principal, "recommendation.read", recs, recResource).map((r) => ({
      ...r,
      actions: projectActions.filter((a) => a.recommendationId === r.id),
    })),
    // Shares are checked per document by the download route; the list shows
    // documents whose label and project the user passes.
    documents: visible(principal, "document.read", docs, (d) => ({
      type: "document",
      id: d.id,
      orgId: d.orgId,
      firmOrgId: p.firmOrgId,
      projectId: d.projectId,
      visibility: d.visibility,
      createdBy: d.uploadedBy,
      ownerOrgId: d.ownerOrgId,
    })),
    activity: authorize(principal, "activity.read", projectResource).allowed ? activity : [],
  };
}

/** Firm side: the clients this user may see, with the consultants assigned to each. */
export async function listClients(tx: Tx, principal: Principal) {
  if (principal.orgKind !== "firm") return [];
  const orgs = await tx
    .select({ id: organizations.id, name: organizations.name, nameAr: organizations.nameAr, status: organizations.status })
    .from(organizations)
    .where(eq(organizations.kind, "client"))
    .orderBy(asc(organizations.name));
  const allowed = visible(principal, "organization.read", orgs, (o) => ({
    type: "organization",
    id: o.id,
    orgId: o.id,
    firmOrgId: principal.orgId,
    projectId: null,
  }));
  const ids = allowed.map((o) => o.id);
  const assigned = ids.length
    ? await tx
        .select({ clientOrgId: clientAssignments.clientOrgId, name: user.name, isLead: clientAssignments.isLead })
        .from(clientAssignments)
        .innerJoin(user, eq(user.id, clientAssignments.userId))
        .where(inArray(clientAssignments.clientOrgId, ids))
    : [];
  const projectRows = ids.length
    ? await tx.select({ orgId: projects.orgId }).from(projects).where(inArray(projects.orgId, ids))
    : [];
  return allowed.map((o) => ({
    ...o,
    lead: assigned.find((a) => a.clientOrgId === o.id && a.isLead)?.name ?? null,
    consultants: assigned.filter((a) => a.clientOrgId === o.id && !a.isLead).map((a) => a.name),
    projectCount: projectRows.filter((p) => p.orgId === o.id).length,
  }));
}

/** People in the user's own organization (action owners see only themselves). */
export async function listTeam(tx: Tx, principal: Principal) {
  if (!authorize(principal, "org_user.read", { type: "org_user", orgId: principal.orgId, firmOrgId: principal.orgKind === "firm" ? principal.orgId : undefined, projectId: null }).allowed) {
    return [];
  }
  const rows = await tx
    .select({ id: user.id, name: user.name, email: user.email, role: orgMemberships.role, active: orgMemberships.active })
    .from(orgMemberships)
    .innerJoin(user, eq(user.id, orgMemberships.userId))
    .where(eq(orgMemberships.orgId, principal.orgId))
    .orderBy(asc(user.name));
  const memberships = await tx
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(inArray(projectMembers.userId, rows.map((r) => r.id).concat(principal.userId)));
  return rows.map((r) => ({ ...r, projectCount: memberships.filter((m) => m.userId === r.id).length }));
}

/**
 * One action with its history, and what this user may do next. The allowed
 * moves come from canTransition(), the same check the API runs, so the page
 * never offers a button the server would refuse.
 */
export async function getActionDetail(tx: Tx, principal: Principal, id: string) {
  const loaded = await loadAction(tx, id);
  if (!loaded || !authorize(principal, "action.read", loaded.resource).allowed) throw new NotFoundError("action");
  const { action, resource } = loaded;

  const [context] = await tx
    .select({
      projectTitle: projects.title,
      projectKind: projects.kind,
      orgName: organizations.name,
      orgNameAr: organizations.nameAr,
      recommendationTitle: recommendations.title,
      requiredEvidence: recommendations.requiredEvidence,
    })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .innerJoin(recommendations, eq(recommendations.id, action.recommendationId))
    .where(eq(projects.id, action.projectId))
    .limit(1);
  const [owner] = action.ownerUserId
    ? await tx.select({ name: user.name }).from(user).where(eq(user.id, action.ownerUserId)).limit(1)
    : [];

  const updates = authorize(principal, "progress_update.read", resource).allowed
    ? await tx
        .select({ id: progressUpdates.id, body: progressUpdates.body, createdAt: progressUpdates.createdAt, authorName: user.name })
        .from(progressUpdates)
        .leftJoin(user, eq(user.id, progressUpdates.authorId))
        .where(eq(progressUpdates.actionId, id))
    : [];

  const evidenceRows = authorize(principal, "evidence.read", resource).allowed
    ? await tx
        .select({
          id: evidenceSubmissions.id,
          note: evidenceSubmissions.note,
          submittedAt: evidenceSubmissions.submittedAt,
          submitterName: user.name,
          documentId: documents.id,
          documentTitle: documents.title,
          sizeBytes: documents.sizeBytes,
          visibility: documents.visibility,
          uploadedBy: documents.uploadedBy,
          ownerOrgId: documents.ownerOrgId,
        })
        .from(evidenceSubmissions)
        .leftJoin(user, eq(user.id, evidenceSubmissions.submittedBy))
        .innerJoin(documents, eq(documents.id, evidenceSubmissions.documentId))
        .where(eq(evidenceSubmissions.actionId, id))
    : [];
  const evidence = evidenceRows.map(({ visibility, uploadedBy, ownerOrgId, ...e }) => ({
    ...e,
    canDownload: authorize(principal, "document.download", {
      type: "document",
      id: e.documentId,
      orgId: action.orgId,
      firmOrgId: resource.firmOrgId,
      projectId: action.projectId,
      visibility,
      createdBy: uploadedBy,
      ownerOrgId,
    }).allowed,
  }));

  const reviewRows = authorize(principal, "review.read", resource).allowed
    ? await tx
        .select({ id: reviews.id, outcome: reviews.outcome, reason: reviews.reason, createdAt: reviews.createdAt, reviewerName: user.name })
        .from(reviews)
        .leftJoin(user, eq(user.id, reviews.reviewerId))
        .where(eq(reviews.actionId, id))
    : [];

  type Entry =
    | { kind: "update"; at: Date; who: string | null; body: string }
    | { kind: "evidence"; at: Date; who: string | null; evidence: (typeof evidence)[number] }
    | { kind: "review"; at: Date; who: string | null; outcome: "accept" | "revise" | "reject"; reason: string | null };
  const timeline: Entry[] = [
    ...updates.map((u) => ({ kind: "update" as const, at: u.createdAt, who: u.authorName, body: u.body })),
    ...evidence.map((e) => ({ kind: "evidence" as const, at: e.submittedAt, who: e.submitterName, evidence: e })),
    ...reviewRows.map((r) => ({ kind: "review" as const, at: r.createdAt, who: r.reviewerName, outcome: r.outcome, reason: r.reason })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const from = action.status as ActionStatus;
  const submitters = from === "awaiting_review" ? await roundSubmitters(tx, id) : [];
  const moves = Object.keys(TRANSITIONS)
    .filter((k) => k.startsWith(`${from}>`))
    .map((k) => k.split(">")[1] as ActionStatus)
    .filter((to) => canTransition(principal, resource, from, to, submitters).allowed);

  return {
    action: {
      id: action.id,
      title: action.title,
      description: action.description,
      status: from,
      dueDate: action.dueDate,
      blockedReason: action.blockedReason,
      projectId: action.projectId,
      ownerName: owner?.name ?? null,
      overdue: isOverdue({ status: from, dueDate: action.dueDate }),
    },
    context: context!,
    timeline,
    moves,
    can: {
      addUpdate: authorize(principal, "progress_update.create", resource).allowed && from !== "verified_complete",
      submitEvidence:
        authorize(principal, "evidence.submit", resource).allowed && (from === "in_progress" || from === "revision_requested"),
    },
  };
}

export type ActionDetail = Awaited<ReturnType<typeof getActionDetail>>;
