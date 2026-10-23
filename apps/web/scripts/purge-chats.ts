// Archive idle assistant chats and delete those whose time is up
// (baseline: Assistant chats, app_purge_chats). Run daily as the schema owner.
// Usage: npm run job:purge-chats [-- YYYY-MM-DD]
import { Pool } from "pg";
import { firmToday } from "../src/lib/dates";

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is not set");

const today = process.argv[2] ?? firmToday();
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("the date must be YYYY-MM-DD");

const pool = new Pool({ connectionString: url, max: 1 });
const { rows } = await pool.query<{ archived: number; deleted: number }>(
  "SELECT archived, deleted FROM app_purge_chats($1::date)",
  [today],
);
await pool.end();
console.log(`assistant chats for ${today}: ${rows[0]!.archived} archived, ${rows[0]!.deleted} deleted`);
