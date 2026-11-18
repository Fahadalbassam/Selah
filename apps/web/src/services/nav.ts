import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientAssignments, inquiries, templateAuthors } from "@/db/schema";
import type { Principal } from "@/authz";
import type { NavFacts } from "@/lib/nav";

/**
 * What decides a consultant's rows "shown only when they apply" (page audit
 * 4.1): Team for one who leads or deputises for a client, Inquiries while one
 * is assigned to them, Assessment templates for a named author. Read as the
 * person, under row-level security; it only chooses rows to draw. The pages
 * themselves keep their own checks, and their addresses still open for
 * whoever may read them. The firm admin gets every row, so nothing is read.
 */
export async function consultantNavFacts(tx: Tx, principal: Principal): Promise<NavFacts> {
  if (principal.orgKind !== "firm" || principal.role !== "consultant") return {};
  const one = sql<number>`1`;
  const leads = await tx
    .select({ one })
    .from(clientAssignments)
    .where(and(eq(clientAssignments.userId, principal.userId), or(eq(clientAssignments.isLead, true), eq(clientAssignments.isDeputy, true))))
    .limit(1);
  const author = await tx
    .select({ one })
    .from(templateAuthors)
    .where(and(eq(templateAuthors.firmOrgId, principal.orgId), eq(templateAuthors.userId, principal.userId)))
    .limit(1);
  // Row-level security already limits a consultant to the inquiries they own; the filter says it plainly.
  const inquiry = await tx.select({ one }).from(inquiries).where(eq(inquiries.ownerUserId, principal.userId)).limit(1);
  return { leadsClient: leads.length > 0, templateAuthor: author.length > 0, inquiryAssigned: inquiry.length > 0 };
}
