import "server-only";
import { and, asc, eq, isNotNull, or } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  actions,
  activityEvents,
  departments,
  evidenceRequests,
  findings,
  notifications,
  orgMemberships,
  organizations,
  projectMembers,
  recommendations,
  user,
} from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Visibility } from "@/authz";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { loadAction } from "./actions";
import { audit } from "./audit";
import { loadProject } from "./staffing";

// The consultants' plan for a project: findings, the recommendations that
// answer them (or board decisions and compliance items), and the actions that
// carry each recommendation out. Clients read it; only the firm writes it
// (the baseline's Follow-through section enforces the same).

type Label = Extract<Visibility, "shared" | "firm_private">;

/**
 * What the plan screens offer this user on a project: which records they may
 * add, and the choices for a new action (people who can own it, or a typed
 * name for a client the firm manages, and the client's departments). Null for
 * anyone who can't write the plan.
 */
export async function planOptions(tx: Tx, principal: Principal, projectId: string) {
  const { project, resource } = await loadProject(tx, principal, projectId);
  const can = (permission: "finding.write" | "recommendation.write" | "action.write" | "action.release", type: "finding" | "recommendation" | "action") =>
    authorize(principal, permission, { ...resource, type }).allowed;
  const write = {
    finding: can("finding.write", "finding"),
    recommendation: can("recommendation.write", "recommendation"),
    action: can("action.write", "action"),
    release: can("action.release", "action"),
  };
  if (!write.finding && !write.recommendation && !write.action) return null;

  // The same rule as assertOwner: on the project team and an active member of the project's organization.
  const owners = await tx
    .select({ userId: user.id, name: user.name, email: user.email })
    .from(projectMembers)
    .innerJoin(user, eq(user.id, projectMembers.userId))
    .innerJoin(
      orgMemberships,
      and(eq(orgMemberships.userId, projectMembers.userId), eq(orgMemberships.orgId, project.orgId), eq(orgMemberships.active, true)),
    )
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(user.name));

  let ownerByName = false;
  let minimalRecords = false;
  let departmentList: { id: string; nameAr: string; nameEn: string | null }[] = [];
  if (project.kind === "client") {
    const [org] = await tx
      .select({ mode: organizations.engagementMode, minimal: organizations.minimalRecords, departmentsOn: organizations.departmentsEnabled })
      .from(organizations)
      .where(eq(organizations.id, project.orgId));
    ownerByName = org?.mode === "consultant_managed";
    // Minimal records: the owner is a job title, never a name (drizzle rules).
    minimalRecords = org?.minimal ?? false;
    if (org?.departmentsOn) {
      departmentList = await tx
        .select({ id: departments.id, nameAr: departments.nameAr, nameEn: departments.nameEn })
        .from(departments)
        .where(and(eq(departments.orgId, project.orgId), eq(departments.active, true)))
        .orderBy(asc(departments.nameAr));
    }
  }
  const accountables = project.kind === "client" && !ownerByName ? await accountablePeople(tx, projectId, project.orgId) : [];
  return { can: write, kind: project.kind, owners, ownerByName, minimalRecords, departments: departmentList, accountables };
}

/**
 * Who can be accountable for a whole recommendation: a client person who sees
 * the project (its admins, and those staffed on it). The database checks the
 * same (check_recommendation_accountable).
 */
function accountablePeople(tx: Tx, projectId: string, orgId: string, only?: string) {
  return tx
    .selectDistinct({ userId: user.id, name: user.name })
    .from(orgMemberships)
    .innerJoin(user, eq(user.id, orgMemberships.userId))
    .leftJoin(projectMembers, and(eq(projectMembers.userId, orgMemberships.userId), eq(projectMembers.projectId, projectId)))
    .where(
      and(
        eq(orgMemberships.orgId, orgId),
        eq(orgMemberships.active, true),
        or(eq(orgMemberships.role, "client_admin"), isNotNull(projectMembers.userId)),
        only ? eq(user.id, only) : undefined,
      ),
    )
    .orderBy(asc(user.name));
}

export async function createFinding(
  tx: Tx,
  principal: Principal,
  projectId: string,
  input: { title: string; description?: string; visibility: Label },
) {
  const { project, resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "finding.write", { ...resource, type: "finding" });
  const [row] = await tx
    .insert(findings)
    .values({ projectId, orgId: project.orgId, ...input, createdBy: principal.userId })
    .returning({ id: findings.id });
  return row!;
}

