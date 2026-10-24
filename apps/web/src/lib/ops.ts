// Readiness and alerting (R4), the parts with no I/O so they can be tested.

/** One dependency's state. Critical ones make the site "down"; the rest "degraded". */
export type Check = {
  name: string;
  ok: boolean;
  critical: boolean;
  ms?: number;
  error?: string;
};
export type ReadyStatus = "ok" | "degraded" | "down";

export function statusOf(checks: Check[]): ReadyStatus {
  if (checks.some((c) => c.critical && !c.ok)) return "down";
  return checks.some((c) => !c.ok) ? "degraded" : "ok";
}

/** What the alert job remembers between rounds. */
export type AlertState = { failing: string[]; alertedAt: number | null };

/** A failing check is alerted again this often while it stays failing. */
export const REMIND_MS = 6 * 60 * 60_000;

/**
 * Whether to send an alert this round: when something new fails, when
 * everything recovers, and every REMIND_MS while something keeps failing.
 */
export function decideAlert(
  prev: AlertState,
  failing: string[],
  now: number,
): { send: "failing" | "recovered" | null; next: AlertState } {
  const sorted = [...new Set(failing)].sort();
  const isNew = sorted.some((f) => !prev.failing.includes(f));
  if (!sorted.length) {
    return {
      send: prev.failing.length ? "recovered" : null,
      next: {
        failing: [],
        alertedAt: prev.failing.length ? now : prev.alertedAt,
      },
    };
  }
  if (isNew || prev.alertedAt === null || now - prev.alertedAt >= REMIND_MS) {
    return { send: "failing", next: { failing: sorted, alertedAt: now } };
  }
  return { send: null, next: { failing: sorted, alertedAt: prev.alertedAt } };
}

/** The alert text, in Arabic and English (it goes to the firm's administrators). */
export function alertText(
  kind: "failing" | "recovered",
  failing: string[],
  details: Record<string, string>,
  site: string,
) {
  if (kind === "recovered") {
    return {
      subject: `Selah: all checks pass again · صِلَة: عادت جميع الفحوص سليمة`,
      text: `${site}\n\nEverything Selah checks is working again.\nكل ما يفحصه صِلَة يعمل من جديد.\n`,
    };
  }
  const lines = failing
    .map((f) => `- ${f}${details[f] ? `: ${details[f]}` : ""}`)
    .join("\n");
  return {
    subject: `Selah: ${failing.length} check${failing.length === 1 ? "" : "s"} failing · صِلَة: فحوص لا تعمل`,
    text:
      `${site}\n\nThese checks are failing:\nهذه الفحوص لا تعمل:\n\n${lines}\n\n` +
      `See docs/operations.md, "When something goes wrong", and run ops/readiness.sh on the server.\n` +
      `راجع docs/operations.md وشغّل ops/readiness.sh على الخادم.\n`,
  };
}
