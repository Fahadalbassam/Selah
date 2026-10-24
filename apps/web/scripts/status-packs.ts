// Draft last month's status pack on every active client project (F19).
// Run on the 1st of each month as the schema owner.
// Usage: npm run job:status-packs [-- YYYY-MM-DD]
import { Pool } from "pg";
import { runStatusPacks } from "../src/jobs/status-packs";
import { firmToday } from "../src/lib/dates";

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is not set");

const today = process.argv[2] ?? firmToday();
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("the date must be YYYY-MM-DD");

const pool = new Pool({ connectionString: url, max: 1 });
const out = await runStatusPacks(pool, today);
await pool.end();
console.log(`status packs for the month before ${today}: ${out.drafted} drafted`);
