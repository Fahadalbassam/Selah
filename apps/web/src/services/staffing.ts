import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
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
  watches,
} from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Resource } from "@/authz";
import { BadRequestError, ConflictError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";

// Staffing: who adds clients, who works on them, and how consultants join.
// Decided 2026-10-20: the firm admin adds clients and names one lead per
// client; the lead adds or removes consultants on that client; consultants
// see client names only and may ask to join; the admin or the lead decides.
// Being on a client's team makes a consultant eligible; the lead (or the
// admin) then staffs them on each project, and they see only those projects.
// Every rule here is also enforced by RLS (drizzle/0003_staffing_security.sql,
// 0008_staffed_visibility.sql).

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

  const canWatch = authorize(principal, "project.watch", { ...resource, type: "organization" }).allowed;
  const watching = canWatch ? await isWatching(tx, principal, { clientOrgId }) : false;

  return {
    client,
    team,
    candidates,
    requests,
    projects: clientProjects,
    watching,
    can: { manage: canManage, setLead: canSetLead, decide: canDecide, watch: canWatch },
  };
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
  // Leaving the client team also takes them off its projects.
  await tx
    .delete(projectMembers)
    .where(
      and(
        eq(projectMembers.userId, userId),
        inArray(projectMembers.projectId, tx.select({ id: projects.id }).from(projects).where(eq(projects.orgId, clientOrgId))),
      ),
    );
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

// ------------------------------------------------------------ projects

async function loadProject(tx: Tx, principal: Principal, projectId: string) {
  const [p] = await tx
    .select({ id: projects.id, kind: projects.kind, orgId: projects.orgId, firmOrgId: projects.firmOrgId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!p) throw new NotFoundError("project");
  const resource: Resource = {
    type: "project",
    id: p.id,
    orgId: p.orgId,
    firmOrgId: p.firmOrgId,
    projectId: p.id,
    projectKind: p.kind,
    clientOrgId: p.kind === "client" ? p.orgId : undefined,
  };
  if (!authorize(principal, "project.read", resource).allowed) throw new NotFoundError("project");
  return { project: p, resource };
}

/**
 * Who works on a project, and whom this user may add: on a client project the
 * client's team (and the admin themselves, to co-consult); on an internal
 * project any firm colleague.
 */
export async function getProjectTeam(tx: Tx, principal: Principal, projectId: string) {
  if (principal.orgKind !== "firm") return null; // the firm's staffing view
  const { project, resource } = await loadProject(tx, principal, projectId);
  const members = await tx
    .select({ userId: projectMembers.userId, isLead: projectMembers.isLead, name: user.name, email: user.email, orgId: orgMemberships.orgId })
    .from(projectMembers)
    .innerJoin(user, eq(user.id, projectMembers.userId))
    .leftJoin(orgMemberships, and(eq(orgMemberships.userId, projectMembers.userId), eq(orgMemberships.active, true)))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(desc(projectMembers.isLead), asc(user.name));
  const firm = members.filter((m) => m.orgId === project.firmOrgId);
  const client = members.filter((m) => m.orgId !== project.firmOrgId);

  const canManage = authorize(principal, "project.manage_members", resource).allowed;
  const staffed = new Set(members.map((m) => m.userId));
  let candidates: { userId: string; name: string; email: string }[] = [];
  if (canManage) {
    candidates =
      project.kind === "client"
        ? await tx
            .select({ userId: user.id, name: user.name, email: user.email })
            .from(clientAssignments)
            .innerJoin(user, eq(user.id, clientAssignments.userId))
            .where(eq(clientAssignments.clientOrgId, project.orgId))
            .orderBy(asc(user.name))
        : await firmColleagues(tx, principal);
    if (project.kind === "client" && principal.role === "firm_admin" && !candidates.some((c) => c.userId === principal.userId)) {
      const [me] = await tx.select({ userId: user.id, name: user.name, email: user.email }).from(user).where(eq(user.id, principal.userId));
      if (me) candidates.push(me);
    }
    candidates = candidates.filter((c) => !staffed.has(c.userId));
  }

  // The client's lead sees the project without being staffed on it.
  const [clientLead] =
    project.kind === "client"
      ? await tx
          .select({ userId: user.id, name: user.name, email: user.email })
          .from(clientAssignments)
          .innerJoin(user, eq(user.id, clientAssignments.userId))
          .where(and(eq(clientAssignments.clientOrgId, project.orgId), eq(clientAssignments.isLead, true)))
          .limit(1)
      : [];

  const canWatch = authorize(principal, "project.watch", resource).allowed;
  return {
    clientLead: clientLead ?? null,
    firm,
    client,
    candidates,
    watching: canWatch ? await isWatching(tx, principal, { projectId }) : false,
    can: { manage: canManage, watch: canWatch },
  };
}

async function firmColleagues(tx: Tx, principal: Principal) {
  return tx
    .select({ userId: user.id, name: user.name, email: user.email })
    .from(orgMemberships)
    .innerJoin(user, eq(user.id, orgMemberships.userId))
    .where(and(eq(orgMemberships.orgId, principal.orgId), eq(orgMemberships.active, true), inArray(orgMemberships.role, ["firm_admin", "consultant"])))
    .orderBy(asc(user.name));
}

/** Staff a firm member on a project (the client's lead, an internal project's lead, or the admin). */
export async function staffProject(tx: Tx, principal: Principal, projectId: string, userId: string) {
  const { project, resource } = await loadProject(tx, principal, projectId);
  if (principal.orgKind !== "firm") throw new NotFoundError("project");
  assertAllowed(principal, "project.manage_members", resource);
  if (project.kind === "client") {
    const coConsult = principal.role === "firm_admin" && userId === principal.userId;
    const [onTeam] = await tx
      .select({ userId: clientAssignments.userId })
      .from(clientAssignments)
      .where(and(eq(clientAssignments.clientOrgId, project.orgId), eq(clientAssignments.userId, userId)))
      .limit(1);
    if (!onTeam && !coConsult) throw new BadRequestError("add them to the client's team first");
  } else if (!(await firmColleagues(tx, principal)).some((c) => c.userId === userId)) {
    throw new BadRequestError("only firm members can join an internal project");
  }
  const inserted = await tx
    .insert(projectMembers)
    .values({ projectId, userId, addedBy: principal.userId })
    .onConflictDoNothing()
    .returning({ userId: projectMembers.userId });
  if (inserted.length && userId !== principal.userId) {
    await tx.insert(notifications).values({ userId, kind: "project.staffed", entityType: "project", entityId: projectId });
  }
  await audit(tx, { actorId: principal.userId, orgId: principal.orgId, action: "project.staff", resourceType: "project", resourceId: projectId, outcome: "allow", meta: { userId } });
  return { ok: true };
}

export async function unstaffProject(tx: Tx, principal: Principal, projectId: string, userId: string) {
  const { resource } = await loadProject(tx, principal, projectId);
  if (principal.orgKind !== "firm") throw new NotFoundError("project");
  assertAllowed(principal, "project.manage_members", resource);
  const [row] = await tx
    .select({ isLead: projectMembers.isLead })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  if (!row) throw new NotFoundError("member");
  // An internal project keeps its lead; only the admin may remove one.
  if (row.isLead && principal.role !== "firm_admin") throw new BadRequestError("the project lead cannot be removed");
  await tx.delete(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
  await audit(tx, { actorId: principal.userId, orgId: principal.orgId, action: "project.unstaff", resourceType: "project", resourceId: projectId, outcome: "allow", meta: { userId } });
  return { ok: true };
}

// ------------------------------------------------------------ watching

type WatchTarget = { projectId: string } | { clientOrgId: string };

async function isWatching(tx: Tx, principal: Principal, target: WatchTarget) {
  const [row] = await tx
    .select({ id: watches.id })
    .from(watches)
    .where(
      and(
        eq(watches.userId, principal.userId),
        "projectId" in target ? eq(watches.projectId, target.projectId) : eq(watches.clientOrgId, target.clientOrgId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** An admin follows (or stops following) a client or a project. */
export async function setWatch(tx: Tx, principal: Principal, target: WatchTarget, on: boolean) {
  const resource =
    "projectId" in target
      ? (await loadProject(tx, principal, target.projectId)).resource
      : { ...assignmentOf(principal, target.clientOrgId), type: "organization" as const };
  assertAllowed(principal, "project.watch", resource);
  if (on) {
    if (!(await isWatching(tx, principal, target))) await tx.insert(watches).values({ userId: principal.userId, ...target });
  } else {
    await tx
      .delete(watches)
      .where(
        and(
          eq(watches.userId, principal.userId),
          "projectId" in target ? eq(watches.projectId, target.projectId) : eq(watches.clientOrgId, target.clientOrgId),
        ),
      );
  }
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: on ? "watch.add" : "watch.remove",
    resourceType: "projectId" in target ? "project" : "organization",
    resourceId: "projectId" in target ? target.projectId : target.clientOrgId,
    outcome: "allow",
  });
  return { watching: on };
}
