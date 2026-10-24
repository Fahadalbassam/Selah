import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientGroupMembers, clientGroups, clientGroupViewers, departments, orgMemberships, organizations, user } from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Resource } from "@/authz";
import { firmToday } from "@/lib/dates";
import { ConflictError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import { EMPTY, numbers, type ClientNumbers, type Row } from "./client-overview";

// Holding groups (F34, decision D4). A group is a record of its own, kept by
// the firm admin. Each member company is either its own linked client (data
// kept apart, such as a listed subsidiary) or a unit inside one member client
// (a department marked as a company: shared people and files). The group
// page pools the counts of its member companies, whichever form they take,
// with a row per company beside the total. It opens nothing: each row's work
// is still read on its own client's pages, by whoever may read it there.

const groupRecord = (p: Principal, id?: string): Resource => ({
  type: "client_group",
  id,
  orgId: p.orgId,
  firmOrgId: p.orgId,
  projectId: null,
});

function uniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "cause" in err && (err.cause as { code?: string })?.code === "23505";
}

/** Pooled counts: added up, with the percentage worked out again from the sums (never averaged). */
function pool(parts: ClientNumbers[], sign: 1 | -1 = 1): ClientNumbers {
  const out = { ...EMPTY };
  parts.forEach((n, i) => {
    const s = i === 0 ? 1 : sign;
    out.total += s * n.total;
    out.verified += s * n.verified;
    out.partially += s * n.partially;
    out.riskAccepted += s * n.riskAccepted;
    out.notApplicable += s * n.notApplicable;
    out.superseded += s * n.superseded;
    out.open += s * n.open;
    out.overdue += s * n.overdue;
    out.awaitingReview += s * n.awaitingReview;
    out.blocked += s * n.blocked;
  });
  const applies = out.total - out.notApplicable - out.superseded;
  // As app_client_progress rounds: one decimal.
  out.implementedPct = applies > 0 ? Math.round((1000 * out.verified) / applies) / 10 : null;
  return out;
}

export interface GroupCompany {
  /** "unit": a company inside a member client; "client": a linked client (its own work, outside its units). */
  kind: "client" | "unit";
  client: { id: string; name: string; nameAr: string | null };
  unit: { id: string; nameAr: string; nameEn: string | null } | null;
  /** A linked client that also holds units: this row is its work outside them. */
  hasUnits: boolean;
  numbers: ClientNumbers;
}

/** Splits each member client's numbers into its units and the rest, then pools them all. */
export function groupCompanies(
  members: { id: string; name: string; nameAr: string | null }[],
  totals: Map<string, ClientNumbers>,
  units: { id: string; orgId: string; nameAr: string; nameEn: string | null; numbers: ClientNumbers }[],
) {
  const companies: GroupCompany[] = [];
  for (const m of members) {
    const mine = units.filter((u) => u.orgId === m.id);
    const total = totals.get(m.id) ?? EMPTY;
    for (const u of mine) {
      companies.push({ kind: "unit", client: m, unit: { id: u.id, nameAr: u.nameAr, nameEn: u.nameEn }, hasUnits: false, numbers: u.numbers });
    }
    companies.push({
      kind: "client",
      client: m,
      unit: null,
      hasUnits: mine.length > 0,
      numbers: mine.length ? pool([total, ...mine.map((u) => u.numbers)], -1) : total,
    });
  }
  return { total: pool(members.map((m) => totals.get(m.id) ?? EMPTY)), companies };
}

