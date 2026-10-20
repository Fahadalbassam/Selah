import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth/auth";
import type { Principal } from "@/authz";
import { asUser, type Tx } from "@/db/client";
import { loadPrincipal } from "@/services/principal";
import { NotFoundError } from "./errors";

// The page-side twin of route(): server components load data only through
// this, so every page read runs as the signed-in user under RLS and through
// the services' authorize() checks.

const session = cache(async () => auth().api.getSession({ headers: await headers() }));

/** Redirects to sign-in when there is no session or no active membership. */
export async function withPrincipal<T>(fn: (tx: Tx, principal: Principal) => Promise<T>): Promise<T> {
  const s = await session();
  if (!s) redirect("/sign-in");
  try {
    return await asUser(s.user.id, async (tx) => {
      const principal = await loadPrincipal(tx, s.user.id);
      if (!principal) throw new NoAccess();
      return fn(tx, principal);
    });
  } catch (err) {
    if (err instanceof NoAccess) redirect("/sign-in?error=no_access");
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}

class NoAccess extends Error {}

export async function hasSession(): Promise<boolean> {
  return (await session()) !== null;
}
