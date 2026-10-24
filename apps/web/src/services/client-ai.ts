import "server-only";
import { alias } from "drizzle-orm/pg-core";
import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { aiUsage, clientAiConsents, clientAiSettings, organizations, user } from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Resource } from "@/authz";
import { CLIENT_AI_LIMIT, CLIENT_AI_VERSION, type ClientAiRole } from "@/lib/client-ai";
import { firmToday } from "@/lib/dates";
import type { Locale } from "@/i18n/config";
import { NotFoundError } from "@/server/errors";
import { audit } from "./audit";

// The client assistant (wave 3, F39; migration: the client assistant). The
// database holds every rule: only the firm admin switches it on, only the
// client's admin consents, switching it off ends the consent, and
// app_client_ai_on() decides each request. These calls check the same
// permissions first, so the screens only offer what the database will take.

const clientOrg = (p: Principal, clientOrgId: string): Resource => ({
  type: "organization",
  orgId: clientOrgId,
  firmOrgId: p.orgKind === "firm" ? p.orgId : undefined,
  projectId: null,
});

const ender = alias(user, "ender");

async function settingsOf(tx: Tx, clientOrgId: string) {
  const [s] = await tx
    .select({ enabled: clientAiSettings.enabled, roles: clientAiSettings.roles, dailyLimit: clientAiSettings.dailyLimit, updatedAt: clientAiSettings.updatedAt })
    .from(clientAiSettings)
    .where(eq(clientAiSettings.clientOrgId, clientOrgId));
  return s ?? null;
}

async function consentsOf(tx: Tx, clientOrgId: string) {
  return tx
    .select({
      id: clientAiConsents.id,
      version: clientAiConsents.version,
      givenBy: user.name,
      givenAt: clientAiConsents.givenAt,
      endedBy: ender.name,
      endedAt: clientAiConsents.endedAt,
    })
    .from(clientAiConsents)
    .leftJoin(user, eq(user.id, clientAiConsents.givenBy))
    .leftJoin(ender, eq(ender.id, clientAiConsents.endedBy))
    .where(eq(clientAiConsents.clientOrgId, clientOrgId))
    .orderBy(desc(clientAiConsents.givenAt))
    .limit(10);
}

function state(settings: Awaited<ReturnType<typeof settingsOf>>, consents: Awaited<ReturnType<typeof consentsOf>>) {
  const current = consents.find((c) => !c.endedAt && c.version === CLIENT_AI_VERSION) ?? null;
  return {
    enabled: settings?.enabled ?? false,
    roles: (settings?.roles ?? ["client_manager"]) as ClientAiRole[],
    dailyLimit: settings?.dailyLimit ?? CLIENT_AI_LIMIT.default,
    /** The consent in force, if any. */
    consent: current,
    history: consents,
  };
}

/** The client page's card, for the firm admin (who changes it) and the client's consultants (who read it). */
export async function getClientAi(tx: Tx, principal: Principal, clientOrgId: string) {
  if (principal.orgKind !== "firm") throw new NotFoundError("client");
  const [org] = await tx
    .select({ status: organizations.status, prospect: organizations.prospect, minimal: organizations.minimalRecords, mode: organizations.engagementMode })
    .from(organizations)
    .where(eq(organizations.id, clientOrgId));
  if (!org) throw new NotFoundError("client");
  const view = state(await settingsOf(tx, clientOrgId), await consentsOf(tx, clientOrgId));
  // Consultant-managed and minimal-records clients have no accounts or no AI.
  const eligible = org.status === "active" && !org.prospect && !org.minimal && org.mode !== "consultant_managed";
  return { ...view, eligible, canManage: eligible && authorize(principal, "client_ai.manage", clientOrg(principal, clientOrgId)).allowed };
}

export async function setClientAi(
  tx: Tx,
  principal: Principal,
  clientOrgId: string,
  input: { enabled: boolean; roles: ClientAiRole[]; dailyLimit: number },
) {
  assertAllowed(principal, "client_ai.manage", clientOrg(principal, clientOrgId));
  const roles = sql`ARRAY[${sql.join(input.roles.map((r) => sql`${r}`), sql`, `)}]::role[]`;
  await tx.execute(sql`select app_set_client_ai(${clientOrgId}, ${input.enabled}, ${input.roles.length ? roles : sql`'{}'::role[]`}, ${input.dailyLimit})`);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "client_ai.settings",
    resourceType: "organization",
    resourceId: clientOrgId,
    outcome: "allow",
    meta: { enabled: input.enabled, roles: input.roles.join(","), dailyLimit: input.dailyLimit },
  });
  return getClientAi(tx, principal, clientOrgId);
}

/** What a client person sees: whether it is offered, consented and on for them, and their questions today. */
export async function myClientAi(tx: Tx, principal: Principal) {
  if (principal.orgKind !== "client") return null;
  const view = state(await settingsOf(tx, principal.orgId), await consentsOf(tx, principal.orgId));
  const [used] = await tx.select({ queries: aiUsage.queries }).from(aiUsage).where(sql`${aiUsage.userId} = ${principal.userId} AND ${aiUsage.day} = ${firmToday()}::date`);
  const admin = authorize(principal, "client_ai.consent", clientOrg(principal, principal.orgId)).allowed;
  return {
    offered: view.enabled,
    consent: view.consent ? { givenBy: view.consent.givenBy, givenAt: view.consent.givenAt } : null,
    roles: view.roles,
    dailyLimit: view.dailyLimit,
    usedToday: used?.queries ?? 0,
    on: principal.clientAssistant === true,
    /** The client's admin consents or withdraws. */
    canConsent: admin && view.enabled && !view.consent && !principal.readOnly,
    canWithdraw: admin && view.consent !== null,
    version: CLIENT_AI_VERSION,
  };
}

export async function consentClientAi(tx: Tx, principal: Principal, input: { version: string; locale: Locale }) {
  assertAllowed(principal, "client_ai.consent", clientOrg(principal, principal.orgId));
  await tx.execute(sql`select app_consent_client_ai(${input.version}, ${input.locale})`);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "client_ai.consent",
    resourceType: "organization",
    resourceId: principal.orgId,
    outcome: "allow",
    meta: { version: input.version },
  });
  return { ok: true };
}

export async function withdrawClientAi(tx: Tx, principal: Principal) {
  assertAllowed(principal, "client_ai.consent", clientOrg(principal, principal.orgId));
  await tx.execute(sql`select app_withdraw_client_ai()`);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "client_ai.withdraw",
    resourceType: "organization",
    resourceId: principal.orgId,
    outcome: "allow",
  });
  return { ok: true };
}
