// The daily health run (F18). Connects as the schema owner, like the
// reminder job: app_snapshot_health() and app_alert_quiet_clients() are not
// reachable from the app role. Keeps this week's signal for every open
// project, then tells the lead of a client that has gone quiet. Safe to run
// twice for the same day.
interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function runHealth(db: Queryable, today: string): Promise<{ weeks: number; quiet: number }> {
  const weeks = await db.query(`SELECT app_snapshot_health($1::date) AS n`, [today]);
  const quiet = await db.query(`SELECT app_alert_quiet_clients($1::date) AS n`, [today]);
  return { weeks: Number(weeks.rows[0]!.n), quiet: Number(quiet.rows[0]!.n) };
}
