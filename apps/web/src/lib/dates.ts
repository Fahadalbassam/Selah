/** Today's date (YYYY-MM-DD) where the firm works. Due dates are local dates, not UTC. */
export function firmToday(now = new Date(), timeZone = "Asia/Riyadh"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
