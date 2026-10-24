import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { engagementDeliverables, engagements, inquiries, organizations, projects, user } from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Resource } from "@/authz";
import type { DeliverableInput, EngagementInput } from "@/lib/engagements";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";

// The signed engagement (wave 1, item 5) and what it covers. A client
// project no engagement covers is a draft the client never sees; covering it
// makes it planned (journey-map gap N3). The database holds the same rules
// (baseline: Engagements, 0008); these checks give clear errors.

const resourceOf = (principal: Principal, clientOrgId: string, id?: string): Resource => ({
  type: "engagement",
  id,
  orgId: clientOrgId,
  firmOrgId: principal.orgKind === "firm" ? principal.orgId : undefined,
  projectId: null,
});

async function loadEngagement(tx: Tx, principal: Principal, id: string) {
  const [row] = await tx.select().from(engagements).where(eq(engagements.id, id)).limit(1);
  if (!row) throw new NotFoundError("engagement");
  const resource = { ...resourceOf(principal, row.clientOrgId, id), firmOrgId: row.firmOrgId };
  assertAllowed(principal, "engagement.read", resource);
  return { row, resource };
}

/** Projects of the client an engagement can cover: its drafts. */
async function assertDrafts(tx: Tx, clientOrgId: string, projectIds: string[]) {
  if (!projectIds.length) return;
  const rows = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(and(inArray(projects.id, projectIds), eq(projects.orgId, clientOrgId), eq(projects.kind, "client"), isNull(projects.engagementId)));
  if (rows.length !== new Set(projectIds).size) throw new BadRequestError("an engagement covers this client's projects that no engagement covers yet");
}

/**
 * Record a signed engagement for a client, and the projects it covers: those
 * leave draft and become planned. The firm admin's step.
 */
export async function recordEngagement(
  tx: Tx,
  principal: Principal,
  clientOrgId: string,
  input: EngagementInput & { projectIds?: string[]; inquiryId?: string },
) {
  assertAllowed(principal, "engagement.write", resourceOf(principal, clientOrgId));
  const [client] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.id, clientOrgId), eq(organizations.kind, "client")))
    .limit(1);
  if (!client) throw new NotFoundError("client");
  const { projectIds = [], inquiryId, ...fields } = input;
  await assertDrafts(tx, clientOrgId, projectIds);
  const [row] = await tx
    .insert(engagements)
    .values({ ...fields, retainerFollows: fields.retainerFollows ?? false, firmOrgId: principal.orgId, clientOrgId, inquiryId, createdBy: principal.userId })
    .returning({ id: engagements.id });
  if (projectIds.length) await tx.update(projects).set({ engagementId: row!.id }).where(inArray(projects.id, projectIds));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "engagement.record",
    resourceType: "engagement",
    resourceId: row!.id,
    outcome: "allow",
    meta: { clientOrgId, projects: projectIds.length },
  });
  return { id: row!.id };
}

/** Correct what was recorded. The client stays the same. */
export async function updateEngagement(tx: Tx, principal: Principal, id: string, input: Partial<EngagementInput>) {
  const { resource } = await loadEngagement(tx, principal, id);
  assertAllowed(principal, "engagement.write", resource);
  const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  if (Object.keys(set).length) await tx.update(engagements).set(set).where(eq(engagements.id, id));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "engagement.update",
    resourceType: "engagement",
    resourceId: id,
    outcome: "allow",
    meta: { fields: Object.keys(set).join(",") },
  });
  return { ok: true };
}

/** Bring more of the client's draft projects under a signed engagement (an agreed new phase). */
export async function coverProjects(tx: Tx, principal: Principal, id: string, projectIds: string[]) {
  const { row, resource } = await loadEngagement(tx, principal, id);
  assertAllowed(principal, "engagement.write", resource);
  await assertDrafts(tx, row.clientOrgId, projectIds);
  await tx.update(projects).set({ engagementId: id }).where(inArray(projects.id, projectIds));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "engagement.cover",
    resourceType: "engagement",
    resourceId: id,
    outcome: "allow",
    meta: { projects: projectIds.join(",") },
  });
  return { ok: true };
}

/** Remove a mistaken record. Only while it covers no project. */
export async function deleteEngagement(tx: Tx, principal: Principal, id: string) {
  const { resource } = await loadEngagement(tx, principal, id);
  assertAllowed(principal, "engagement.write", resource);
  const [covered] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.engagementId, id)).limit(1);
  if (covered) throw new BadRequestError("an engagement that covers projects stays on record");
  await tx.delete(engagements).where(eq(engagements.id, id));
  await audit(tx, { actorId: principal.userId, orgId: principal.orgId, action: "engagement.delete", resourceType: "engagement", resourceId: id, outcome: "allow" });
  return { ok: true };
}