/** The groups this person can see, with the member clients they can see. Firm only. */
export async function listGroups(tx: Tx, principal: Principal) {
  if (principal.orgKind !== "firm") return [];
  assertAllowed(principal, "client_group.read", groupRecord(principal));
  const groups = await tx
    .select({ id: clientGroups.id, nameAr: clientGroups.nameAr, nameEn: clientGroups.nameEn })
    .from(clientGroups)
    .orderBy(asc(clientGroups.nameAr));
  const members = groups.length
    ? await tx
        .select({ groupId: clientGroupMembers.groupId, id: organizations.id, name: organizations.name, nameAr: organizations.nameAr })
        .from(clientGroupMembers)
        .innerJoin(organizations, eq(organizations.id, clientGroupMembers.clientOrgId))
        .where(inArray(clientGroupMembers.groupId, groups.map((g) => g.id)))
        .orderBy(asc(organizations.name))
    : [];
  return groups.map((g) => ({ ...g, members: members.filter((m) => m.groupId === g.id) }));
}

export async function createGroup(tx: Tx, principal: Principal, input: { nameAr: string; nameEn?: string | null; notes?: string | null }) {
  assertAllowed(principal, "client_group.manage", groupRecord(principal));
  // No RETURNING: the read policy can't see the new row in the statement's snapshot.
  const id = randomUUID();
  try {
    await tx.insert(clientGroups).values({ id, firmOrgId: principal.orgId, nameAr: input.nameAr, nameEn: input.nameEn ?? null, notes: input.notes ?? null });
  } catch (err) {
    if (uniqueViolation(err)) throw new ConflictError("a group with that name exists");
    throw err;
  }
  await audit(tx, { actorId: principal.userId, orgId: principal.orgId, action: "client_group.create", resourceType: "client_group", resourceId: id, outcome: "allow" });
  return { id };
}

export async function updateGroup(
  tx: Tx,
  principal: Principal,
  groupId: string,
  input: { nameAr?: string; nameEn?: string | null; notes?: string | null },
) {
  assertAllowed(principal, "client_group.manage", groupRecord(principal, groupId));
  let changed: { id: string }[];
  try {
    changed = await tx.update(clientGroups).set(input).where(eq(clientGroups.id, groupId)).returning({ id: clientGroups.id });
  } catch (err) {
    if (uniqueViolation(err)) throw new ConflictError("a group with that name exists");
    throw err;
  }
  if (!changed.length) throw new NotFoundError("group");
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "client_group.update",
    resourceType: "client_group",
    resourceId: groupId,
    outcome: "allow",
    meta: { fields: Object.keys(input).sort().join(",") },
  });
  return { ok: true };
}

/** Removing a group ends the links only: every member stays a client with its own data. */
export async function deleteGroup(tx: Tx, principal: Principal, groupId: string) {
  assertAllowed(principal, "client_group.manage", groupRecord(principal, groupId));
  const members = await tx.select({ id: clientGroupMembers.clientOrgId }).from(clientGroupMembers).where(eq(clientGroupMembers.groupId, groupId));
  const gone = await tx.delete(clientGroups).where(eq(clientGroups.id, groupId)).returning({ id: clientGroups.id });
  if (!gone.length) throw new NotFoundError("group");
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "client_group.delete",
    resourceType: "client_group",
    resourceId: groupId,
    outcome: "allow",
    meta: { members: members.length },
  });
  return { ok: true };
}

/** Links a client to the group as its own member company. A client is in one group at most. */
export async function addMember(tx: Tx, principal: Principal, groupId: string, clientOrgId: string) {
  assertAllowed(principal, "client_group.manage", groupRecord(principal, groupId));
  const [group] = await tx.select({ id: clientGroups.id }).from(clientGroups).where(eq(clientGroups.id, groupId)).limit(1);
  if (!group) throw new NotFoundError("group");
  const [client] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.id, clientOrgId), eq(organizations.kind, "client")))
    .limit(1);
  if (!client) throw new NotFoundError("client");
  try {
    await tx.insert(clientGroupMembers).values({ groupId, clientOrgId });
  } catch (err) {
    if (uniqueViolation(err)) throw new ConflictError("that client is already in a group");
    throw err;
  }
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "client_group.add_member",
    resourceType: "client_group",
    resourceId: groupId,
    outcome: "allow",
    meta: { clientOrgId },
  });
  return { ok: true };
}

