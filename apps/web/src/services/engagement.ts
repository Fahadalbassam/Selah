import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { departmentMembers, departments, organizations, user } from "@/db/schema";
import { assertAllowed, authorize, type EngagementMode, type Principal, type Resource } from "@/authz";
import { BadRequestError, NotFoundError } from "@/server/errors";

// How a client takes part, and its optional departments
// (drizzle/0025_engagement_rules.sql). The database holds every rule: which
// accounts a mode allows, who may change it, who sees a department's work.
// Mode and department switches are written to the audit log by the database.

const orgRecord = (principal: Principal, type: "organization" | "department", orgId: string): Resource => ({
  type,
  orgId,
  firmOrgId: principal.orgKind === "firm" ? principal.orgId : undefined,
  projectId: null,
});

async function clientOrg(tx: Tx, orgId: string) {
  const [org] = await tx
    .select({
      id: organizations.id,
      name: organizations.name,
      engagementMode: organizations.engagementMode,
      departmentsEnabled: organizations.departmentsEnabled,
    })
    .from(organizations)
    .where(and(eq(organizations.id, orgId), eq(organizations.kind, "client")));
  if (!org) throw new NotFoundError("client");
  return org;
}

/** A client's mode, whether departments are on, and its departments with their people. */
export async function getEngagement(tx: Tx, principal: Principal, orgId: string) {
  assertAllowed(principal, "department.read", orgRecord(principal, "department", orgId));
  const org = await clientOrg(tx, orgId);
  const depts = await tx
    .select({ id: departments.id, nameAr: departments.nameAr, nameEn: departments.nameEn, active: departments.active })
    .from(departments)
    .where(eq(departments.orgId, orgId))
    .orderBy(asc(departments.nameAr));
  // Row-level security limits members to what the caller may see.
  const members = await tx
    .select({ departmentId: departmentMembers.departmentId, userId: user.id, name: user.name, isHead: departmentMembers.isHead })
    .from(departmentMembers)
    .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
    .innerJoin(user, eq(user.id, departmentMembers.userId))
    .where(eq(departments.orgId, orgId))
    .orderBy(asc(user.name));
  return {
    ...org,
    canChangeMode: authorize(principal, "organization.engagement", orgRecord(principal, "organization", orgId)).allowed,
    canManageDepartments: authorize(principal, "department.manage", orgRecord(principal, "department", orgId)).allowed,
    departments: depts.map((d) => ({ ...d, members: members.filter((m) => m.departmentId === d.id) })),
  };
}

/**
 * Change how a client takes part (firm admin), or switch departments on or
 * off (the client's admin or the firm admin). Nothing is deleted: a mode
 * is refused while the client has accounts that do not fit it.
 */
export async function setEngagement(
  tx: Tx,
  principal: Principal,
  orgId: string,
  input: { engagementMode?: EngagementMode; departmentsEnabled?: boolean },
) {
  if (input.engagementMode !== undefined) {
    assertAllowed(principal, "organization.engagement", orgRecord(principal, "organization", orgId));
  }
  if (input.departmentsEnabled !== undefined) {
    assertAllowed(principal, "department.manage", orgRecord(principal, "department", orgId));
  }
  await clientOrg(tx, orgId);
  await tx.update(organizations).set(input).where(eq(organizations.id, orgId));
  return clientOrg(tx, orgId);
}

export interface DepartmentInput {
  nameAr: string;
  nameEn?: string | null;
}

export async function createDepartment(tx: Tx, principal: Principal, orgId: string, input: DepartmentInput) {
  assertAllowed(principal, "department.manage", orgRecord(principal, "department", orgId));
  await clientOrg(tx, orgId);
  const [row] = await tx
    .insert(departments)
    .values({ orgId, nameAr: input.nameAr, nameEn: input.nameEn })
    .returning({ id: departments.id });
  return row!;
}

async function departmentOrg(tx: Tx, id: string) {
  const [d] = await tx.select({ orgId: departments.orgId }).from(departments).where(eq(departments.id, id));
  if (!d) throw new NotFoundError("department");
  return d.orgId;
}

/** Rename, or switch off (its rows stay filed under it; new ones cannot be). */
export async function updateDepartment(
  tx: Tx,
  principal: Principal,
  id: string,
  input: Partial<DepartmentInput> & { active?: boolean },
) {
  assertAllowed(principal, "department.manage", orgRecord(principal, "department", await departmentOrg(tx, id)));
  await tx.update(departments).set(input).where(eq(departments.id, id));
  return { ok: true };
}

/** Add a person to a department, or change whether they head it. */
export async function putDepartmentMember(tx: Tx, principal: Principal, id: string, userId: string, input: { isHead: boolean }) {
  assertAllowed(principal, "department.manage", orgRecord(principal, "department", await departmentOrg(tx, id)));
  await tx
    .insert(departmentMembers)
    .values({ departmentId: id, userId, isHead: input.isHead })
    .onConflictDoUpdate({ target: [departmentMembers.departmentId, departmentMembers.userId], set: { isHead: input.isHead } });
  return { ok: true };
}

export async function removeDepartmentMember(tx: Tx, principal: Principal, id: string, userId: string) {
  assertAllowed(principal, "department.manage", orgRecord(principal, "department", await departmentOrg(tx, id)));
  const removed = await tx
    .delete(departmentMembers)
    .where(and(eq(departmentMembers.departmentId, id), eq(departmentMembers.userId, userId)))
    .returning({ userId: departmentMembers.userId });
  if (!removed.length) throw new BadRequestError("that person is not in this department");
  return { ok: true };
}
