import "server-only";
import { and, asc, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  actions,
  activityEvents,
  clientAssignments,
  departments,
  documents,
  engagements,
  evidenceSubmissions,
  findings,
  orgMemberships,
  organizations,
  progressUpdates,
  projectMembers,
  projects,
  recommendations,
  reviews,
  user,
} from "@/db/schema";
import { authorize, canTransition, OPEN_STATUSES, TRANSITIONS, type ActionStatus, type Permission, type Principal, type Resource } from "@/authz";
import { loadAction, roundSubmitters } from "./actions";
import { fileControls } from "./documents";
import { firmToday } from "@/lib/dates";
import { NotFoundError } from "@/server/errors";

// Read services for the pages. Rows come back already filtered by RLS; each
// one is then checked with authorize(), so pages show exactly what the API
// would allow. Nothing here trusts the caller to filter.

function visible<T>(principal: Principal, permission: Permission, rows: T[], toResource: (row: T) => Resource): T[] {
  return rows.filter((row) => authorize(principal, permission, toResource(row)).allowed);
}

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
  const counts = allowed.length ? await actionCounts(tx, principal) : [];
  const count = (projectId: string, status?: ActionStatus) =>
    counts.filter((c) => c.projectId === projectId && (!status || c.status === status)).reduce((n, c) => n + c.n, 0);
  return allowed.map((p) => ({
    ...p,
    actionCount: count(p.id),
    verifiedCount: count(p.id, "verified_complete"),
    awaitingReviewCount: count(p.id, "awaiting_review"),
  }));
}

export interface ActionFilter {
  projectId?: string;
  /** Every client project of this client. */
  clientOrgId?: string;
  mineOnly?: boolean;
  status?: ActionStatus[];
  /** Overdue ones, or ones in these states. */
  attention?: ActionStatus[];
}

/**
 * The SQL side of what a person may read. RLS lets an action owner read every
 * action in their projects, but authorize() lets them read only their own
 * ("assigned"), so that is narrowed here too. Counts and pages then agree with
 * the rows each person could open; visible() still checks every row.
 */
function actionConditions(principal: Principal, filter: ActionFilter) {
  const conditions = [];
  if (filter.projectId) conditions.push(eq(actions.projectId, filter.projectId));
  if (filter.clientOrgId) conditions.push(eq(actions.orgId, filter.clientOrgId), sql`exists (select 1 from projects p where p.id = ${actions.projectId} and p.kind = 'client')`);
  if (filter.mineOnly || principal.role === "action_owner") conditions.push(eq(actions.ownerUserId, principal.userId));
  if (filter.status) conditions.push(inArray(actions.status, filter.status));
  if (filter.attention) {
    conditions.push(
      or(
        and(inArray(actions.status, [...OPEN_STATUSES]), lt(actions.dueDate, firmToday())),
        inArray(actions.status, filter.attention),
      ),
      projectNotClosed,
    );
  }
  return conditions.length ? and(...conditions) : undefined;
}

