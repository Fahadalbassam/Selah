/**
 * Sign-in attempts per account, whatever address they come from (ASVS V6.3).
 * Better Auth's own limit is per IP, and the IP comes from X-Forwarded-For,
 * which a client can set itself when no proxy overwrites it; this one can't
 * be dodged by changing headers. The window is fixed (it doesn't restart on
 * each try), so a locked account opens again on time.
 *
 * Kept in memory: Selah runs one web process, and a restart only forgets
 * counts. Two-factor codes are already capped at 5 per sign-in by Better Auth,
 * so this cap on sign-ins also caps code guesses.
 */
export function createAttemptLimiter({ max, windowSeconds }: { max: number; windowSeconds: number }) {
  const windows = new Map<string, { start: number; count: number }>();
  const windowMs = windowSeconds * 1000;

  return {
    /** Counts one try; returns the seconds to wait when over the limit, otherwise null. */
    take(key: string, now = Date.now()): number | null {
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
      }
      const w = windows.get(key);
      if (!w || now - w.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        return null;
      }
      if (w.count >= max) return Math.ceil((w.start + windowMs - now) / 1000);
      w.count += 1;
      return null;
    },
  };
}

export function accountKey(email: unknown): string | null {
  return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
}
