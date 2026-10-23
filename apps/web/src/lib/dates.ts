/** Where the firm works. The database holds the same zone in app_firm_tz() (tests/db/rule-parity.test.ts). */
export const FIRM_TIME_ZONE = "Asia/Riyadh";

/** Today's date (YYYY-MM-DD) where the firm works. Due dates are local dates, not UTC. */
export function firmToday(now = new Date(), timeZone = FIRM_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
