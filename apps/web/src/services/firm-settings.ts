import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { firmSettings, organizations } from "@/db/schema";
import { assertAllowed, type Principal } from "@/authz";
import { RAMADAN_DEFAULTS } from "@/lib/mail-choices";
import { NotFoundError } from "@/server/errors";
import { audit } from "./audit";

// The firm's settings. One row per firm, created on the first save; until
// then the database defaults apply, and they are shown here the same way.

export const FIRM_SETTING_DEFAULTS = {
  intakeEmail: null as string | null,
  suggestionsEnabled: true,
  kpiGraceDays: 10,
  staleDays: 14,
  checkinDays: [30, 60, 90],
  accessReviewDays: 90,
  restrictedMaxAdmins: 2,
  minimalPurgeDays: 90,
  transcriptKeepDays: 30,
  chatArchiveDays: 30,
  chatAfterCloseDays: 90,
  chatIdleDeleteDays: 180,
  // This year's Ramadan, as the admin enters it, and its mail hours (firm time).
  ramadanStarts: null as string | null,
  ramadanEnds: null as string | null,
  ramadanMailFrom: RAMADAN_DEFAULTS.mailFrom as string,
  ramadanMailTo: RAMADAN_DEFAULTS.mailTo as string,
  auditKeepMonths: 12,
  // Client managers and action owners may sign in by a mailed link (F14).
  signInLinksEnabled: true,
};
export type FirmSettings = typeof FIRM_SETTING_DEFAULTS;
export type FirmSettingsPatch = Partial<FirmSettings>;

const resource = (p: Principal) => ({ type: "organization" as const, orgId: p.orgId, firmOrgId: p.orgId, projectId: null });

export async function getFirmSettings(tx: Tx, principal: Principal) {
  assertAllowed(principal, "firm_settings.manage", resource(principal));
  const [org] = await tx
    .select({ id: organizations.id, name: organizations.name, nameAr: organizations.nameAr, kind: organizations.kind })
    .from(organizations)
    .where(eq(organizations.id, principal.orgId));
  if (!org || org.kind !== "firm") throw new NotFoundError("organization");
  const [row] = await tx.select().from(firmSettings).where(eq(firmSettings.orgId, principal.orgId));
  const settings = { ...FIRM_SETTING_DEFAULTS };
  for (const key of Object.keys(settings) as (keyof FirmSettings)[]) {
    if (row) (settings as Record<string, unknown>)[key] = row[key];
  }
  // Postgres gives times with seconds; the form works in HH:MM.
  settings.ramadanMailFrom = settings.ramadanMailFrom.slice(0, 5);
  settings.ramadanMailTo = settings.ramadanMailTo.slice(0, 5);
  return { organization: { id: org.id, name: org.name, nameAr: org.nameAr }, settings, updatedAt: row?.updatedAt ?? null };
}

export async function updateFirmSettings(tx: Tx, principal: Principal, patch: FirmSettingsPatch) {
  assertAllowed(principal, "firm_settings.manage", resource(principal));
  const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as FirmSettingsPatch;
  if (changes.checkinDays) changes.checkinDays = [...new Set(changes.checkinDays)].sort((a, b) => a - b);
  if (changes.intakeEmail !== undefined) changes.intakeEmail = changes.intakeEmail?.trim().toLowerCase() || null;
  const fields = Object.keys(changes);
  if (fields.length) {
    await tx
      .insert(firmSettings)
      .values({ orgId: principal.orgId, ...changes })
      .onConflictDoUpdate({ target: firmSettings.orgId, set: { ...changes, updatedAt: sql`now()` } });
    // Field names only: the values stay in the table.
    await audit(tx, {
      actorId: principal.userId,
      orgId: principal.orgId,
      action: "firm_settings.update",
      resourceType: "organization",
      resourceId: principal.orgId,
      outcome: "allow",
      meta: { fields: fields.join(",") },
    });
  }
  return getFirmSettings(tx, principal);
}
