import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { consultantProfiles, consultantSectors, consultantServiceAreas, sectors, serviceAreas, user } from "@/db/schema";
import { assertAllowed, type Principal, type Resource } from "@/authz";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";

// What each consultant can lead (drizzle/0019_expertise_rules.sql). The
// admin records services and sectors; a consultant keeps their own
// languages and availability. Used only to suggest a lead for an inquiry.

const profileOf = (principal: Principal, userId: string): Resource => ({
  type: "consultant_profile",
  orgId: principal.orgId,
  firmOrgId: principal.orgId,
  projectId: null,
  // "own" scope: a profile belongs to its consultant.
  createdBy: userId,
});

export async function listProfiles(tx: Tx, principal: Principal) {
  if (principal.orgKind !== "firm") throw new NotFoundError("profiles");
  assertAllowed(principal, "consultant_profile.read", profileOf(principal, principal.userId));
  const profiles = await tx
    .select({
      userId: consultantProfiles.userId,
      name: user.name,
      languages: consultantProfiles.languages,
      acceptingNewClients: consultantProfiles.acceptingNewClients,
    })
    .from(consultantProfiles)
    .innerJoin(user, eq(user.id, consultantProfiles.userId))
    .orderBy(asc(user.name));
  const ids = profiles.map((p) => p.userId);
  const services = ids.length
    ? await tx
        .select({ userId: consultantServiceAreas.userId, code: serviceAreas.code })
        .from(consultantServiceAreas)
        .innerJoin(serviceAreas, eq(serviceAreas.id, consultantServiceAreas.serviceAreaId))
        .where(inArray(consultantServiceAreas.userId, ids))
        .orderBy(asc(serviceAreas.sortOrder))
    : [];
  const sectorRows = ids.length
    ? await tx
        .select({ userId: consultantSectors.userId, code: sectors.code })
        .from(consultantSectors)
        .innerJoin(sectors, eq(sectors.id, consultantSectors.sectorId))
        .where(inArray(consultantSectors.userId, ids))
        .orderBy(asc(sectors.sortOrder))
    : [];
  return profiles.map((p) => ({
    ...p,
    services: services.filter((s) => s.userId === p.userId).map((s) => s.code),
    sectors: sectorRows.filter((s) => s.userId === p.userId).map((s) => s.code),
  }));
}

export interface ProfileInput {
  languages?: ("ar" | "en")[];
  acceptingNewClients?: boolean;
  services?: string[];
  sectors?: string[];
}

async function idsFor(tx: Tx, table: typeof serviceAreas | typeof sectors, codes: string[], field: string) {
  const rows = codes.length
    ? await tx.select({ id: table.id, code: table.code }).from(table).where(inArray(table.code, codes))
    : [];
  if (rows.length !== new Set(codes).size) throw new BadRequestError(`unknown ${field}`);
  return rows.map((r) => r.id);
}

/** The admin sets any consultant's profile; a consultant only their languages and availability. */
export async function putProfile(tx: Tx, principal: Principal, userId: string, input: ProfileInput) {
  if (principal.orgKind !== "firm") throw new NotFoundError("profile");
  const resource = profileOf(principal, userId);
  const expertise = input.services !== undefined || input.sectors !== undefined;
  const [existing] = await tx
    .select({ userId: consultantProfiles.userId })
    .from(consultantProfiles)
    .where(eq(consultantProfiles.userId, userId));
  if (expertise || !existing) {
    assertAllowed(principal, "consultant_profile.manage", resource);
  } else if (principal.role !== "firm_admin") {
    assertAllowed(principal, "consultant_profile.update_own", resource);
  }
  if (existing) {
    if (input.languages !== undefined || input.acceptingNewClients !== undefined) {
      await tx
        .update(consultantProfiles)
        .set({ languages: input.languages, acceptingNewClients: input.acceptingNewClients })
        .where(eq(consultantProfiles.userId, userId));
    }
  } else {
    await tx.insert(consultantProfiles).values({
      userId,
      firmOrgId: principal.orgId,
      languages: input.languages,
      acceptingNewClients: input.acceptingNewClients,
    });
  }
  if (input.services !== undefined) {
    const ids = await idsFor(tx, serviceAreas, input.services, "service");
    await tx.delete(consultantServiceAreas).where(eq(consultantServiceAreas.userId, userId));
    if (ids.length) await tx.insert(consultantServiceAreas).values(ids.map((serviceAreaId) => ({ userId, serviceAreaId })));
  }
  if (input.sectors !== undefined) {
    const ids = await idsFor(tx, sectors, input.sectors, "sector");
    await tx.delete(consultantSectors).where(eq(consultantSectors.userId, userId));
    if (ids.length) await tx.insert(consultantSectors).values(ids.map((sectorId) => ({ userId, sectorId })));
  }
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "consultant_profile.update",
    resourceType: "user",
    resourceId: userId,
    outcome: "allow",
  });
  return { ok: true };
}