/** Actions by due date. With `page`, one page of `PAGE_SIZE`; with `limit`, the first few; otherwise all of them. */
export async function listActions(tx: Tx, principal: Principal, filter: ActionFilter & { page?: number; limit?: number } = {}) {
  const query = tx
    .select({
      id: actions.id,
      title: actions.title,
      status: actions.status,
      dueDate: actions.dueDate,
      ownerUserId: actions.ownerUserId,
      // A consultant-managed client's owner has a name, not an account.
      ownerName: sql<string | null>`coalesce(${user.name}, ${actions.ownerName})`,
      departmentId: actions.departmentId,
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
    .where(actionConditions(principal, filter))
    // The id breaks ties, so pages never repeat or skip a row.
    .orderBy(sql`${actions.dueDate} ASC NULLS LAST`, asc(actions.id))
    .$dynamic();
  const rows = await (filter.page
    ? query.limit(PAGE_SIZE).offset((filter.page - 1) * PAGE_SIZE)
    : filter.limit
      ? query.limit(filter.limit)
      : query);
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

export const PAGE_SIZE = 50;

// A closed project's open actions were settled at closing (each has a
// disposition), so they are never overdue and never need attention.
const projectNotClosed = sql`NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = ${actions.projectId} AND p.state::text = 'closed')`;

/** How many actions there are by status (and how many are overdue), per project, counted in the database. */
export async function actionCounts(tx: Tx, principal: Principal, filter: ActionFilter = {}) {
  const today = firmToday();
  const rows = await tx
    .select({
      projectId: actions.projectId,
      status: actions.status,
      n: sql<number>`count(*)::int`,
      overdue: sql<number>`(count(*) FILTER (WHERE ${actions.dueDate} < ${today}::date AND ${projectNotClosed}))::int`,
    })
    .from(actions)
    .where(actionConditions(principal, filter))
    .groupBy(actions.projectId, actions.status);
  const open = OPEN_STATUSES as readonly string[];
  return rows.map((r) => ({ ...r, overdue: open.includes(r.status) ? r.overdue : 0 }));
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
  const counts = await actionCounts(tx, principal);
  const by = (s: ActionStatus) => counts.filter((c) => c.status === s).reduce((n, c) => n + c.n, 0);
  // What needs this person: overdue work, and what waits on their side.
  const waiting: ActionStatus[] = principal.orgKind === "firm" ? ["awaiting_review"] : ["revision_requested", "blocked"];
  const attention = await listActions(tx, principal, { attention: waiting, limit: 10 });
  return {
    total: counts.reduce((n, c) => n + c.n, 0),
    inProgress: by("in_progress") + by("assigned") + by("revision_requested"),
    blocked: by("blocked"),
    awaitingReview: by("awaiting_review"),
    verified: by("verified_complete"),
    overdue: counts.reduce((n, c) => n + c.overdue, 0),
    attention,
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
      sequence: projects.sequence,
      plannedWorkingDays: projects.plannedWorkingDays,
      followsProjectId: projects.followsProjectId,
      orgId: projects.orgId,
      firmOrgId: projects.firmOrgId,
      orgName: organizations.name,
      orgNameAr: organizations.nameAr,
      minimalRecords: organizations.minimalRecords,
      // RLS leaves it out for those who may not read the engagement.
      engagementId: engagements.id,
      engagementTitle: engagements.title,
    })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .leftJoin(engagements, eq(engagements.id, projects.engagementId))
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
  // Department and accountable person, by name (F31).
  const recDepts = [...new Set(recs.flatMap((r) => (r.departmentId ? [r.departmentId] : [])))];
  const recPeople = [...new Set(recs.flatMap((r) => (r.accountableUserId ? [r.accountableUserId] : [])))];
  const deptNames = new Map(
    (recDepts.length
      ? await tx.select({ id: departments.id, nameAr: departments.nameAr, nameEn: departments.nameEn }).from(departments).where(inArray(departments.id, recDepts))
      : []
    ).map((d) => [d.id, d]),
  );
  const peopleNames = new Map(
    (recPeople.length ? await tx.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, recPeople)) : []).map((u) => [u.id, u.name]),
  );
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

  // What the consultants found; each recommendation may answer one.
  const findingRows = await tx
    .select({
      id: findings.id,
      title: findings.title,
      description: findings.description,
      visibility: findings.visibility,
      createdBy: findings.createdBy,
      orgId: findings.orgId,
      projectId: findings.projectId,
      fromAssessment: sql<boolean>`${findings.assessmentAnswerId} is not null`,
    })
    .from(findings)
    .where(eq(findings.projectId, id))
    .orderBy(asc(findings.createdAt));

  const docs = await tx
    .select({
      id: documents.id,
      title: documents.title,
      visibility: documents.visibility,
      version: documents.version,
      aiIndexable: documents.aiIndexable,
      textStatus: documents.textStatus,
      purpose: documents.purpose,
      state: documents.state,
      createdAt: documents.createdAt,
      uploadedBy: documents.uploadedBy,
      ownerOrgId: documents.ownerOrgId,
      departmentId: documents.departmentId,
      orgId: documents.orgId,
      projectId: documents.projectId,
      firstVersion: sql<boolean>`${documents.supersedesId} is null`,
      settled: sql<boolean>`app_document_settled(${documents.id})`,
    })
    .from(documents)
    .where(
      and(
        eq(documents.projectId, id),
        ne(documents.state, "archived"),
        // The latest version of each file; earlier ones stay on record.
        sql`not exists (select 1 from documents n where n.supersedes_id = ${documents.id})`,
      ),
    )
    .orderBy(desc(documents.createdAt));

  const docResource = (d: (typeof docs)[number]): Resource => ({
    type: "document",
    id: d.id,
    orgId: d.orgId,
    firmOrgId: p.firmOrgId,
    projectId: d.projectId,
    visibility: d.visibility,
    createdBy: d.uploadedBy,
    ownerOrgId: d.ownerOrgId,
    departmentId: d.departmentId,
  });

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
      department: r.departmentId ? (deptNames.get(r.departmentId) ?? null) : null,
      accountableName: r.accountableUserId ? (peopleNames.get(r.accountableUserId) ?? null) : null,
      actions: projectActions.filter((a) => a.recommendationId === r.id),
    })),
    // Shares are checked per document by the download route; the list shows
    // documents whose label and project the user passes.
    findings: visible(principal, "finding.read", findingRows, (f) => ({
      type: "finding",
      id: f.id,
      orgId: f.orgId,
      firmOrgId: p.firmOrgId,
      projectId: f.projectId,
      visibility: f.visibility,
      createdBy: f.createdBy,
    })),
    documents: visible(principal, "document.read", docs, docResource).map((d) => ({
      ...d,
      can: fileControls(principal, {
        doc: d,
        resource: docResource(d),
        context: {
          projectKind: p.kind,
          projectClosed: p.state === "closed",
          minimal: p.minimalRecords,
          latest: true,
          firstVersion: d.firstVersion,
          settled: d.settled,
        },
      }),
    })),
    activity: authorize(principal, "activity.read", projectResource).allowed ? activity : [],
  };
}

