// Engagement health (F18): one signal per project from counts the firm
// already keeps. The database holds the same rule (migration oversight:
// app_health_signal()); tests/db/oversight.test.ts proves the two agree.

/** Off track once this share of the open actions is overdue. */
export const HEALTH_OVERDUE_SHARE = 0.25;
/** Off track once an open action is this many days past the date agreed at release. */
export const HEALTH_LATE_DAYS = 60;
/** A review waiting longer than this is a caution. */
export const REVIEW_WAIT_DAYS = 7;

export const HEALTH_SIGNALS = [
  "no_data",
  "on_track",
  "watch",
  "off_track",
] as const;
export type HealthSignal = (typeof HEALTH_SIGNALS)[number];

export interface HealthInput {
  /** Released actions, open or settled. */
  total: number;
  open: number;
  overdue: number;
  /** Open actions more than HEALTH_LATE_DAYS past their original date. */
  lateLong: number;
  /** Blocked, moved twice or more, owner gone, stale, a review waiting too long, or a disputed recommendation. */
  cautions: number;
}

/** The signal for a project. Counts, never a weighted score. */
export function healthSignal(h: HealthInput): HealthSignal {
  if (h.total === 0) return "no_data";
  if (
    h.open > 0 &&
    (h.overdue >= h.open * HEALTH_OVERDUE_SHARE || h.lateLong > 0)
  )
    return "off_track";
  if (h.overdue > 0 || h.cautions > 0) return "watch";
  return "on_track";
}

/** The client's lead hears when no one at the client has acted on an active project for this long. */
export const CLIENT_QUIET_DAYS = 14;
/** Weeks of signal history the oversight page shows. */
export const HEALTH_WEEKS_SHOWN = 8;

/** The Sunday a day's week starts on (the Saudi working week), as YYYY-MM-DD. */
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