/** Unlinks a client. Its companies inside it become plain departments again (client_left_group()). */
export async function removeMember(tx: Tx, principal: Principal, groupId: string, clientOrgId: string) {
  assertAllowed(principal, "client_group.manage", groupRecord(principal, groupId));
  const gone = await tx
    .delete(clientGroupMembers)
    .where(and(eq(clientGroupMembers.groupId, groupId), eq(clientGroupMembers.clientOrgId, clientOrgId)))
    .returning({ id: clientGroupMembers.clientOrgId });
  if (!gone.length) throw new NotFoundError("member");
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "client_group.remove_member",
    resourceType: "client_group",
    resourceId: groupId,
    outcome: "allow",
    meta: { clientOrgId },
  });
  return { ok: true };
}

/**
 * Marks one of a member client's departments as a company of the group kept
 * inside that client (shared people and files), or turns it back into a
 * plain department. Its work and people stay where they are.
 */
export async function setCompany(tx: Tx, principal: Principal, groupId: string, departmentId: string, isCompany: boolean) {
  assertAllowed(principal, "client_group.manage", groupRecord(principal, groupId));
  const [dept] = await tx
    .select({ orgId: departments.orgId, isCompany: departments.isCompany })
    .from(departments)
    .innerJoin(clientGroupMembers, eq(clientGroupMembers.clientOrgId, departments.orgId))
    .where(and(eq(departments.id, departmentId), eq(clientGroupMembers.groupId, groupId)))
    .limit(1);
  if (!dept) throw new NotFoundError("department");
  if (dept.isCompany === isCompany) return { ok: true };
  await tx.update(departments).set({ isCompany }).where(eq(departments.id, departmentId));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: isCompany ? "client_group.set_company" : "client_group.clear_company",
    resourceType: "client_group",
    resourceId: groupId,
    outcome: "allow",
    meta: { clientOrgId: dept.orgId, departmentId },
  });
  return { ok: true };
}

/**
 * One group for firm staff: the pooled counts of the member companies this
 * person can see, with a row per company. The counts come from
 * app_client_progress (F30) under the reader's row-level security, so a
 * consultant counts only the member clients they are assigned to, and in
 * them only the work they could open.
 */
