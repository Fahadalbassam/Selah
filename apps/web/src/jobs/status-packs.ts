// The monthly status pack run (F19). Connects as the schema owner, like the
// metrics snapshot: app_draft_status_packs() is not reachable from the app
// role. Drafts last month's firm-only pack for each active client project
// and tells the client's lead. It also reminds the admins of clients whose
// business indicators have no value for the period just ended (KPI layer B),
// and judges each indicator's period that has just ended: one whose latest
// value moved away tells the client's lead, deputy and admins (decision 4b,
// app_judge_kpi_periods). Safe to run twice in the same month.
interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function runStatusPacks(
  db: Queryable,
  today: string,
): Promise<{ drafted: number; indicatorReminders: number; indicatorsMovedAway: number }> {
  const { rows } = await db.query(`SELECT app_draft_status_packs($1::date) AS n`, [today]);
  const reminded = await db.query(`SELECT app_remind_kpis($1::date) AS n`, [today]);
  const judged = await db.query(`SELECT app_judge_kpi_periods($1::date) AS n`, [today]);
  return { drafted: Number(rows[0]!.n), indicatorReminders: Number(reminded.rows[0]!.n), indicatorsMovedAway: Number(judged.rows[0]!.n) };
}
