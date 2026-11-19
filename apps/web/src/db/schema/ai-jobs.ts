// AI jobs (docs/assistant.md, "Slow calls as jobs"): a file summary, a
// translation or an org chart draft from pasted text, asked for on a page and
// done by the jobs runner (src/jobs/ai-jobs.ts), one at a time, as the person
// who asked. On a processor the local model takes minutes, and a response
// that has not started within 100 seconds fails behind Cloudflare's tunnel,
// so the request answers at once with the job and the page asks after it.
//
// A summary and a translation are kept where they always were
// (document_summaries, content_translations); only an org chart draft, which
// is never stored, waits here in `result` until the person fetches it once
// (then it is cleared), at most an hour. The pasted text waits in `input`
// until the job ends, then is cleared. Each person reads only their own jobs
// (row-level security, migration 0113); rows are removed an hour after they end.
import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./app";
import { user } from "./auth";

export const aiJobs = pgTable(
  "ai_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    // What is asked for, so asking again while it waits gives the same job ("summary:<file>:<lang>").
    key: text("key").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("queued"),
    // A short reason when it did not end "done" (lib/ai-jobs.ts lists them).
    error: text("error"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // The asker's organisation, for the audit log (set by the database).
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Whether names were masked for this job, as the runner decided before its first transaction.
    masked: boolean("masked"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("ai_jobs_queue_idx").on(t.status, t.createdAt),
    uniqueIndex("ai_jobs_once").on(t.createdBy, t.key).where(sql`${t.status} IN ('queued', 'running')`),
    check("ai_jobs_kind", sql`${t.kind} IN ('summary', 'translation', 'org_draft')`),
    check("ai_jobs_status", sql`${t.status} IN ('queued', 'running', 'done', 'failed', 'refused', 'cancelled', 'expired')`),
  ],
);
