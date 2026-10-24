import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientAssignments, departmentMembers, orgMemberships, organizations, projectMembers } from "@/db/schema";
import type { Principal } from "@/authz";

/**
 * Build the Principal for a signed-in user from the database. Runs inside the
 * user's RLS transaction. Returns null when the user has no active membership
 * in an active organization (or an archived client still in its grace period,
 * read-only), which denies everything.
 */
export async function loadPrincipal(tx: Tx, userId: string): Promise<Principal | null> {
  const [membership] = await tx
    .select({ orgId: orgMemberships.orgId, role: orgMemberships.role, orgKind: organizations.kind, status: organizations.status })
    .from(orgMemberships)
    .innerJoin(organizations, eq(organizations.id, orgMemberships.orgId))
    .where(
      and(
        eq(orgMemberships.userId, userId),
        eq(orgMemberships.active, true),
        sql`(${organizations.status} = 'active' OR app_in_grace(${organizations.id}))`,
      ),
    )
    .limit(1);
  if (!membership) return null;

  const rows = await tx
    .select({ projectId: projectMembers.projectId, isLead: projectMembers.isLead, observer: projectMembers.observer })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));

  const assignments =
    membership.role === "consultant"
      ? await tx
          .select({ clientOrgId: clientAssignments.clientOrgId, isLead: clientAssignments.isLead, isDeputy: clientAssignments.isDeputy })
          .from(clientAssignments)
          .where(eq(clientAssignments.userId, userId))
      : [];

  // A client user's team: the departments they belong to.
  const departments =
    membership.orgKind === "client"
      ? await tx.select({ id: departmentMembers.departmentId }).from(departmentMembers).where(eq(departmentMembers.userId, userId))
      : [];

  return {
    userId,
    orgId: membership.orgId,
    orgKind: membership.orgKind,
    role: membership.role,
    projectIds: new Set(rows.map((r) => r.projectId)),
    assignedClientIds: new Set(assignments.map((a) => a.clientOrgId)),
    // The deputy (F18) can do what the lead can, as app_is_client_lead() says.
    leadClientIds: new Set(assignments.filter((a) => a.isLead || a.isDeputy).map((a) => a.clientOrgId)),
    leadProjectIds: new Set(rows.filter((r) => r.isLead).map((r) => r.projectId)),
    observedProjectIds: new Set(rows.filter((r) => r.observer).map((r) => r.projectId)),
    departmentIds: new Set(departments.map((d) => d.id)),
    readOnly: membership.status === "archived",
    clientAssistant: membership.orgKind === "client" ? await clientAssistantOn(tx) : false,
  };
}

/** Whether the client assistant is on for the signed-in client person (the database decides: app_client_ai_on). */
async function clientAssistantOn(tx: Tx): Promise<boolean> {
  const { rows } = await tx.execute<{ on: boolean }>(sql`select app_client_ai_on() as on`);
  return rows[0]?.on === true;
}
