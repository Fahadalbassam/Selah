import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { Principal } from "@/authz";
import { ACCEPTED_DOCS, LEGAL_VERSIONS, type AcceptedDoc } from "@/lib/legal";
import type { Locale } from "@/i18n/config";
import { BadRequestError } from "@/server/errors";
import { audit } from "./audit";

// The first-sign-in acceptance of the terms, the privacy notice and the AI-use
// notice (R1). The database keeps the record and decides what is current
// (app_consent_pending, app_record_consent); pages and routes ask here and
// send the person to /consent until nothing is pending.

/** The documents the signed-in person still has to accept in their current version. */
export async function pendingConsents(tx: Tx): Promise<AcceptedDoc[]> {
  const { rows } = await tx.execute<{ pending: string | string[] }>(sql`select app_consent_pending()::text[] as pending`);
  const v = rows[0]?.pending ?? [];
  return (Array.isArray(v) ? v : v.replace(/[{}]/g, "").split(",").filter(Boolean)) as AcceptedDoc[];
}

/** Record that the person accepted every document they were shown, in the versions shown. */
export async function acceptConsents(
  tx: Tx,
  principal: Principal,
  accepted: Partial<Record<AcceptedDoc, string>>,
  locale: Locale,
  ip: string | null,
) {
  const pending = await pendingConsents(tx);
  for (const doc of pending) {
    // The page showed a version; if it changed meanwhile, show the new text first.
    if (accepted[doc] !== LEGAL_VERSIONS[doc]) throw new BadRequestError(`accept the current ${doc}`);
  }
  for (const doc of ACCEPTED_DOCS) {
    if (!accepted[doc]) continue;
    await tx.execute(sql`select app_record_consent(${doc}::legal_doc, ${accepted[doc]}, ${locale}, ${ip})`);
  }
  if (pending.length) {
    await audit(tx, {
      actorId: principal.userId,
      orgId: principal.orgId,
      action: "consent.accept",
      resourceType: "user",
      resourceId: principal.userId,
      outcome: "allow",
      ip,
      meta: Object.fromEntries(pending.map((d) => [d, LEGAL_VERSIONS[d]])),
    });
  }
  return { pending: await pendingConsents(tx) };
}

/** The person's own acceptance history, newest first. */
export async function myConsents(tx: Tx, principal: Principal) {
  const { rows } = await tx.execute<{ doc: AcceptedDoc; version: string; accepted_at: string }>(
    sql`select doc::text, version, accepted_at from consent_records where user_id = ${principal.userId} order by accepted_at desc`,
  );
  return rows.map((r) => ({ doc: r.doc, version: r.version, acceptedAt: new Date(r.accepted_at) }));
}

/**
 * Whether the person signed in for the first time within the last `days` days.
 * Their first sign-in is their first acceptance of the documents (everyone
 * passes /consent before anything else). The overview shows its welcome then.
 */
export async function isNewcomer(tx: Tx, principal: Principal, days: number): Promise<boolean> {
  const { rows } = await tx.execute<{ fresh: boolean | null }>(
    sql`select min(accepted_at) > now() - make_interval(days => ${days}) as fresh from consent_records where user_id = ${principal.userId}`,
  );
  return rows[0]?.fresh === true;
}
