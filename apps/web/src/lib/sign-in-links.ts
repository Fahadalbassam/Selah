// Sign-in links (wave 2, F14, decision D7): for client managers and action
// owners only, single use, and short-lived. Shared by the auth setup, the
// sign-in form and the page the mail opens.

/** How long a sign-in link works. */
export const SIGN_IN_LINK_MINUTES = 15;

/** Better Auth's token alphabet (letters only, 32 long); anything else is not a link we sent. */
export const isSignInLinkToken = (token: string) => /^[A-Za-z]{32}$/.test(token);

/**
 * Where the button on /sign-in/link/<token> goes: Better Auth's check, which
 * uses the token up, signs the person in and opens the overview, or comes
 * back to the sign-in page with an error.
 */
export function signInLinkVerifyPath(token: string) {
  const q = new URLSearchParams({ token, callbackURL: "/", errorCallbackURL: "/sign-in" });
  return `/api/auth/magic-link/verify?${q}`;
}
