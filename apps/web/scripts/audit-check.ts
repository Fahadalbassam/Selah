// The nightly audit-log job (migration 0023): seal what is left, check the
// whole hash chain, then remove entries past the firm's keep period (never
// younger than 12 months, and never after a failed check). The chain's
// latest seal is printed so the jobs log keeps a copy off the database.
// Exits non-zero when the chain is broken, so the failure is seen.
// Usage: npm run job:audit-check
import { Pool } from "pg";

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is not set");

const pool = new Pool({ connectionString: url, max: 1 });
try {
  await pool.query("SELECT app_seal_audit_log(100000)");
  const { rows } = await pool.query<{ ok: boolean; rows_checked: string; first_bad_seq: string | null; head_seq: string; head_hash: string }>(
    "SELECT ok, rows_checked, first_bad_seq, head_seq, head_hash FROM app_check_audit_chain()",
  );
  const check = rows[0]!;
  console.log(`audit chain: ${check.rows_checked} entries checked, head ${check.head_seq} ${check.head_hash}`);
  if (!check.ok) {
    console.error(`audit chain: BROKEN at entry ${check.first_bad_seq}; nothing pruned`);
    process.exitCode = 2;
  } else {
    const pruned = await pool.query<{ n: number }>("SELECT app_prune_audit_log() AS n");
    if (pruned.rows[0]!.n) console.log(`audit log: ${pruned.rows[0]!.n} entries past the keep period removed`);
  }
} finally {
  await pool.end();
}