export async function groupOverview(tx: Tx, principal: Principal, groupId: string, today = firmToday()) {
  if (principal.orgKind !== "firm") throw new NotFoundError("group");
  assertAllowed(principal, "client_group.read", groupRecord(principal, groupId));
  const [group] = await tx
    .select({ id: clientGroups.id, nameAr: clientGroups.nameAr, nameEn: clientGroups.nameEn, notes: clientGroups.notes })
    .from(clientGroups)
    .where(eq(clientGroups.id, groupId))
    .limit(1);
  if (!group) throw new NotFoundError("group");

  const members = await tx
    .select({
      id: organizations.id,
      name: organizations.name,
      nameAr: organizations.nameAr,
      status: organizations.status,
      isHolding: clientGroupMembers.isHolding,
    })
    .from(clientGroupMembers)
    .innerJoin(organizations, eq(organizations.id, clientGroupMembers.clientOrgId))
    .where(eq(clientGroupMembers.groupId, groupId))
    .orderBy(asc(organizations.name));
  const ids = members.map((m) => m.id);

  const { rows } = ids.length
    ? await tx.execute<Row & { client_org_id: string }>(sql`
        select m.client_org_id, p.* from client_group_members m
        cross join lateral app_client_progress(m.client_org_id, ${today}::date) p
        where m.group_id = ${groupId}::uuid and p.scope in ('client', 'department')`)
    : { rows: [] as (Row & { client_org_id: string })[] };
  const totals = new Map(rows.filter((r) => r.scope === "client").map((r) => [r.client_org_id, numbers(r)]));
  const byDept = new Map(rows.filter((r) => r.scope === "department" && r.department_id).map((r) => [r.department_id as string, numbers(r)]));

  const depts = ids.length
    ? await tx
        .select({ id: departments.id, orgId: departments.orgId, nameAr: departments.nameAr, nameEn: departments.nameEn, isCompany: departments.isCompany, active: departments.active })
        .from(departments)
        .where(inArray(departments.orgId, ids))
        .orderBy(asc(departments.nameAr))
    : [];
  const units = depts.filter((d) => d.isCompany).map((d) => ({ ...d, numbers: byDept.get(d.id) ?? EMPTY }));
  const { total, companies } = groupCompanies(members, totals, units);

  const manage = authorize(principal, "client_group.manage", groupRecord(principal, groupId)).allowed;
  // What the admin can link: clients in no group yet.
  const candidates = manage
    ? await tx
        .select({ id: organizations.id, name: organizations.name, nameAr: organizations.nameAr })
        .from(organizations)
        .where(
          and(
            eq(organizations.kind, "client"),
            eq(organizations.status, "active"),
            notInArray(organizations.id, tx.select({ id: clientGroupMembers.clientOrgId }).from(clientGroupMembers)),
          ),
        )
        .orderBy(asc(organizations.name))
    : [];

  // Who at the holding reads the group's roll-up (part 2), shown to firm
  // staff who work with the holding; the admin also gets who could be named.
  const holding = members.find((m) => m.isHolding) ?? null;
  const viewers = holding
    ? await tx
        .select({ userId: user.id, name: user.name, email: user.email, since: clientGroupViewers.createdAt })
        .from(clientGroupViewers)
        .innerJoin(user, eq(user.id, clientGroupViewers.userId))
        .where(eq(clientGroupViewers.groupId, groupId))
        .orderBy(asc(user.name))
    : [];
  const viewerCandidates =
    manage && holding
      ? (
          await tx
            .select({ userId: user.id, name: user.name, email: user.email, role: orgMemberships.role })
            .from(orgMemberships)
            .innerJoin(user, eq(user.id, orgMemberships.userId))
            .where(
              and(
                eq(orgMemberships.orgId, holding.id),
                eq(orgMemberships.active, true),
                inArray(orgMemberships.role, ["client_admin", "client_manager"]),
              ),
            )
            .orderBy(asc(user.name))
        ).filter((c) => !viewers.some((v) => v.userId === c.userId))
      : [];

  return {
    group,
    today,
    total,
    companies,
    holding: holding ? { id: holding.id, name: holding.name, nameAr: holding.nameAr } : null,
    viewers,
    viewerCandidates,
    members: members.map((m) => ({
      ...m,
      units: units.filter((u) => u.orgId === m.id).map((u) => ({ id: u.id, nameAr: u.nameAr, nameEn: u.nameEn })),
      // Departments the admin could mark as a company inside this client.
      departments: manage ? depts.filter((d) => d.orgId === m.id && !d.isCompany && d.active).map((d) => ({ id: d.id, nameAr: d.nameAr, nameEn: d.nameEn })) : [],
    })),
    candidates,
    can: { manage },
  };
}

export type GroupOverview = Awaited<ReturnType<typeof groupOverview>>;

/**
 * Names the member client that is the group's holding, or with null names
 * none. Grants to people of a former holding end (viewers_follow_holding()).
 */
export async function setHolding(tx: Tx, principal: Principal, groupId: string, clientOrgId: string | null) {
  assertAllowed(principal, "client_group.manage", groupRecord(principal, groupId));
  if (clientOrgId) {
    const [member] = await tx
      .select({ isHolding: clientGroupMembers.isHolding })
      .from(clientGroupMembers)
      .where(and(eq(clientGroupMembers.groupId, groupId), eq(clientGroupMembers.clientOrgId, clientOrgId)))
      .limit(1);
    if (!member) throw new NotFoundError("member");
    if (member.isHolding) return { ok: true };
  }
  await tx
    .update(clientGroupMembers)
    .set({ isHolding: false })
    .where(and(eq(clientGroupMembers.groupId, groupId), eq(clientGroupMembers.isHolding, true)));
  if (clientOrgId) {
    await tx
      .update(clientGroupMembers)
      .set({ isHolding: true })
      .where(and(eq(clientGroupMembers.groupId, groupId), eq(clientGroupMembers.clientOrgId, clientOrgId)));
  }
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "client_group.set_holding",
    resourceType: "client_group",
    resourceId: groupId,
    outcome: "allow",
    meta: { clientOrgId },
  });
  return { ok: true };
}

