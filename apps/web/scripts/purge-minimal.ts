// Blank the free text of minimal-records clients after handover plus
// firm_settings.minimal_purge_days. Run daily as the schema owner.
// Usage: npm run job:purge-minimal [-- YYYY-MM-DD]
import { Pool } from "pg";
import { firmToday } from "../src/lib/dates";

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is not set");

const today = process.argv[2] ?? firmToday();
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("the date must be YYYY-MM-DD");

const pool = new Pool({ connectionString: url, max: 1 });
const { rows } = await pool.query<{ n: number }>("SELECT app_purge_minimal_records($1::date) AS n", [today]);
await pool.end();
console.log(`minimal-records projects purged for ${today}: ${rows[0]!.n}`);
