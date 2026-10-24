import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientDeletions, clientOffboardings, legalHolds, organizations, projects, user } from "@/db/schema";
import { assertAllowed, authorize, type Principal } from "@/authz";
import { NotFoundError } from "@/server/errors";
import { audit } from "./audit";

// A client leaving (full picture item 27, journey J14.1-J14.5). The database
// holds every rule (baseline: Offboarding, 0023): archiving only once every
// project is closed, read-only access in the grace period, the retention
// date, legal holds and the purge. These calls check the same permissions
// first, so the screen only offers what the database will take, and they
// write the audit trail.

const resourceOf = (p: Principal, orgId: string) => ({
  type: "organization" as const,
  orgId,
  firmOrgId: p.orgKind === "firm" ? p.orgId : undefined,
  projectId: null,
});

async function logged(tx: Tx, principal: Principal, action: string, orgId: string, meta?: Record<string, string | number>) {
  await audit(tx, { actorId: principal.userId, orgId: principal.orgId, action, resourceType: "organization", resourceId: orgId, outcome: "allow", meta });
}

/** Where a client stands in leaving, as the firm sees it from the client's page. */
export async function getOffboarding(tx: Tx, principal: Principal, orgId: string) {
  const resource = resourceOf(principal, orgId);
  assertAllowed(principal, "organization.read", resource);
  if (principal.orgKind !== "firm") throw new NotFoundError("client");
  const [org] = await tx
    .select({ status: organizations.status })
    .from(organizations)
    .where(and(eq(organizations.id, orgId), eq(organizations.kind, "client")))
    .limit(1);
  if (!org) throw new NotFoundError("client");
  const admin = authorize(principal, "organization.archive", resource).allowed;

  const rounds = await tx
    .select({
      id: clientOffboardings.id,
      archivedAt: clientOffboardings.archivedAt,
      archivedBy: clientOffboardings.archivedBy,
      graceUntil: clientOffboardings.graceUntil,
      retainUntil: clientOffboardings.retainUntil,
      note: clientOffboardings.note,
      draftsDeleted: clientOffboardings.draftsDeleted,
      restoredAt: clientOffboardings.restoredAt,
      restoredBy: clientOffboardings.restoredBy,
      restoreReason: clientOffboardings.restoreReason,
    })
    .from(clientOffboardings)
    .where(eq(clientOffboardings.orgId, orgId))
    .orderBy(desc(clientOffboardings.archivedAt));
  const holds = admin
    ? await tx
        .select({
          id: legalHolds.id,
          reason: legalHolds.reason,
          placedAt: legalHolds.placedAt,
          placedBy: legalHolds.placedBy,
          releasedAt: legalHolds.releasedAt,
          releasedBy: legalHolds.releasedBy,
          releaseReason: legalHolds.releaseReason,
        })
        .from(legalHolds)
        .where(eq(legalHolds.orgId, orgId))
        .orderBy(desc(legalHolds.placedAt))
    : [];

  const names = new Map<string, string>();
  const ids = [
    ...new Set(
      [...rounds.flatMap((r) => [r.archivedBy, r.restoredBy]), ...holds.flatMap((h) => [h.placedBy, h.releasedBy])].filter((x): x is string => !!x),
    ),
  ];
  if (ids.length) for (const u of await tx.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids))) names.set(u.id, u.name);
  const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);

  const archived = org.status === "archived";
  const current = archived ? (rounds.find((r) => !r.restoredAt) ?? null) : null;

  // Before archiving: what is still open, and the drafts that would be deleted.
  const blockers =
    admin && !archived
      ? (await tx.execute<{ project_id: string; title: string; state: string }>(sql`select * from app_archive_blockers(${orgId})`)).rows.map((r) => ({
          projectId: r.project_id,
          title: r.title,
          state: r.state,
        }))
      : [];
  const drafts =
    admin && !archived
      ? await tx
          .select({ id: projects.id, title: projects.title })
          .from(projects)
          .where(and(eq(projects.orgId, orgId), sql`${projects.state}::text = 'draft'`))
          .orderBy(asc(projects.title))
      : [];
  const signed =
    archived ||
    (
      await tx.execute<{ ok: boolean }>(
        sql`select exists (select 1 from engagements g where g.client_org_id = ${orgId})
              or exists (select 1 from projects p where p.org_id = ${orgId} and p.state::text <> 'draft') as ok`,
      )
    ).rows[0]?.ok === true;

  return {
    archived,
    signed,
    current: current
      ? {
          archivedAt: current.archivedAt,
          archivedBy: name(current.archivedBy),
          graceUntil: current.graceUntil,
          inGrace: current.graceUntil > new Date(),
          retainUntil: current.retainUntil,
          note: current.note,
          draftsDeleted: current.draftsDeleted,
        }
      : null,
    history: rounds
      .filter((r) => r.restoredAt)
      .map((r) => ({
        id: r.id,
        archivedAt: r.archivedAt,
        archivedBy: name(r.archivedBy),
        restoredAt: r.restoredAt!,
        restoredBy: name(r.restoredBy),
        restoreReason: r.restoreReason,
      })),
    holds: holds.map((h) => ({ ...h, placedBy: name(h.placedBy), releasedBy: name(h.releasedBy) })),
    blockers,
    drafts,
    can: {
      archive: admin && !archived && signed && blockers.length === 0,
      restore: admin && archived,
      hold: authorize(principal, "organization.hold", resource).allowed,
    },
  };
}

