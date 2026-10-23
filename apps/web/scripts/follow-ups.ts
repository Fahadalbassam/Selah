// Send today's reminders and escalations. Run daily as the schema owner.
// Usage: npm run job:follow-ups [-- YYYY-MM-DD]
import { Pool } from "pg";
import { runFollowUps } from "../src/jobs/follow-ups";
import { firmToday } from "../src/lib/dates";

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is not set");

// Due dates are the firm's local dates (Asia/Riyadh), not UTC.
const today = process.argv[2] ?? firmToday();
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("the date must be YYYY-MM-DD");

const pool = new Pool({ connectionString: url, max: 1 });
const { sent, mailed } = await runFollowUps(pool, today);
await pool.end();
console.log(`follow-ups for ${today}: ${sent} notifications, ${mailed} summary mails`);
