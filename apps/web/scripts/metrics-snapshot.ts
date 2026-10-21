// Copy every active project's implementation metrics. Run monthly (e.g. on
// the last day) as the schema owner. Usage: npm run job:metrics [-- YYYY-MM-DD]
import { Pool } from "pg";
import { snapshotMetrics } from "../src/jobs/metrics";
import { firmToday } from "../src/lib/dates";

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is not set");

const asOf = process.argv[2] ?? firmToday();
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("the date must be YYYY-MM-DD");

const pool = new Pool({ connectionString: url, max: 1 });
const rows = await snapshotMetrics(pool, asOf);
await pool.end();
console.log(`metrics for ${asOf}: ${rows} values`);