export interface RecommendationInput {
  title: string;
  findingId?: string;
  rationale?: string;
  targetOutcome?: string;
  priority: "low" | "medium" | "high" | "critical";
  dueDate?: string;
  requiredEvidence?: string;
  source: "consultant" | "board_decision" | "compliance";
  /** Board decisions: when, and in which meeting. */
  decidedOn?: string;
  meetingNoteId?: string;
  visibility: Label;
  /** One department's, or none for company-wide and cross-department work. */
  departmentId?: string;
  /** The client person accountable for the whole recommendation. */
  accountableUserId?: string;
}

export async function createRecommendation(tx: Tx, principal: Principal, projectId: string, input: RecommendationInput) {
  const { project, resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "recommendation.write", { ...resource, type: "recommendation" });
  if (input.source === "board_decision" && !input.decidedOn)
    throw new BadRequestError("a board decision needs the date it was decided");
  if (input.findingId) {
    const [f] = await tx
      .select({ projectId: findings.projectId })
      .from(findings)
      .where(eq(findings.id, input.findingId))
      .limit(1);
    if (!f || f.projectId !== projectId) throw new BadRequestError("the finding is not in this project");
  }
  if (input.departmentId) await checkOwnership(tx, { projectId, orgId: project.orgId }, { departmentId: input.departmentId });
  if (input.accountableUserId) {
    const [ok] = project.kind === "client" ? await accountablePeople(tx, projectId, project.orgId, input.accountableUserId) : [];
    if (!ok) throw new BadRequestError("the accountable person is someone at the client on this project");
  }
  const [row] = await tx
    .insert(recommendations)
    .values({ projectId, orgId: project.orgId, ...input, createdBy: principal.userId })
    .returning({ id: recommendations.id });
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "recommendation.write",
    resourceType: "recommendation",
    resourceId: row!.id,
    outcome: "allow",
    meta: { source: input.source },
  });
  // The accountable person hears of it, unless it is still the firm's own.
  if (input.accountableUserId && input.visibility === "shared" && input.accountableUserId !== principal.userId) {
    await tx.insert(notifications).values({ userId: input.accountableUserId, kind: "recommendation.accountable", entityType: "project", entityId: projectId });
  }
  return row!;
}

/** The owner must work on the project: a client user staffed on it, or firm staff on an internal project. */
async function assertOwner(tx: Tx, projectId: string, orgId: string, userId: string) {
  const [m] = await tx
    .select({ role: orgMemberships.role })
    .from(projectMembers)
    .innerJoin(orgMemberships, and(eq(orgMemberships.userId, projectMembers.userId), eq(orgMemberships.active, true)))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId), eq(orgMemberships.orgId, orgId)))
    .limit(1);
  if (!m) throw new BadRequestError("the owner must be on the project team");
}

/**
 * Who answers for an action: a person on the project, or (consultant-managed
 * clients, who have no accounts) the client person's name. A department, if
 * set, must be an active one of the action's client.
 */
async function checkOwnership(
  tx: Tx,
  scope: { projectId: string; orgId: string },
  input: { ownerUserId?: string | null; ownerName?: string | null; departmentId?: string | null },
) {
  if (input.ownerUserId && input.ownerName) throw new BadRequestError("give an owner or an owner's name, not both");
  if (input.ownerUserId) await assertOwner(tx, scope.projectId, scope.orgId, input.ownerUserId);
  if (input.ownerName) {
    const [org] = await tx.select({ mode: organizations.engagementMode }).from(organizations).where(eq(organizations.id, scope.orgId));
    if (org?.mode !== "consultant_managed") throw new BadRequestError("an owner's name is for clients the firm manages; pick a person on the project");
  }
  if (input.departmentId) {
    const [d] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.id, input.departmentId), eq(departments.orgId, scope.orgId), eq(departments.active, true)));
    if (!d) throw new BadRequestError("that department is not an active department of this client");
  }
}

export interface ActionInput {
  title: string;
  description?: string;
  ownerUserId?: string;
  /** Consultant-managed clients: the client person responsible (no account). */
  ownerName?: string;
  departmentId?: string;
  dueDate?: string;
  /** The evidence list: what the firm needs to see to verify it. */
  evidence?: { title: string; description?: string }[];
  /** Release straight away (Assigned) instead of keeping a draft. */
  release: boolean;
}

