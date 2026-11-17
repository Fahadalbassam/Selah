import "server-only";
import { auth } from "@/auth/auth";

/** The shape of the token in /reset-password/<token> (the same one app_queue_password_reset accepts). */
export const isPasswordResetToken = (token: string) => /^[A-Za-z0-9_-]{16,128}$/.test(token);

/**
 * Whether a password-reset link can still be used, for the page the mail
 * opens: a dead link says so when the page loads, not after a new password
 * has been typed twice.
 *
 * It is the lookup Better Auth's own reset does (the token's verification
 * row, not yet expired), without the step that uses it up: the row stays, so
 * the link still works afterwards, and no request passes Better Auth's
 * router, so nothing counts toward a rate limit. One answer for a link that
 * is malformed, unknown, expired or already used; it never says whose it is.
 */
export async function passwordResetIsOpen(token: string): Promise<boolean> {
  if (!isPasswordResetToken(token)) return false;
  const ctx = await auth().$context;
  const verification = await ctx.internalAdapter.findVerificationValue(`reset-password:${token}`);
  return !!verification && verification.expiresAt > new Date();
}
