import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth/auth";
import { mustSetUpTwoFactor, type Principal } from "@/authz";
import { asAnonymous, asUser, type Tx } from "@/db/client";
import { env } from "@/env";
import { loadPrincipal } from "@/services/principal";
import { NotFoundError } from "./errors";

// The page-side twin of route(): server components load data only through
// this, so every page read runs as the signed-in user under RLS and through
// the services' authorize() checks.

const session = cache(async () => auth().api.getSession({ headers: await headers() }));

/**
 * Redirects to sign-in when there is no session or no active membership, and
 * to /security while someone who must use two-factor sign-in has not set it
 * up (only that page passes `allowTwoFactorSetup`).
 */
export async function withPrincipal<T>(
  fn: (tx: Tx, principal: Principal) => Promise<T>,
  options: { allowTwoFactorSetup?: boolean } = {},
): Promise<T> {
  const s = await session();
  if (!s) redirect("/sign-in");
  try {
    return await asUser(s.user.id, async (tx) => {
      const principal = await loadPrincipal(tx, s.user.id);
      if (!principal) throw new NoAccess();
      if (
        !options.allowTwoFactorSetup &&
        mustSetUpTwoFactor(principal.role, s.user.twoFactorEnabled, env().TWO_FACTOR_REQUIRED === "true")
      ) {
        throw new TwoFactorSetup();
      }
      return fn(tx, principal);
    });
  } catch (err) {
    if (err instanceof NoAccess) redirect("/sign-in?error=no_access");
    if (err instanceof TwoFactorSetup) redirect("/security");
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}

class NoAccess extends Error {}
class TwoFactorSetup extends Error {}

/** The signed-in user's own sign-in settings, for /security. */
export async function currentUser() {
  const s = await session();
  if (!s) redirect("/sign-in");
  return { id: s.user.id, email: s.user.email, name: s.user.name, twoFactorEnabled: Boolean(s.user.twoFactorEnabled) };
}

export async function hasSession(): Promise<boolean> {
  return (await session()) !== null;
}

/** For public pages (the inquiry form): reads run with no user, under RLS. */
export async function withAnonymous<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return asAnonymous(fn);
}
