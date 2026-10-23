import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { auth } from "@/auth/auth";
import { BadRequestError } from "@/server/errors";
import { tokenHash } from "./accounts";

// The public end of accounts: an invited person sets up their account, and
// a new address confirms a change. The token in the link is the only proof,
// and the database checks it (baseline: Accounts).

export async function openInvitation(tx: Tx, token: string) {
  const { rows } = await tx.execute<{ email: string; name: string; role: string; org_name: string; org_name_ar: string | null }>(
    sql`select email, name, role, org_name, org_name_ar from app_open_invitation(${tokenHash(token)})`,
  );
  const inv = rows[0];
  if (!inv) throw new BadRequestError("this invitation is no longer valid");
  return { email: inv.email, name: inv.name, role: inv.role, orgName: inv.org_name, orgNameAr: inv.org_name_ar };
}

/**
 * Create the account with the invited address (marked verified: the link
 * reached it) and join the organisation. If joining fails, the new account
 * is removed again, so a failed attempt leaves nothing behind.
 */
export async function acceptInvitation(tx: Tx, token: string, input: { name: string; password: string }) {
  const inv = await openInvitation(tx, token);
  const ctx = await auth().$context;
  const created = await ctx.internalAdapter.createUser(
    { email: inv.email, name: input.name, emailVerified: true },
    { method: "invitation" },
  );
  try {
    await ctx.internalAdapter.linkAccount({
      userId: created.id,
      providerId: "credential",
      accountId: created.id,
      password: await ctx.password.hash(input.password),
    });
    await tx.execute(sql`select app_accept_invitation(${tokenHash(token)}, ${created.id})`);
  } catch (err) {
    await ctx.internalAdapter.deleteUser(created.id);
    throw err;
  }
  return { email: inv.email };
}

export async function confirmEmailChange(tx: Tx, token: string) {
  await tx.execute(sql`select app_confirm_email_change(${tokenHash(token)})`);
  return { ok: true };
}
