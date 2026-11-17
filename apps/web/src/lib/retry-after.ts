// How long a "too many tries" answer says to wait. Both sign-in limits send
// the seconds left in an X-Retry-After header on their 429: the per-account
// cap (src/auth/auth.ts: 10 tries per 15 minutes, so up to 15 minutes) and
// Better Auth's per-address limit (60-second windows, so at most a minute).

/** Whole minutes to wait, rounded up and never less than one; null when the server gave no usable time. */
export function waitMinutes(retryAfter: string | null | undefined): number | null {
  if (retryAfter === null || retryAfter === undefined || retryAfter.trim() === "") return null;
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.max(1, Math.ceil(seconds / 60));
}

/**
 * For one authClient call: pass `options` as its second argument, then read
 * `minutes()` when the call came back with status 429.
 */
export function retryAfterProbe() {
  let minutes: number | null = null;
  return {
    options: {
      onError(context: { response: Response }) {
        if (context.response.status === 429) minutes = waitMinutes(context.response.headers.get("X-Retry-After"));
      },
    },
    minutes: () => minutes,
  };
}
