import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { departmentMembers, departments, organizations, projects, user } from "@/db/schema";
import { assertAllowed, OPEN_STATUSES, type Principal } from "@/authz";
import { firmToday } from "@/lib/dates";
import { NotFoundError } from "@/server/errors";
import { isOverdue, listActions } from "./queries";

// A client's progress across its projects (F30): pooled counts with the
// breakdown per project and per department beside the total. Postgres does
// the pooling (app_client_progress) under the reader's row-level security, so
// each reader's numbers hold only the work they could open.

export interface ClientNumbers {
  total: number;
  verified: number;
  partially: number;
  riskAccepted: number;
  notApplicable: number;
  superseded: number;
  open: number;
  overdue: number;
  awaitingReview: number;
  blocked: number;
  /** Null when no released action still applies. */
  implementedPct: number | null;
}

const EMPTY: ClientNumbers = {
  total: 0,
  verified: 0,
  partially: 0,
  riskAccepted: 0,
  notApplicable: 0,
  superseded: 0,
  open: 0,
  overdue: 0,
  awaitingReview: 0,
  blocked: 0,
  implementedPct: null,
};

type Row = Record<string, string | number | null>;

const numbers = (r: Row): ClientNumbers => ({
  total: Number(r.total),
  verified: Number(r.verified),
  partially: Number(r.partially),
  riskAccepted: Number(r.risk_accepted),
  notApplicable: Number(r.not_applicable),
  superseded: Number(r.superseded),
  open: Number(r.open),
  overdue: Number(r.overdue),
  awaitingReview: Number(r.awaiting_review),
  blocked: Number(r.blocked),
  implementedPct: r.implemented_pct === null ? null : Number(r.implemented_pct),
});

/**
 * Read by the client's consultants (as the client page) and by the client's
 * admins and managers; not by action owners, whose view is their own work.
 */
export async function clientOverview(tx: Tx, principal: Principal, clientOrgId: string, today = firmToday()) {
  const [client] = await tx
    .select({
      id: organizations.id,
      name: organizations.name,
      nameAr: organizations.nameAr,
      departmentsEnabled: organizations.departmentsEnabled,
    })
    .from(organizations)
    .where(and(eq(organizations.id, clientOrgId), eq(organizations.kind, "client")))
    .limit(1);
  if (!client) throw new NotFoundError("client");
  assertAllowed(principal, "metrics.read", {
    type: "organization",
    id: clientOrgId,
    orgId: clientOrgId,
    firmOrgId: principal.orgKind === "firm" ? principal.orgId : undefined,
    projectId: null,
  });

  const { rows } = await tx.execute<Row>(sql`select * from app_client_progress(${clientOrgId}::uuid, ${today}::date)`);
  const list = await tx
    .select({ id: projects.id, title: projects.title, sequence: projects.sequence, state: projects.state })
    .from(projects)
    .where(and(eq(projects.orgId, clientOrgId), eq(projects.kind, "client")))
    .orderBy(asc(projects.sequence), asc(projects.createdAt));
  const byProject = new Map(rows.filter((r) => r.scope === "project").map((r) => [r.project_id as string, numbers(r)]));
  const total = rows.find((r) => r.scope === "client");

  // Departments only while the client uses them and some work is filed under one.
  const deptRows = rows.filter((r) => r.scope === "department");
  const filed = client.departmentsEnabled && deptRows.some((r) => r.department_id !== null);
  const names = filed
    ? await tx
        .select({ id: departments.id, nameAr: departments.nameAr, nameEn: departments.nameEn })
        .from(departments)
        .where(eq(departments.orgId, clientOrgId))
    : [];
  const name = new Map(names.map((d) => [d.id, d]));

  return {
    client: { id: client.id, name: client.name, nameAr: client.nameAr },
    today,
    total: total ? numbers(total) : EMPTY,
    projects: list.map((p) => ({ ...p, numbers: byProject.get(p.id) ?? EMPTY })),
    departments: filed
      ? deptRows
          .map((r) => ({
            id: (r.department_id as string | null) ?? null,
            name: r.department_id ? (name.get(r.department_id as string) ?? null) : null,
            numbers: numbers(r),
          }))
          // Named departments first, the company-wide work last.
          .sort((x, y) => (x.id === null ? 1 : y.id === null ? -1 : 0))
      : [],
  };
}

export type ClientOverview = Awaited<ReturnType<typeof clientOverview>>;

/**
 * One department's page (F31): its numbers across the client's projects, its
 * people, and its open actions. Read by the client's consultants, its admins,
 * and the department's own people; a manager outside it gets nothing.
 */
export async function departmentOverview(tx: Tx, principal: Principal, departmentId: string, today = firmToday()) {
  const [dept] = await tx
    .select({ id: departments.id, orgId: departments.orgId, nameAr: departments.nameAr, nameEn: departments.nameEn, active: departments.active })
    .from(departments)
    .where(eq(departments.id, departmentId))
    .limit(1);
  if (!dept) throw new NotFoundError("department");
  const members = await tx
    .select({ userId: departmentMembers.userId, name: user.name, isHead: departmentMembers.isHead })
    .from(departmentMembers)
    .innerJoin(user, eq(user.id, departmentMembers.userId))
    .where(eq(departmentMembers.departmentId, departmentId))
    .orderBy(asc(user.name));
  if (principal.orgKind === "client" && principal.role !== "client_admin" && !members.some((m) => m.userId === principal.userId)) {
    throw new NotFoundError("department");
  }
  const client = await clientOverview(tx, principal, dept.orgId, today);
  const { rows } = await tx.execute<Row>(sql`select * from app_client_progress(${dept.orgId}::uuid, ${today}::date)`);
  const total = rows.find((r) => r.scope === "department" && r.department_id === departmentId);
  const byProject = new Map(
    rows.filter((r) => r.scope === "project_department" && r.department_id === departmentId).map((r) => [r.project_id as string, numbers(r)]),
  );
  const open = await listActions(tx, principal, { clientOrgId: dept.orgId, departmentId, status: [...OPEN_STATUSES], limit: 100 });
  return {
    department: { id: dept.id, nameAr: dept.nameAr, nameEn: dept.nameEn, active: dept.active },
    client: client.client,
    today,
    total: total ? numbers(total) : EMPTY,
    // Only the projects where the department has work.
    projects: client.projects.filter((p) => byProject.has(p.id)).map((p) => ({ ...p, numbers: byProject.get(p.id)! })),
    departments: [],
    members,
    open: open.map((a) => ({ ...a, overdue: isOverdue(a, today) })),
  };
}

export type DepartmentOverview = Awaited<ReturnType<typeof departmentOverview>>;