/** Grants a named admin or manager of the holding the group's roll-up (the database checks who). */
export async function grantViewer(tx: Tx, principal: Principal, groupId: string, userId: string) {
  assertAllowed(principal, "client_group.manage", groupRecord(principal, groupId));
  try {
    await tx.insert(clientGroupViewers).values({ groupId, userId });
  } catch (err) {
    if (uniqueViolation(err)) return { ok: true };
    throw err;
  }
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "client_group.grant_viewer",
    resourceType: "client_group",
    resourceId: groupId,
    outcome: "allow",
    meta: { userId },
  });
  return { ok: true };
}

export async function revokeViewer(tx: Tx, principal: Principal, groupId: string, userId: string) {
  assertAllowed(principal, "client_group.manage", groupRecord(principal, groupId));
  const gone = await tx
    .delete(clientGroupViewers)
    .where(and(eq(clientGroupViewers.groupId, groupId), eq(clientGroupViewers.userId, userId)))
    .returning({ userId: clientGroupViewers.userId });
  if (!gone.length) throw new NotFoundError("viewer");
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "client_group.revoke_viewer",
    resourceType: "client_group",
    resourceId: groupId,
    outcome: "allow",
    meta: { userId },
  });
  return { ok: true };
}

/** The groups a client person was granted, by name. Empty for everyone else. */
export async function myGroups(tx: Tx, principal: Principal) {
  if (principal.orgKind !== "client" || !authorize(principal, "client_group.view", groupRecord(principal)).allowed) return [];
  const { rows } = await tx.execute<{ id: string; name_ar: string; name_en: string | null }>(sql`select * from app_my_client_groups()`);
  return rows.map((r) => ({ id: r.id, nameAr: r.name_ar, nameEn: r.name_en }));
}

type RollupRow = Row & { client_org_id: string; client_name: string; client_name_ar: string | null; unit_name_ar: string | null; unit_name_en: string | null };

/**
 * The group's roll-up for a granted person of the holding: pooled counts with
 * a row per member company, worked out by app_client_group_rollup() from
 * work the firm and each company both see. Counts only: no record, title or
 * person of a linked client reaches the reader.
 */
export async function groupRollup(tx: Tx, principal: Principal, today = firmToday()) {
  const [group] = await myGroups(tx, principal);
  if (!group) throw new NotFoundError("group");
  assertAllowed(principal, "client_group.view", groupRecord(principal, group.id));
  const { rows } = await tx.execute<RollupRow>(sql`select * from app_client_group_rollup(${group.id}::uuid, ${today}::date)`);
  // The function returns counts only; the percentage is worked out here from them.
  const counts = (r: RollupRow) => pool([numbers({ ...r, implemented_pct: null })]);
  const members = [...new Map(rows.map((r) => [r.client_org_id, { id: r.client_org_id, name: r.client_name, nameAr: r.client_name_ar }])).values()];
  const units = rows
    .filter((r) => r.department_id)
    .map((r) => ({ id: r.department_id as string, orgId: r.client_org_id, nameAr: r.unit_name_ar ?? "", nameEn: r.unit_name_en, numbers: counts(r) }));
  // Each client's own row is its work outside its companies; its total adds them back.
  const totals = new Map(
    members.map((m) => {
      const own = rows.filter((r) => r.client_org_id === m.id && !r.department_id).map(counts);
      return [m.id, pool([...own, ...units.filter((u) => u.orgId === m.id).map((u) => u.numbers)])];
    }),
  );
  const { total, companies } = groupCompanies(members, totals, units);
  return { group, today, total, companies };
}
