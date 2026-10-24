import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { assertAllowed, type Principal } from "@/authz";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";

// Prospects and pitches (journey gaps N4, N7). A pitch is a client the firm
// approached and has not signed: firm-only, no accounts, and hidden from
// consultants who are not on it. The database holds the rules (baseline:
// Prospects, 0009); these calls give clear errors and the audit trail.

/** Why a client cannot be deleted, as the database sees it; null when it can. */
export type DiscardBlock = "signed" | "accounts" | "inquiry" | "not_lead" | "not_admin" | "files" | "hidden";

/** Start a pitch: the prospect and its first draft project. The consultant who starts it leads it. */
export async function startPitch(tx: Tx, principal: Principal, input: { name: string; nameAr?: string | null; projectTitle: string }) {
  assertAllowed(principal, "organization.pitch", { type: "organization", orgId: principal.orgId, firmOrgId: principal.orgId, projectId: null });
  const { rows } = await tx.execute<{ org_id: string; project_id: string }>(
    sql`select * from app_start_pitch(${input.name}, ${input.nameAr ?? null}, ${input.projectTitle})`,
  );
  const row = rows[0]!;
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "client.pitch",
    resourceType: "organization",
    resourceId: row.org_id,
    outcome: "allow",
    meta: { projectId: row.project_id },
  });
  return { id: row.org_id, projectId: row.project_id };
}

/** Whether this user may delete the client now, and if not, why. */
export async function discardBlock(tx: Tx, clientOrgId: string): Promise<DiscardBlock | null> {
  const { rows } = await tx.execute<{ why: DiscardBlock | null }>(sql`select app_discard_check(${clientOrgId}) as why`);
  if (!rows.length) throw new NotFoundError("client");
  return rows[0]!.why;
}

/**
 * Delete a client that never signed: a lost pitch with everything in it, or
 * a client added by mistake. Its files leave the bucket on the next jobs run.
 */
export async function discardClient(tx: Tx, principal: Principal, clientOrgId: string) {
  if (principal.orgKind !== "firm") throw new NotFoundError("client");
  const why = await discardBlock(tx, clientOrgId);
  if (why === "hidden") throw new NotFoundError("client");
  if (why) throw new BadRequestError(`this client cannot be deleted: ${why}`);
  await tx.execute(sql`select app_discard_client(${clientOrgId})`);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "client.delete",
    resourceType: "organization",
    resourceId: clientOrgId,
    outcome: "allow",
  });
  return { ok: true };
}
