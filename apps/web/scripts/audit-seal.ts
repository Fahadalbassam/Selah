// Seal new audit-log entries into the hash chain (migration 0023,
// app_seal_audit_log). Run every few minutes as the schema owner.
// Usage: npm run job:audit-seal
import { Pool } from "pg";

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is not set");

const pool = new Pool({ connectionString: url, max: 1 });
let total = 0;
// Batches of 10,000, so a backlog never holds one long transaction.
for (;;) {
  const { rows } = await pool.query<{ n: number }>("SELECT app_seal_audit_log(10000) AS n");
  total += rows[0]!.n;
  if (rows[0]!.n < 10000) break;
}
await pool.end();
if (total) console.log(`audit log: ${total} entries sealed`);