export async function createAction(
  tx: Tx,
  principal: Principal,
  recommendationId: string,
  input: ActionInput,
  /** Where it came from, for the activity record (e.g. an import). */
  origin?: { import: true },
) {
  const [rec] = await tx.select().from(recommendations).where(eq(recommendations.id, recommendationId)).limit(1);
  if (!rec) throw new NotFoundError("recommendation");
  const { resource } = await loadProject(tx, principal, rec.projectId);
  assertAllowed(principal, "action.write", { ...resource, type: "action" });
  if (input.release) {
    assertAllowed(principal, "action.release", { ...resource, type: "action" });
    if (!(input.ownerUserId || input.ownerName) || !input.dueDate) throw new BadRequestError("a released action needs an owner and a due date");
  }
  await checkOwnership(tx, rec, input);

  const [row] = await tx
    .insert(actions)
    .values({
      projectId: rec.projectId,
      orgId: rec.orgId,
      recommendationId,
      title: input.title,
      description: input.description,
      ownerUserId: input.ownerUserId,
      ownerName: input.ownerName,
      departmentId: input.departmentId,
      dueDate: input.dueDate,
      status: input.release ? "assigned" : "draft",
      createdBy: principal.userId,
    })
    .returning({ id: actions.id });
  const id = row!.id;
  if (input.evidence?.length) {
    await tx
      .insert(evidenceRequests)
      .values(
        input.evidence.map((e) => ({
          projectId: rec.projectId,
          orgId: rec.orgId,
          actionId: id,
          ...e,
          createdBy: principal.userId,
        })),
      );
  }
  await tx.insert(activityEvents).values({
    projectId: rec.projectId,
    orgId: rec.orgId,
    actorId: principal.userId,
    entityType: "action",
    entityId: id,
    event: "created",
    toState: input.release ? "assigned" : "draft",
    meta: origin,
  });
  // Released straight to someone: tell them (and mail them, baseline: Action mail).
  if (input.release && input.ownerUserId && input.ownerUserId !== principal.userId) {
    await tx.insert(notifications).values({ userId: input.ownerUserId, kind: "action.assigned", entityType: "action", entityId: id });
  }
  return { id };
}

/** The firm edits an action's plan; a client manager may only reassign the owner. */
export async function updateAction(
  tx: Tx,
  principal: Principal,
  id: string,
  input: {
    title?: string;
    description?: string | null;
    ownerUserId?: string | null;
    ownerName?: string | null;
    departmentId?: string | null;
    dueDate?: string | null;
  },
) {
  const loaded = await loadAction(tx, id);
  if (!loaded) throw new NotFoundError("action");
  const { action, resource } = loaded;
  assertAllowed(principal, "action.read", resource);
  const planChange =
    input.title !== undefined ||
    input.description !== undefined ||
    input.dueDate !== undefined ||
    input.ownerName !== undefined ||
    input.departmentId !== undefined;
  if (planChange) assertAllowed(principal, "action.write", resource);
  if (input.ownerUserId !== undefined) assertAllowed(principal, "action.assign_owner", resource);
  if (action.status === "verified_complete" || action.status === "closed") throw new BadRequestError("reopen the action first");
  await checkOwnership(tx, action, input);
  // Naming one kind of owner replaces the other.
  const patch = { ...input };
  if (input.ownerUserId) patch.ownerName = null;
  if (input.ownerName) patch.ownerUserId = null;
  // A released action keeps an owner and a due date.
  const ownerUserId = patch.ownerUserId !== undefined ? patch.ownerUserId : action.ownerUserId;
  const ownerName = patch.ownerName !== undefined ? patch.ownerName : action.ownerName;
  if (action.status !== "draft" && (!(ownerUserId || ownerName) || input.dueDate === null)) {
    throw new BadRequestError("a released action needs an owner and a due date");
  }

  await tx.update(actions).set(patch).where(eq(actions.id, id));
  await tx.insert(activityEvents).values({
    projectId: action.projectId,
    orgId: action.orgId,
    actorId: principal.userId,
    entityType: "action",
    entityId: id,
    event: "updated",
    meta: { fields: Object.keys(input) },
  });
  // A released action handed to someone new: they hear it's theirs. A draft waits for its release.
  if (patch.ownerUserId && patch.ownerUserId !== action.ownerUserId && patch.ownerUserId !== principal.userId && action.status !== "draft") {
    await tx.insert(notifications).values({ userId: patch.ownerUserId, kind: "action.assigned", entityType: "action", entityId: id });
  }
  return { id };
}
