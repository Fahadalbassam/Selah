import "server-only";
import { and, asc, count, eq, ne } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  clientContacts,
  departmentMembers,
  departments,
  documents,
  firmSettings,
  orgMemberships,
  organizations,
  user,
} from "@/db/schema";
import { assertAllowed, authorize, type EngagementMode, type Principal, type Resource } from "@/authz";
import { SHORT_NAMES } from "@/lib/engagement";
import { parseShortNames } from "@/lib/masking";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";

// How a client takes part, and its optional departments
// (baseline: Engagement). The database holds every rule: which
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
      nameAr: organizations.nameAr,
      engagementMode: organizations.engagementMode,
      departmentsEnabled: organizations.departmentsEnabled,
      minimalRecords: organizations.minimalRecords,
      displayAlias: organizations.displayAlias,
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
  const canChangeMode = authorize(principal, "organization.engagement", orgRecord(principal, "organization", orgId)).allowed;
  return {
    ...org,
    canChangeMode,
    canManageDepartments: authorize(principal, "department.manage", orgRecord(principal, "department", orgId)).allowed,
    departments: depts.map((d) => ({ ...d, members: members.filter((m) => m.departmentId === d.id) })),
    fit: canChangeMode ? await modeFit(tx, principal, orgId) : null,
  };
}

/**
 * What stands in the way of each mode, so the screen can say so before the
 * firm admin tries. The database still decides (baseline: Engagement and Insight).
 */
async function modeFit(tx: Tx, principal: Principal, orgId: string) {
  const active = and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.active, true));
  // One after another: a transaction's connection runs one query at a time.
  const [accounts] = await tx.select({ n: count() }).from(orgMemberships).where(active);
  const [nonAdmin] = await tx
    .select({ n: count() })
    .from(orgMemberships)
    .where(and(active, ne(orgMemberships.role, "client_admin")));
  const [settings] = await tx.select({ max: firmSettings.restrictedMaxAdmins }).from(firmSettings).where(eq(firmSettings.orgId, principal.orgId));
  const [contacts] = await tx.select({ n: count() }).from(clientContacts).where(eq(clientContacts.orgId, orgId));
  const [files] = await tx.select({ n: count() }).from(documents).where(eq(documents.orgId, orgId));
  return {
    activeAccounts: accounts!.n,
    nonAdminAccounts: nonAdmin!.n,
    restrictedMaxAdmins: settings?.max ?? 2,
    // Minimal records start before anything is filed.
    hasContactsOrFiles: contacts!.n + files!.n > 0,
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
  input: { engagementMode?: EngagementMode; departmentsEnabled?: boolean; minimalRecords?: boolean; displayAlias?: string },
) {
  // Minimal records (consultant-managed only): the alias replaces the name.
  if (input.engagementMode !== undefined || input.minimalRecords !== undefined || input.displayAlias !== undefined) {
    assertAllowed(principal, "organization.engagement", orgRecord(principal, "organization", orgId));
  }
  if (input.departmentsEnabled !== undefined) {
    assertAllowed(principal, "department.manage", orgRecord(principal, "department", orgId));
  }
  await clientOrg(tx, orgId);
  await tx.update(organizations).set(input).where(eq(organizations.id, orgId));
  return clientOrg(tx, orgId);
}

/**
 * The short forms people write for a company, in either language ("Al-Nukhba",
 * "النخبة"), so they are masked before a hosted model sees them. Firm admin
 * only; the database checks that and the limits (baseline: Name variants).
 */
export async function setShortNames(tx: Tx, principal: Principal, orgId: string, text: string) {
  assertAllowed(principal, "organization.engagement", orgRecord(principal, "organization", orgId));
  const shortNames = parseShortNames(text);
  if (shortNames.length > SHORT_NAMES.count) throw new BadRequestError(`up to ${SHORT_NAMES.count} short names`);
  if (shortNames.some((n) => n.length < SHORT_NAMES.min || n.length > SHORT_NAMES.max))
    throw new BadRequestError(`each short name is ${SHORT_NAMES.min} to ${SHORT_NAMES.max} characters`);
  const [row] = await tx.update(organizations).set({ shortNames }).where(eq(organizations.id, orgId)).returning({ id: organizations.id });
  if (!row) throw new NotFoundError("organization");
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "organization.short_names",
    resourceType: "organization",
    resourceId: orgId,
    outcome: "allow",
    meta: { count: shortNames.length },
  });
  return { shortNames };
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

/**
 * What an action can be filed under: the client's active departments, when it
 * uses them. Null when the caller may not read the client's departments (a
 * consultant staffed on the project but not assigned to the client), so the
 * action page leaves the picker out instead of failing.
 */
export async function departmentChoices(tx: Tx, principal: Principal, orgId: string) {
  if (!authorize(principal, "department.read", orgRecord(principal, "department", orgId)).allowed) return null;
  const [org] = await tx.select({ on: organizations.departmentsEnabled }).from(organizations).where(eq(organizations.id, orgId));
  const list = await tx
    .select({ id: departments.id, nameAr: departments.nameAr, nameEn: departments.nameEn, active: departments.active })
    .from(departments)
    .where(eq(departments.orgId, orgId))
    .orderBy(asc(departments.nameAr));
  return { enabled: org?.on ?? false, departments: list };
}
