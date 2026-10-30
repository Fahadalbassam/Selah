import type { Principal } from "@/authz";
import { DUE_SHEETS_SQL, SheetError, fetchSheet, runSheet } from "@/services/indicator-data";
import { loadPrincipal } from "@/services/principal";

// The daily read of connected sheets (indicator data). The schema owner
// lists the sheets due; each is fetched with no database connection held,
// then its figures are saved as the person who connected it, under their
// own row-level security, so a person who lost access brings nothing in.
// A failure is recorded on the connection (three in a row tell its person).
type Tx = Parameters<typeof runSheet>[0];
interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function runIndicatorFeeds(
  owner: Queryable,
  asUser: <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>,
  fetch: (url: string) => Promise<string> = fetchSheet,
): Promise<{ read: number; failed: number; added: number }> {
  const { rows } = await owner.query(DUE_SHEETS_SQL);
  let read = 0;
  let failed = 0;
  let added = 0;
  for (const r of rows as { id: string; org_id: string; run_as: string; url: string }[]) {
    const feed = { id: r.id, orgId: r.org_id, url: r.url };
    let csv: string | null = null;
    let reason = "unreachable";
    try {
      csv = await fetch(r.url);
    } catch (err) {
      reason = err instanceof SheetError ? err.reason : "unreachable";
    }
    try {
      if (csv === null) throw new SheetError(reason as SheetError["reason"]);
      const out = await asUser(r.run_as, async (tx) => {
        const principal = await loadPrincipal(tx, r.run_as);
        if (!principal) throw new SheetError("not_shared");
        return runSheet(tx, principal as Principal, feed, csv!);
      });
      read++;
      added += out.add + out.correct;
    } catch (err) {
      failed++;
      const why = err instanceof SheetError ? err.reason : "refused";
      if (!(err instanceof SheetError)) console.error(`indicator feeds: ${r.id} failed`, err);
      await owner.query(`SELECT app_indicator_feed_result($1::uuid, false, $2, 0)`, [r.id, why]);
    }
  }
  return { read, failed, added };
}

