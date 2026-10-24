// The closing pulse (F36, migration: Closing pulse). Shared by the screens,
// the service and the tests; the database holds the same numbers
// (app_pulse_days, app_pulse_low), and tests/db/pulse.test.ts proves they agree.

/** The three questions, in the order they are asked. Each is answered 1 (not at all) to 5 (fully). */
export const PULSE_QUESTIONS = ["metAgreement", "responsive", "selfReliant"] as const;
export type PulseQuestion = (typeof PULSE_QUESTIONS)[number];

export const PULSE_SCALE = [1, 2, 3, 4, 5] as const;

/** Days after closing that the pulse takes and changes answers; then it locks. */
export const PULSE_OPEN_DAYS = 30;

/** A score at or below this tells the client's lead. */
export const PULSE_LOW = 2;

export const PULSE_LIMITS = { comment: 2000 } as const;

/** The mean of some scores to one decimal, or null when there are none. */
export function average(scores: number[]): number | null {
  if (!scores.length) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}