export async function addDeliverable(tx: Tx, principal: Principal, engagementId: string, input: DeliverableInput) {
  const { resource } = await loadEngagement(tx, principal, engagementId);
  assertAllowed(principal, "engagement.write", resource);
  const [row] = await tx
    .insert(engagementDeliverables)
    .values({
      engagementId,
      title: input.title,
      acceptanceCriteria: input.acceptanceCriteria ?? null,
      dueOn: input.dueOn ?? null,
      projectId: input.projectId ?? null,
      createdBy: principal.userId,
    })
    .returning({ id: engagementDeliverables.id });
  return { id: row!.id };
}

export async function removeDeliverable(tx: Tx, principal: Principal, engagementId: string, deliverableId: string) {
  const { resource } = await loadEngagement(tx, principal, engagementId);
  assertAllowed(principal, "engagement.write", resource);
  const gone = await tx
    .delete(engagementDeliverables)
    .where(and(eq(engagementDeliverables.id, deliverableId), eq(engagementDeliverables.engagementId, engagementId)))
    .returning({ id: engagementDeliverables.id });
  if (!gone.length) throw new NotFoundError("deliverable");
  return { ok: true };
}

/** A client's engagements, newest first, with the projects each covers. */
export async function listEngagements(tx: Tx, principal: Principal, clientOrgId: string) {
  const resource = resourceOf(principal, clientOrgId);
  if (!authorize(principal, "engagement.read", resource).allowed) return { engagements: [], can: { record: false } };
  const rows = await tx
    .select({
      id: engagements.id,
      title: engagements.title,
      signedOn: engagements.signedOn,
      startsOn: engagements.startsOn,
      endsOn: engagements.endsOn,
      dataAgreementOn: engagements.dataAgreementOn,
      retainerFollows: engagements.retainerFollows,
    })
    .from(engagements)
    .where(eq(engagements.clientOrgId, clientOrgId))
    .orderBy(desc(engagements.signedOn), desc(engagements.createdAt));
  const covered = rows.length
    ? await tx
        .select({ id: projects.id, title: projects.title, engagementId: projects.engagementId })
        .from(projects)
        .where(inArray(projects.engagementId, rows.map((r) => r.id)))
        .orderBy(asc(projects.sequence), asc(projects.createdAt))
    : [];
  return {
    engagements: rows.map((r) => ({ ...r, projects: covered.filter((p) => p.engagementId === r.id).map(({ id, title }) => ({ id, title })) })),
    can: { record: authorize(principal, "engagement.write", resource).allowed },
  };
}

/** One engagement in full: what was signed, what it covers and delivers, and the inquiry it came from. */
export async function getEngagement(tx: Tx, principal: Principal, id: string) {
  const { row, resource } = await loadEngagement(tx, principal, id);
  const [client] = await tx
    .select({ id: organizations.id, name: organizations.name, nameAr: organizations.nameAr })
    .from(organizations)
    .where(eq(organizations.id, row.clientOrgId))
    .limit(1);
  const covered = await tx
    .select({ id: projects.id, title: projects.title, state: projects.state, sequence: projects.sequence })
    .from(projects)
    .where(eq(projects.engagementId, id))
    .orderBy(asc(projects.sequence), asc(projects.createdAt));
  const drafts = await tx
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(and(eq(projects.orgId, row.clientOrgId), eq(projects.kind, "client"), isNull(projects.engagementId)))
    .orderBy(asc(projects.createdAt));
  const deliverables = await tx
    .select({
      id: engagementDeliverables.id,
      title: engagementDeliverables.title,
      acceptanceCriteria: engagementDeliverables.acceptanceCriteria,
      dueOn: engagementDeliverables.dueOn,
      projectId: engagementDeliverables.projectId,
    })
    .from(engagementDeliverables)
    .where(eq(engagementDeliverables.engagementId, id))
    .orderBy(asc(engagementDeliverables.dueOn), asc(engagementDeliverables.createdAt));
  // Firm staff see where it came from; the client's admin sees what was agreed.
  const firm = principal.orgKind === "firm";
  const [inquiry] =
    firm && row.inquiryId
      ? await tx.select({ id: inquiries.id, publicRef: inquiries.publicRef }).from(inquiries).where(eq(inquiries.id, row.inquiryId)).limit(1)
      : [];
  const [recorder] = row.createdBy && firm ? await tx.select({ name: user.name }).from(user).where(eq(user.id, row.createdBy)).limit(1) : [];
  const edit = authorize(principal, "engagement.write", resource).allowed;
  return {
    engagement: {
      id: row.id,
      title: row.title,
      signedOn: row.signedOn,
      contractRef: row.contractRef,
      scope: row.scope,
      exclusions: row.exclusions,
      dataAgreementOn: row.dataAgreementOn,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      retainerFollows: row.retainerFollows,
      recordedBy: recorder?.name ?? null,
      createdAt: row.createdAt.toISOString(),
    },
    client: client!,
    inquiry: inquiry ?? null,
    projects: covered,
    drafts: edit ? drafts : [],
    deliverables,
    can: { edit, delete: edit && covered.length === 0 },
  };
}
