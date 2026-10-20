import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  clientAssignments,
  joinRequests,
  notifications,
  orgMemberships,
  organizations,
  projectMembers,
  projects,
  user,
} from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Resource } from "@/authz";
import { BadRequestError, ConflictError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";

// Staffing: who adds clients, who works on them, and how consultants join.
// Decided 2026-10-20: the firm admin adds clients and names one lead per
// client; the lead adds or removes consultants on that client; consultants
// see client names only and may ask to join; the admin or the lead decides.
// Every rule here is also enforced by RLS (drizzle/0003_staffing_security.sql).

const firmRecord = (p: Principal): Resource => ({ type: "organization", orgId: p.orgId, firmOrgId: p.orgId, projectId: null });

const assignmentOf = (p: Principal, clientOrgId: string): Resource => ({
  type: "client_assignment",
  orgId: clientOrgId,
  firmOrgId: p.orgId,
  projectId: null,
  clientOrgId,
});

const requestFor = (p: Principal, clientOrgId: string, createdBy?: string): Resource => ({
  type: "join_request",
  orgId: p.orgId,
  firmOrgId: p.orgId,
  projectId: null,
  clientOrgId,
  createdBy,
});

function uniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "cause" in err && (err.cause as { code?: string })?.code === "23505";
}

/** Client names for firm staff, with this user's standing on each. No client data. */
export async function clientDirectory(tx: Tx, principal: Principal) {
  if (principal.orgKind !== "firm") return [];
  assertAllowed(principal, "client_directory.read", { type: "client_directory", orgId: principal.orgId, firmOrgId: principal.orgId, projectId: null });
  const rows = await tx.execute<{ id: string; name: string; name_ar: string | null; assigned: boolean; is_lead: boolean; pending: boolean }>(
    sql`select * from app_client_directory()`,
  );
  return rows.rows.map((r) => ({ id: r.id, name: r.name, nameAr: r.name_ar, assigned: r.assigned, isLead: r.is_lead, pending: r.pending }));
}

export async function createClient(tx: Tx, principal: Principal, input: { name: string; nameAr?: string }) {
  assertAllowed(principal, "organization.create", firmRecord(principal));
  // No RETURNING: the read policy is evaluated against the statement's
  // snapshot, which does not contain the new row yet.
  const id = randomUUID();
  await tx.insert(organizations).values({ id, kind: "client", name: input.name, nameAr: input.nameAr });
  await audit(tx, { actorId: principal.userId, orgId: principal.orgId, action: "client.create", resourceType: "organization", resourceId: id, outcome: "allow" });
  return { id };
}

/** One client's team, the consultants who could join it, and its pending requests. */
export async function getClientTeam(tx: Tx, principal: Principal, clientOrgId: string) {
  const [client] = await tx
    .select({ id: organizations.id, name: organizations.name, nameAr: organizations.nameAr })
    .from(organizations)
    .where(and(eq(organizations.id, clientOrgId), eq(organizations.kind, "client")))
    .limit(1);
  if (!client) throw new NotFoundError("client");
  const resource = assignmentOf(principal, clientOrgId);
  assertAllowed(principal, "client_assignment.read", resource);

  const team = await tx
    .select({ userId: clientAssignments.userId, isLead: clientAssignments.isLead, name: user.name, email: user.email, since: clientAssignments.createdAt })
    .from(clientAssignments)
    .innerJoin(user, eq(user.id, clientAssignments.userId))
    .where(eq(clientAssignments.clientOrgId, clientOrgId))
    .orderBy(desc(clientAssignments.isLead), asc(user.name));

  const canManage = authorize(principal, "client_assignment.manage", resource).allowed;
  const canSetLead = authorize(principal, "client_assignment.set_lead", resource).allowed;
  const canDecide = authorize(principal, "join_request.decide", requestFor(principal, clientOrgId)).allowed;

  const onTeam = new Set(team.map((m) => m.userId));
  const candidates = canManage
    ? (
        await tx
          .select({ userId: user.id, name: user.name, email: user.email })
          .from(orgMemberships)
          .innerJoin(user, eq(user.id, orgMemberships.userId))
          .where(and(eq(orgMemberships.orgId, principal.orgId), eq(orgMemberships.role, "consultant"), eq(orgMemberships.active, true)))
          .orderBy(asc(user.name))
      ).filter((c) => !onTeam.has(c.userId))
    : [];

  const requests = canDecide
    ? await tx
        .select({ id: joinRequests.id, reason: joinRequests.reason, createdAt: joinRequests.createdAt, name: user.name, email: user.email })
        .from(joinRequests)
        .innerJoin(user, eq(user.id, joinRequests.userId))
        .where(and(eq(joinRequests.clientOrgId, clientOrgId), eq(joinRequests.status, "pending")))
        .orderBy(asc(joinRequests.createdAt))
    : [];

  const clientProjects = await tx
    .select({ id: projects.id, title: projects.title, state: projects.state })
    .from(projects)
    .where(eq(projects.orgId, clientOrgId))
    .orderBy(asc(projects.title));

  return { client, team, candidates, requests, projects: clientProjects, can: { manage: canManage, setLead: canSetLead, decide: canDecide } };
}

