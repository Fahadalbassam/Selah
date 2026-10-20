import "server-only";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  actions,
  activityEvents,
  evidenceRequests,
  findings,
  orgMemberships,
  projectMembers,
  recommendations,
} from "@/db/schema";
import { assertAllowed, type Principal, type Visibility } from "@/authz";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { loadAction } from "./actions";
import { audit } from "./audit";
import { loadProject } from "./staffing";

// The consultants' plan for a project: findings, the recommendations that
// answer them (or board decisions and compliance items), and the actions that
// carry each recommendation out. Clients read it; only the firm writes it
// (drizzle/0011_follow_through_rules.sql enforces the same).

type Label = Extract<Visibility, "shared" | "firm_private">;

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

export interface ActionInput {
  title: string;
  description?: string;
  ownerUserId?: string;
  dueDate?: string;
  /** The evidence list: what the firm needs to see to verify it. */
  evidence?: { title: string; description?: string }[];
  /** Release straight away (Assigned) instead of keeping a draft. */
  release: boolean;
}

export async function createAction(tx: Tx, principal: Principal, recommendationId: string, input: ActionInput) {
  const [rec] = await tx.select().from(recommendations).where(eq(recommendations.id, recommendationId)).limit(1);
  if (!rec) throw new NotFoundError("recommendation");
  const { resource } = await loadProject(tx, principal, rec.projectId);
  assertAllowed(principal, "action.write", { ...resource, type: "action" });
  if (input.release) {
    assertAllowed(principal, "action.release", { ...resource, type: "action" });
    if (!input.ownerUserId || !input.dueDate) throw new BadRequestError("a released action needs an owner and a due date");
  }
  if (input.ownerUserId) await assertOwner(tx, rec.projectId, rec.orgId, input.ownerUserId);

  const [row] = await tx
    .insert(actions)
    .values({
      projectId: rec.projectId,
      orgId: rec.orgId,
      recommendationId,
      title: input.title,
      description: input.description,
      ownerUserId: input.ownerUserId,
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
  });
  return { id };
}

/** The firm edits an action's plan; a client manager may only reassign the owner. */
export async function updateAction(
  tx: Tx,
  principal: Principal,
  id: string,
  input: { title?: string; description?: string | null; ownerUserId?: string | null; dueDate?: string | null },
) {
  const loaded = await loadAction(tx, id);
  if (!loaded) throw new NotFoundError("action");
  const { action, resource } = loaded;
  assertAllowed(principal, "action.read", resource);
  const planChange = input.title !== undefined || input.description !== undefined || input.dueDate !== undefined;
  if (planChange) assertAllowed(principal, "action.write", resource);
  if (input.ownerUserId !== undefined) assertAllowed(principal, "action.assign_owner", resource);
  if (action.status === "verified_complete" || action.status === "closed") throw new BadRequestError("reopen the action first");
  if (input.ownerUserId) await assertOwner(tx, action.projectId, action.orgId, input.ownerUserId);
  // A released action keeps an owner and a due date.
  if (action.status !== "draft" && (input.ownerUserId === null || input.dueDate === null)) {
    throw new BadRequestError("a released action needs an owner and a due date");
  }

  await tx.update(actions).set(input).where(eq(actions.id, id));
  await tx.insert(activityEvents).values({
    projectId: action.projectId,
    orgId: action.orgId,
    actorId: principal.userId,
    entityType: "action",
    entityId: id,
    event: "updated",
    meta: { fields: Object.keys(input) },
  });
  return { id };
}