export type OffboardingView = Awaited<ReturnType<typeof getOffboarding>>;

export async function archiveClient(tx: Tx, principal: Principal, orgId: string, input: { graceDays: number; note?: string | null }) {
  assertAllowed(principal, "organization.archive", resourceOf(principal, orgId));
  await tx.execute(sql`select app_archive_client(${orgId}, ${input.graceDays}, ${input.note ?? null})`);
  await logged(tx, principal, "client.archive", orgId, { graceDays: input.graceDays });
  return getOffboarding(tx, principal, orgId);
}

export async function restoreClient(tx: Tx, principal: Principal, orgId: string, input: { reason: string }) {
  assertAllowed(principal, "organization.archive", resourceOf(principal, orgId));
  await tx.execute(sql`select app_restore_client(${orgId}, ${input.reason})`);
  await logged(tx, principal, "client.restore", orgId, { reason: input.reason.slice(0, 200) });
  return getOffboarding(tx, principal, orgId);
}

export async function placeLegalHold(tx: Tx, principal: Principal, orgId: string, input: { reason: string }) {
  assertAllowed(principal, "organization.hold", resourceOf(principal, orgId));
  await tx.execute(sql`select app_place_legal_hold(${orgId}, ${input.reason})`);
  await logged(tx, principal, "client.hold_place", orgId, { reason: input.reason.slice(0, 200) });
  return getOffboarding(tx, principal, orgId);
}

export async function releaseLegalHold(tx: Tx, principal: Principal, orgId: string, holdId: string, input: { reason: string }) {
  assertAllowed(principal, "organization.hold", resourceOf(principal, orgId));
  const [hold] = await tx.select({ orgId: legalHolds.orgId }).from(legalHolds).where(eq(legalHolds.id, holdId)).limit(1);
  if (!hold || hold.orgId !== orgId) throw new NotFoundError("hold");
  await tx.execute(sql`select app_release_legal_hold(${holdId}, ${input.reason})`);
  await logged(tx, principal, "client.hold_release", orgId, { reason: input.reason.slice(0, 200) });
  return getOffboarding(tx, principal, orgId);
}

/** For the people of an archived client: when it was archived and until when they can read. */
export async function myOffboarding(tx: Tx, principal: Principal) {
  if (!principal.readOnly) return null;
  const [row] = await tx
    .select({ archivedAt: clientOffboardings.archivedAt, graceUntil: clientOffboardings.graceUntil })
    .from(clientOffboardings)
    .where(and(eq(clientOffboardings.orgId, principal.orgId), sql`${clientOffboardings.restoredAt} IS NULL`))
    .limit(1);
  return row ?? null;
}

/** Clients whose records were deleted after their retention period (firm admin). */
export async function listDeletions(tx: Tx, principal: Principal) {
  if (principal.orgKind !== "firm" || principal.role !== "firm_admin") return [];
  return tx.select().from(clientDeletions).orderBy(desc(clientDeletions.deletedAt));
}
