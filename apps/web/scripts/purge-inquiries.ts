// Anonymise closed inquiries past their retention date. Run daily as the schema owner.
// Usage: npm run job:purge-inquiries [-- YYYY-MM-DD]
import { Pool } from "pg";
import { firmToday } from "../src/lib/dates";

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is not set");

const today = process.argv[2] ?? firmToday();
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("the date must be YYYY-MM-DD");

const pool = new Pool({ connectionString: url, max: 1 });
const { rows } = await pool.query<{ n: number }>("SELECT app_purge_inquiries($1::date) AS n", [today]);
await pool.end();
console.log(`inquiries anonymised for ${today}: ${rows[0]!.n}`);