/** Firm side: the clients this user may see, with the consultants assigned to each. */
export async function listClients(tx: Tx, principal: Principal) {
  if (principal.orgKind !== "firm") return [];
  const orgs = await tx
    .select({ id: organizations.id, name: organizations.name, nameAr: organizations.nameAr, status: organizations.status, prospect: organizations.prospect })
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
  // Admins also see who has two-factor sign-in on, and may reset it for the
  // people the database lets them (app_reset_two_factor): never themselves,
  // and a client admin not a fellow admin.
  const admin = principal.role === "firm_admin" || principal.role === "client_admin";
  const twoFactor = admin
    ? new Map(
        (
          await tx.execute<{ user_id: string; enabled: boolean }>(sql`select user_id, enabled from app_two_factor_status(${principal.orgId})`)
        ).rows.map((r) => [r.user_id, r.enabled]),
      )
    : null;
  return rows.map((r) => ({
    ...r,
    projectCount: memberships.filter((m) => m.userId === r.id).length,
    twoFactor: twoFactor ? (twoFactor.get(r.id) ?? false) : null,
    canResetTwoFactor:
      admin && r.id !== principal.userId && r.active && (principal.role === "firm_admin" || r.role !== "client_admin") && twoFactor?.get(r.id) === true,
  }));
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
        .select({
          id: progressUpdates.id,
          body: progressUpdates.body,
          createdAt: progressUpdates.createdAt,
          authorName: user.name,
          source: progressUpdates.source,
          receivedVia: progressUpdates.receivedVia,
          receivedOn: progressUpdates.receivedOn,
        })
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
          source: evidenceSubmissions.source,
          receivedVia: evidenceSubmissions.receivedVia,
          receivedOn: evidenceSubmissions.receivedOn,
          documentId: documents.id,
          documentTitle: documents.title,
          sizeBytes: documents.sizeBytes,
          visibility: documents.visibility,
          uploadedBy: documents.uploadedBy,
          ownerOrgId: documents.ownerOrgId,
          departmentId: documents.departmentId,
        })
        .from(evidenceSubmissions)
        .leftJoin(user, eq(user.id, evidenceSubmissions.submittedBy))
        .innerJoin(documents, eq(documents.id, evidenceSubmissions.documentId))
        .where(eq(evidenceSubmissions.actionId, id))
    : [];
  const evidence = evidenceRows.map(({ visibility, uploadedBy, ownerOrgId, departmentId, ...e }) => ({
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
      departmentId,
    }).allowed,
  }));

  const reviewRows = authorize(principal, "review.read", resource).allowed
    ? await tx
        .select({ id: reviews.id, outcome: reviews.outcome, reason: reviews.reason, createdAt: reviews.createdAt, reviewerName: user.name })
        .from(reviews)
        .leftJoin(user, eq(user.id, reviews.reviewerId))
        .where(eq(reviews.actionId, id))
    : [];

  // source tells "submitted by the client" from "recorded by a consultant"
  // (with how and when the client told them); the two are never mixed.
  type Recorded = Pick<(typeof updates)[number], "source" | "receivedVia" | "receivedOn">;
  type Entry =
    | ({ kind: "update"; id: string; at: Date; who: string | null; body: string } & Recorded)
    | { kind: "evidence"; at: Date; who: string | null; evidence: (typeof evidence)[number] }
    | { kind: "review"; at: Date; who: string | null; outcome: "accept" | "revise" | "reject"; reason: string | null };
  const timeline: Entry[] = [
    ...updates.map((u) => ({
      kind: "update" as const,
      id: u.id,
      at: u.createdAt,
      who: u.authorName,
      body: u.body,
      source: u.source,
      receivedVia: u.receivedVia,
      receivedOn: u.receivedOn,
    })),
    ...evidence.map((e) => ({ kind: "evidence" as const, at: e.submittedAt, who: e.submitterName, evidence: e })),
    ...reviewRows.map((r) => ({ kind: "review" as const, at: r.createdAt, who: r.reviewerName, outcome: r.outcome, reason: r.reason })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const from = action.status as ActionStatus;
  const verifiedBasis =
    from === "verified_complete"
      ? (await tx.execute<{ b: string | null }>(sql`select app_verified_basis(${id}::uuid) as b`)).rows[0]?.b
      : null;
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
      ownerUserId: action.ownerUserId,
      ownerName: owner?.name ?? action.ownerName,
      departmentId: action.departmentId,
      orgId: action.orgId,
      // Verified on the client's evidence or on what a consultant recorded
      // (baseline: Insight); null until verified.
      verifiedBasis: from === "verified_complete" ? (verifiedBasis ?? null) : null,
      overdue: isOverdue({ status: from, dueDate: action.dueDate }),
    },
    context: context!,
    timeline,
    moves,
    // Firm staff may mark a translation of this page's text reviewed.
    firmStaff: principal.orgKind === "firm",
    can: {
      addUpdate: authorize(principal, "progress_update.create", resource).allowed && from !== "verified_complete",
      submitEvidence:
        authorize(principal, "evidence.submit", resource).allowed && (from === "in_progress" || from === "revision_requested"),
      // File it under one of the client's departments (a plan change).
      fileDepartment:
        authorize(principal, "action.write", resource).allowed && from !== "verified_complete" && from !== "closed",
    },
  };
}

export type ActionDetail = Awaited<ReturnType<typeof getActionDetail>>;
