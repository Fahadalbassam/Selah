import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { conflictSearches, user } from "@/db/schema";
import { assertAllowed, type Principal } from "@/authz";
import { audit } from "./audit";

// The conflict search (wave 1, item 8). The database runs it and keeps what
// it found (app_record_conflict_search): clients current, past and pitched,
// other inquiries, and people at clients, by name, mail domain and family
// name. The firm admin only; this module reads the latest and audits runs.

export type ConflictSubject = { inquiryId: string } | { orgId: string };

const resourceOf = (p: Principal) => ({ type: "inquiry" as const, orgId: p.orgId, firmOrgId: p.orgId, projectId: null });

/** Run the search now and keep the result. */
export async function runConflictSearch(tx: Tx, principal: Principal, subject: ConflictSubject) {
  assertAllowed(principal, "inquiry.decide", resourceOf(principal));
  const iid = "inquiryId" in subject ? subject.inquiryId : null;
  const oid = "orgId" in subject ? subject.orgId : null;
  const { rows } = await tx.execute<{ id: string }>(sql`select app_record_conflict_search(${iid}::uuid, ${oid}::uuid) as id`);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "conflict.search",
    resourceType: iid ? "inquiry" : "organization",
    resourceId: (iid ?? oid)!,
    outcome: "allow",
  });
  return { id: rows[0]!.id };
}

/** The last search kept for an inquiry or a client; null when none, or for anyone but the firm admin (RLS). */
export async function latestConflictSearch(tx: Tx, subject: ConflictSubject) {
  const where = "inquiryId" in subject ? eq(conflictSearches.inquiryId, subject.inquiryId) : eq(conflictSearches.orgId, subject.orgId);
  const [row] = await tx
    .select({
      id: conflictSearches.id,
      terms: conflictSearches.terms,
      matches: conflictSearches.matches,
      searchedAt: conflictSearches.searchedAt,
      searchedBy: user.name,
    })
    .from(conflictSearches)
    .leftJoin(user, eq(user.id, conflictSearches.searchedBy))
    .where(where)
    .orderBy(desc(conflictSearches.searchedAt))
    .limit(1);
  return row ?? null;
}

export type ConflictSearch = NonNullable<Awaited<ReturnType<typeof latestConflictSearch>>>;
