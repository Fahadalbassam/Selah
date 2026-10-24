// Deadline slips and aging (F17). The database holds the same numbers
// (migration action_due_changes: app_extensions_before_lead(),
// app_aging_bucket()); tests/db/slips.test.ts proves the two agree.

/** Extensions any consultant on the project may approve. The next one needs the client's lead consultant or a firm admin. */
export const EXTENSIONS_BEFORE_LEAD = 2;

/** How long an open action has been past its due date, in the buckets audit committees report. */
export const AGING_BUCKETS = [
  { key: "d1_30", from: 1, to: 30 },
  { key: "d31_60", from: 31, to: 60 },
  { key: "d61_90", from: 61, to: 90 },
  { key: "d90_plus", from: 91, to: null },
] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number]["key"];

/** The bucket for a number of days past due, or null when it isn't overdue. */
export function agingBucket(daysOverdue: number): AgingBucket | null {
  if (daysOverdue < 1) return null;
  return AGING_BUCKETS.find((b) => b.to === null || daysOverdue <= b.to)!.key;
}
