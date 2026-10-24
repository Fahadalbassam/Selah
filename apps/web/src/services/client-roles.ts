import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientContacts, orgMemberships, projectClientRoles, user } from "@/db/schema";
import { DECIDING_ROLES, SINGLE_ROLES, type ClientRoleInput, type ClientRoleName } from "@/lib/client-roles";
import { ForbiddenError, type Principal } from "@/authz";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import { loadProject } from "./staffing";

// Client roles on a project (wave 1, item 6): sponsor, coordinator, steering
// committee, acceptors, observers. Each is a client account or a client
// contact, so a consultant-managed client has them too. The database decides
// who may name them (app_can_manage_client_roles) and who may hold them
// (check_client_role); these calls give clear errors and the audit trail.

async function canManage(tx: Tx, projectId: string, byContact: boolean): Promise<boolean> {
  const { rows } = await tx.execute<{ ok: boolean }>(sql`select app_can_manage_client_roles(${projectId}, ${byContact}) as ok`);
  return rows[0]?.ok === true;
}

/** The roles on a project, and whom this user may name. */
export async function listClientRoles(tx: Tx, principal: Principal, projectId: string) {
  const { project } = await loadProject(tx, principal, projectId);
  if (project.kind !== "client") return null;
  const { rows } = await tx.execute<{
    id: string;
    role: ClientRoleName;
    user_id: string | null;
    contact_id: string | null;
    name: string | null;
    title: string | null;
    active: boolean;
  }>(sql`select * from app_project_client_roles(${projectId})`);
  const roles = rows.map((r) => ({ id: r.id, role: r.role, userId: r.user_id, contactId: r.contact_id, name: r.name ?? "", title: r.title, active: r.active }));
  const manage = await canManage(tx, projectId, false);
  const contacts = manage && (await canManage(tx, projectId, true));
  // Accounts: the client's active people; contacts: the firm's records of people without one.
  const people = manage
    ? await tx
        .select({ id: user.id, name: user.name, role: orgMemberships.role })
        .from(orgMemberships)
        .innerJoin(user, eq(user.id, orgMemberships.userId))
        .where(and(eq(orgMemberships.orgId, project.orgId), eq(orgMemberships.active, true)))
        .orderBy(asc(user.name))
    : [];
  const contactRows = contacts
    ? await tx
        .select({ id: clientContacts.id, name: clientContacts.name, title: clientContacts.title })
        .from(clientContacts)
        .where(eq(clientContacts.orgId, project.orgId))
        .orderBy(asc(clientContacts.name))
    : [];
  return {
    roles,
    people: people.map((p) => ({ id: p.id, name: p.name, deciding: p.role === "client_admin" || p.role === "client_manager" })),
    contacts: contactRows,
    can: { manage, contacts },
  };
}

/** Name someone to a role. A second sponsor or coordinator replaces the first. */
export async function addClientRole(tx: Tx, principal: Principal, projectId: string, input: ClientRoleInput) {
  const { project, resource } = await loadProject(tx, principal, projectId);
  if (project.kind !== "client") throw new BadRequestError("client roles are for client projects");
  const [kind, id] = input.person.split(":") as ["user" | "contact", string];
  if (!(await canManage(tx, projectId, kind === "contact"))) throw new ForbiddenError("client_role.manage", resource, "not allowed");
  if (kind === "user" && DECIDING_ROLES.includes(input.role)) {
    const [m] = await tx
      .select({ role: orgMemberships.role })
      .from(orgMemberships)
      .where(and(eq(orgMemberships.userId, id), eq(orgMemberships.orgId, project.orgId), eq(orgMemberships.active, true)))
      .limit(1);
    if (m && m.role !== "client_admin" && m.role !== "client_manager") {
      throw new BadRequestError("the sponsor, coordinator and acceptors are the client's admins or managers");
    }
  }
  if (SINGLE_ROLES.includes(input.role)) {
    await tx.delete(projectClientRoles).where(and(eq(projectClientRoles.projectId, projectId), eq(projectClientRoles.role, input.role)));
    // A client admin can't replace a holder the firm recorded as a contact.
    const [left] = await tx
      .select({ id: projectClientRoles.id })
      .from(projectClientRoles)
      .where(and(eq(projectClientRoles.projectId, projectId), eq(projectClientRoles.role, input.role)))
      .limit(1);
    if (left) throw new ForbiddenError("client_role.manage", resource, "held by a contact the firm recorded");
  } else {
    const same = kind === "user" ? eq(projectClientRoles.userId, id) : eq(projectClientRoles.contactId, id);
    await tx.delete(projectClientRoles).where(and(eq(projectClientRoles.projectId, projectId), eq(projectClientRoles.role, input.role), same));
  }
  // org_id is set by the database from the project.
  await tx.insert(projectClientRoles).values({
    projectId,
    orgId: project.orgId,
    role: input.role,
    userId: kind === "user" ? id : null,
    contactId: kind === "contact" ? id : null,
    createdBy: principal.userId,
  });
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "client_role.add",
    resourceType: "project",
    resourceId: projectId,
    outcome: "allow",
    meta: { role: input.role, person: kind },
  });
  return { ok: true };
}

export async function removeClientRole(tx: Tx, principal: Principal, projectId: string, roleId: string) {
  await loadProject(tx, principal, projectId);
  const gone = await tx
    .delete(projectClientRoles)
    .where(and(eq(projectClientRoles.id, roleId), eq(projectClientRoles.projectId, projectId)))
    .returning({ role: projectClientRoles.role });
  if (!gone.length) throw new NotFoundError("client role");
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "client_role.remove",
    resourceType: "project",
    resourceId: projectId,
    outcome: "allow",
    meta: { role: gone[0]!.role },
  });
  return { ok: true };
}

/** The sponsor's name, for the handover card. */
export async function sponsorOf(tx: Tx, projectId: string) {
  const { rows } = await tx.execute<{ id: string; user_id: string | null; contact_id: string | null; name: string | null }>(
    sql`select id, user_id, contact_id, name from app_project_client_roles(${projectId}) where role = 'sponsor'`,
  );
  const r = rows[0];
  return r ? { id: r.user_id ?? r.contact_id!, name: r.name } : null;
}