async function assertConsultant(tx: Tx, principal: Principal, userId: string) {
  const [m] = await tx
    .select({ role: orgMemberships.role })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.userId, userId), eq(orgMemberships.orgId, principal.orgId), eq(orgMemberships.active, true)))
    .limit(1);
  if (m?.role !== "consultant") throw new BadRequestError("only active consultants can be assigned to clients");
}

export async function addConsultant(tx: Tx, principal: Principal, clientOrgId: string, userId: string) {
  assertAllowed(principal, "client_assignment.manage", assignmentOf(principal, clientOrgId));
  await assertConsultant(tx, principal, userId);
  const inserted = await tx
    .insert(clientAssignments)
    .values({ clientOrgId, userId, assignedBy: principal.userId })
    .onConflictDoNothing()
    .returning({ userId: clientAssignments.userId });
  if (inserted.length) {
    await tx.insert(notifications).values({ userId, kind: "client.assigned", entityType: "organization", entityId: clientOrgId });
  }
  await audit(tx, { actorId: principal.userId, orgId: principal.orgId, action: "client_assignment.add", resourceType: "organization", resourceId: clientOrgId, outcome: "allow", meta: { userId } });
  return { ok: true };
}

export async function removeConsultant(tx: Tx, principal: Principal, clientOrgId: string, userId: string) {
  const resource = assignmentOf(principal, clientOrgId);
  assertAllowed(principal, "client_assignment.manage", resource);
  const [row] = await tx
    .select({ isLead: clientAssignments.isLead })
    .from(clientAssignments)
    .where(and(eq(clientAssignments.clientOrgId, clientOrgId), eq(clientAssignments.userId, userId)))
    .limit(1);
  if (!row) throw new NotFoundError("assignment");
  // Removing the lead leaves the client without one: only the admin may.
  if (row.isLead) assertAllowed(principal, "client_assignment.set_lead", resource);
  await tx.delete(clientAssignments).where(and(eq(clientAssignments.clientOrgId, clientOrgId), eq(clientAssignments.userId, userId)));
  await audit(tx, { actorId: principal.userId, orgId: principal.orgId, action: "client_assignment.remove", resourceType: "organization", resourceId: clientOrgId, outcome: "allow", meta: { userId } });
  return { ok: true };
}

/** Make `userId` the client's lead (adding them to the team if needed). */
export async function setLead(tx: Tx, principal: Principal, clientOrgId: string, userId: string) {
  assertAllowed(principal, "client_assignment.set_lead", assignmentOf(principal, clientOrgId));
  await assertConsultant(tx, principal, userId);
  await tx
    .update(clientAssignments)
    .set({ isLead: false })
    .where(and(eq(clientAssignments.clientOrgId, clientOrgId), eq(clientAssignments.isLead, true)));
  await tx
    .insert(clientAssignments)
    .values({ clientOrgId, userId, isLead: true, assignedBy: principal.userId })
    .onConflictDoUpdate({ target: [clientAssignments.clientOrgId, clientAssignments.userId], set: { isLead: true } });
  await tx.insert(notifications).values({ userId, kind: "client.lead", entityType: "organization", entityId: clientOrgId });
  await audit(tx, { actorId: principal.userId, orgId: principal.orgId, action: "client_assignment.set_lead", resourceType: "organization", resourceId: clientOrgId, outcome: "allow", meta: { userId } });
  return { ok: true };
}

