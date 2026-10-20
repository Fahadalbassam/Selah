import "server-only";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { engagementMembers, orgMemberships, organizations } from "@/db/schema";
import type { Principal } from "@/authz";

/**
 * Build the Principal for a signed-in user from the database. Runs inside the
 * user's RLS transaction. Returns null when the user has no active membership
 * in an active organization, which denies everything.
 */
export async function loadPrincipal(tx: Tx, userId: string): Promise<Principal | null> {
  const [membership] = await tx
    .select({ orgId: orgMemberships.orgId, role: orgMemberships.role, orgKind: organizations.kind })
    .from(orgMemberships)
    .innerJoin(organizations, eq(organizations.id, orgMemberships.orgId))
    .where(and(eq(orgMemberships.userId, userId), eq(orgMemberships.active, true), eq(organizations.status, "active")))
    .limit(1);
  if (!membership) return null;

  const rows = await tx
    .select({ engagementId: engagementMembers.engagementId })
    .from(engagementMembers)
    .where(eq(engagementMembers.userId, userId));

  return {
    userId,
    orgId: membership.orgId,
    orgKind: membership.orgKind,
    role: membership.role,
    engagementIds: new Set(rows.map((r) => r.engagementId)),
  };
}
