// Keep each open project's weekly health signal and alert on quiet clients
// (F18). Run daily as the schema owner. Usage: npm run job:health [-- YYYY-MM-DD]
import { Pool } from "pg";
import { runHealth } from "../src/jobs/health";
import { firmToday } from "../src/lib/dates";

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is not set");

const today = process.argv[2] ?? firmToday();
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("the date must be YYYY-MM-DD");

const pool = new Pool({ connectionString: url, max: 1 });
const out = await runHealth(pool, today);
await pool.end();
console.log(`health for ${today}: ${out.weeks} projects, ${out.quiet} quiet-client alerts`);
