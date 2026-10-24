// The monthly status pack run (F19). Connects as the schema owner, like the
// metrics snapshot: app_draft_status_packs() is not reachable from the app
// role. Drafts last month's firm-only pack for each active client project
// and tells the client's lead. Safe to run twice in the same month.
interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function runStatusPacks(db: Queryable, today: string): Promise<{ drafted: number }> {
  const { rows } = await db.query(`SELECT app_draft_status_packs($1::date) AS n`, [today]);
  return { drafted: Number(rows[0]!.n) };
}
