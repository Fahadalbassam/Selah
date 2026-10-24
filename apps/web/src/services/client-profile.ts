import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientProfiles, organizations, sectors } from "@/db/schema";
import { assertAllowed, ForbiddenError, type Principal } from "@/authz";
import type { ClientProfileInput } from "@/lib/client-profile";
import { ConflictError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";

// A client's legal profile (wave 1, item 7): legal names, unified number,
// activity, Monsha'at bands, region, regulators, listing and fiscal year.
// The database decides who edits it (app_can_edit_client_profile) and keeps
// it consistent with the client record (check_client_profile); these calls
// give clear errors and the audit trail.

const resourceOf = (p: Principal, orgId: string) => ({
  type: "organization" as const,
  orgId,
  firmOrgId: p.orgKind === "firm" ? p.orgId : undefined,
  projectId: null,
});

async function canEdit(tx: Tx, orgId: string): Promise<boolean> {
  const { rows } = await tx.execute<{ ok: boolean }>(sql`select app_can_edit_client_profile(${orgId}) as ok`);
  return rows[0]?.ok === true;
}

/** The profile as this user may see it, with what they may change. */
export async function getClientProfile(tx: Tx, principal: Principal, orgId: string) {
  assertAllowed(principal, "organization.read", resourceOf(principal, orgId));
  const [org] = await tx
    .select({ legalForm: organizations.legalForm, minimalRecords: organizations.minimalRecords })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) throw new NotFoundError("client");
  const [profile] = await tx.select().from(clientProfiles).where(eq(clientProfiles.orgId, orgId)).limit(1);
  const edit = await canEdit(tx, orgId);
  const [sector] = profile?.sectorCode
    ? await tx.select({ nameAr: sectors.nameAr, nameEn: sectors.nameEn }).from(sectors).where(eq(sectors.code, profile.sectorCode)).limit(1)
    : [];
  return {
    profile: profile ?? null,
    sector: sector ?? null,
    legalForm: org.legalForm,
    minimalRecords: org.minimalRecords,
    sectors: edit
      ? await tx
          .select({ code: sectors.code, nameAr: sectors.nameAr, nameEn: sectors.nameEn })
          .from(sectors)
          .where(eq(sectors.active, true))
          .orderBy(asc(sectors.sortOrder))
      : [],
    can: { edit, legalForm: edit && principal.role === "firm_admin" },
  };
}

function uniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "cause" in err && (err.cause as { code?: string })?.code === "23505";
}

/** Record or correct the profile. The firm admin may change the legal form with it. */
export async function setClientProfile(tx: Tx, principal: Principal, orgId: string, input: ClientProfileInput) {
  const resource = resourceOf(principal, orgId);
  if (!(await canEdit(tx, orgId))) throw new ForbiddenError("client_profile.write", resource, "not allowed");
  const { legalForm, ...fields } = input;
  if (legalForm !== undefined) assertAllowed(principal, "organization.engagement", resource);
  const values = { ...fields, updatedBy: principal.userId };
  const setForm = async () => {
    if (legalForm === undefined) return;
    await tx.update(organizations).set({ legalForm }).where(eq(organizations.id, orgId));
  };
  // The listing and the legal form are checked against each other, so the
  // one that makes room goes first.
  if (fields.listedMarket) await setForm();
  try {
    await tx.insert(clientProfiles).values({ orgId, ...values }).onConflictDoUpdate({ target: clientProfiles.orgId, set: values });
  } catch (err) {
    if (uniqueViolation(err)) throw new ConflictError("another client already has this unified number");
    throw err;
  }
  if (!fields.listedMarket) await setForm();
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "organization.legal_profile",
    resourceType: "organization",
    resourceId: orgId,
    outcome: "allow",
    meta: legalForm === undefined ? {} : { legalForm },
  });
  return { ok: true };
}
