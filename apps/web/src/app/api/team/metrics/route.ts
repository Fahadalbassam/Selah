import { route } from "@/server/http";
import { firmToday } from "@/lib/dates";
import { teamMetrics } from "@/services/follow-through";

// Team totals cover the last 90 days.
export const GET = route({}, ({ tx, principal }) => {
  const since = new Date(`${firmToday()}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 90);
  return teamMetrics(tx, principal, since.toISOString().slice(0, 10));
});
