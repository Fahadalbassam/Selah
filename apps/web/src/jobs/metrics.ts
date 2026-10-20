// The monthly metrics snapshot. Connects as the schema owner, like the
// reminder job: app_snapshot_metrics() is not reachable from the app role.
// Safe to run twice for the same day.
interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: { n: number }[] }>;
}

export async function snapshotMetrics(db: Queryable, asOf: string): Promise<number> {
  const { rows } = await db.query(`SELECT app_snapshot_metrics($1::date) AS n`, [asOf]);
  return Number(rows[0]!.n);
}