export async function requestToJoin(tx: Tx, principal: Principal, clientOrgId: string, reason: string) {
  assertAllowed(principal, "join_request.create", requestFor(principal, clientOrgId, principal.userId));
  if (principal.assignedClientIds.has(clientOrgId)) throw new BadRequestError("already on this client");
  try {
    const [row] = await tx
      .insert(joinRequests)
      .values({ clientOrgId, userId: principal.userId, reason })
      .returning({ id: joinRequests.id });
    await audit(tx, { actorId: principal.userId, orgId: principal.orgId, action: "join_request.create", resourceType: "organization", resourceId: clientOrgId, outcome: "allow" });
    return { id: row!.id };
  } catch (err) {
    if (uniqueViolation(err)) throw new ConflictError("a request is already pending");
    throw err;
  }
}

async function loadRequest(tx: Tx, id: string) {
  const [row] = await tx.select().from(joinRequests).where(eq(joinRequests.id, id)).limit(1);
  if (!row) throw new NotFoundError("join request");
  return row;
}

export async function withdrawRequest(tx: Tx, principal: Principal, id: string) {
  const row = await loadRequest(tx, id);
  if (row.userId !== principal.userId || row.status !== "pending") throw new NotFoundError("join request");
  await tx.update(joinRequests).set({ status: "withdrawn" }).where(eq(joinRequests.id, id));
  return { ok: true };
}

export async function decideRequest(tx: Tx, principal: Principal, id: string, input: { approve: boolean; note?: string }) {
  const row = await loadRequest(tx, id);
  assertAllowed(principal, "join_request.decide", requestFor(principal, row.clientOrgId, row.userId));
  if (row.status !== "pending") throw new ConflictError("this request was already decided");
  await tx
    .update(joinRequests)
    .set({ status: input.approve ? "approved" : "declined", decidedBy: principal.userId, decisionNote: input.note })
    .where(eq(joinRequests.id, id));
  if (input.approve) {
    await tx
      .insert(clientAssignments)
      .values({ clientOrgId: row.clientOrgId, userId: row.userId, assignedBy: principal.userId })
      .onConflictDoNothing();
  }
  await tx.insert(notifications).values({
    userId: row.userId,
    kind: input.approve ? "join_request.approved" : "join_request.declined",
    entityType: "organization",
    entityId: row.clientOrgId,
  });
  await audit(tx, { actorId: principal.userId, orgId: principal.orgId, action: "join_request.decide", resourceType: "organization", resourceId: row.clientOrgId, outcome: "allow", meta: { approve: input.approve, requester: row.userId } });
  return { ok: true };
}

/** Pending requests this user may decide, across clients (for the clients page). */
export async function pendingRequestCounts(tx: Tx, principal: Principal) {
  if (principal.orgKind !== "firm") return new Map<string, number>();
  const rows = await tx
    .select({ clientOrgId: joinRequests.clientOrgId, n: sql<number>`count(*)::int` })
    .from(joinRequests)
    .where(and(eq(joinRequests.status, "pending")))
    .groupBy(joinRequests.clientOrgId);
  return new Map(
    rows
      .filter((r) => authorize(principal, "join_request.decide", requestFor(principal, r.clientOrgId)).allowed)
      .map((r) => [r.clientOrgId, r.n]),
  );
}

/** My own pending request ids by client, so I can withdraw them. */
export async function myPendingRequests(tx: Tx, principal: Principal) {
  const rows = await tx
    .select({ id: joinRequests.id, clientOrgId: joinRequests.clientOrgId })
    .from(joinRequests)
    .where(and(eq(joinRequests.userId, principal.userId), eq(joinRequests.status, "pending")));
  return new Map(rows.map((r) => [r.clientOrgId, r.id]));
}

/** Any firm member may start an internal project; they become its lead. */
export async function createInternalProject(tx: Tx, principal: Principal, input: { title: string; description?: string }) {
  assertAllowed(principal, "project.create_internal", { ...firmRecord(principal), type: "project", projectKind: "internal" });
  const id = randomUUID();
  // No RETURNING: the new row becomes visible to its creator only once they are its lead.
  await tx.insert(projects).values({
    id,
    kind: "internal",
    orgId: principal.orgId,
    firmOrgId: principal.orgId,
    title: input.title,
    description: input.description,
    state: "active",
    createdBy: principal.userId,
  });
  await tx.insert(projectMembers).values({ projectId: id, userId: principal.userId, isLead: true, addedBy: principal.userId });
  await audit(tx, { actorId: principal.userId, orgId: principal.orgId, action: "project.create_internal", resourceType: "project", resourceId: id, outcome: "allow" });
  return { id };
}
