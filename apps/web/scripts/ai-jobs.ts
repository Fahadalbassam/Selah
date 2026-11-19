// Slow AI calls as jobs (docs/assistant.md, "Slow calls as jobs"): file
// summaries, translations and org chart drafts from pasted text, one at a
// time, each as the person who asked (src/jobs/ai-jobs.ts). Run either once
// (does what waits, then stops) or, as the jobs runner does (scripts/jobs.sh),
// with --watch: it then wakes on every new job (LISTEN ai_jobs) and looks
// every 30 seconds anyway. With --clean it only ends stale jobs (the jobs
// loop's round, so they end even while no runner works).
// Usage: npm run job:ai [-- --watch | --clean]
//
// Only one runner works at a time (a lock held while it runs); a second one
// waits. On start it ends any job left "running" by a runner that stopped.
// Needs DATABASE_OWNER_URL, DATABASE_APP_URL, AI_SERVICE_URL and
// AI_SERVICE_TOKEN, and the web app's LLM_PROVIDER and AI_MASKING (the org
// chart draft is for the local model only; names are masked unless the
// service says local).
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import type { Tx } from "../src/db/client";
import * as schema from "../src/db/schema";
import { endJob, endOrphanedAiJobs, runNextAiJob, UnfinishedJob, type AiJobDeps } from "../src/jobs/ai-jobs";
import { draftOrgChart, summarizePages, translateText } from "../src/services/ai-client";
import { maskingOn } from "../src/services/masking";

const need = (k: string) =>
  process.env[k] ??
  (() => {
    throw new Error(`${k} is not set`);
  })();
for (const k of ["AI_SERVICE_URL", "AI_SERVICE_TOKEN"]) need(k);
const ownerUrl = need("DATABASE_OWNER_URL");
const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = drizzle(new Pool({ connectionString: need("DATABASE_APP_URL"), max: 1 }), { schema });

const deps: AiJobDeps = {
  owner,
  asUser: (userId, fn) =>
    app.transaction(async (tx) => {
      await tx.execute(sql`select set_config('selah.user_id', ${userId}, true)`);
      return fn(tx as unknown as Tx);
    }),
  maskingOn: () => maskingOn(),
  model: {
    summarize: (pages, lang, stop) => summarizePages(pages, lang, stop),
    translate: (text, source, target, stop) => translateText(text, source, target, stop),
    draftOrgChart: (text, stop) => draftOrgChart(text, stop),
  },
};

async function drain() {
  for (;;) {
    const done = await runNextAiJob(deps);
    if (!done) return;
    console.log(`ai job ${done.id} (${done.kind}): ${done.status}${done.error ? ` (${done.error})` : ""}`);
  }
}

// The runner's lock, on its own connection for as long as it runs.
const lock = new Client({ connectionString: ownerUrl });
await lock.connect();
const LOCK = "SELECT pg_advisory_lock(hashtext('ai_jobs:runner'))";

if (process.argv.includes("--clean")) {
  // The jobs loop's round (scripts/jobs.sh): end stale jobs and remove old ones, whether or not a runner works.
  const { rows } = await owner.query<{ n: number }>("SELECT app_end_stale_ai_jobs() AS n");
  if (rows[0]?.n) console.log(`ai jobs: ${rows[0].n} stale, ended`);
  await lock.end();
  await owner.end();
  await app.$client.end();
} else if (!process.argv.includes("--watch")) {
  const { rows } = await lock.query<{ ok: boolean }>("SELECT pg_try_advisory_lock(hashtext('ai_jobs:runner')) AS ok");
  if (rows[0]?.ok) {
    const orphans = await endOrphanedAiJobs(owner);
    if (orphans) console.log(`ai jobs: ${orphans} left running by a stopped runner, ended`);
    await drain();
  } else console.log("ai jobs: another runner is working");
  await lock.end();
  await owner.end();
  await app.$client.end();
} else {
  await lock.query(LOCK);
  const orphans = await endOrphanedAiJobs(owner);
  if (orphans) console.log(`ai jobs: ${orphans} left running by a stopped runner, ended`);
  let wake: (() => void) | null = null;
  // A job filed while the runner works is taken before it waits.
  let filed = false;
  lock.on("notification", () => {
    filed = true;
    wake?.();
  });
  await lock.query("LISTEN ai_jobs");
  const stop = async () => {
    await lock.end();
    await owner.end();
    await app.$client.end();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  for (;;) {
    filed = false;
    try {
      await drain();
    } catch (err) {
      console.error("ai jobs:", err instanceof Error ? err.message : err);
      // A job whose ending could not be written: once more, as it ended (a kept answer ends "done"). Then
      // whatever is still "running" is a job this runner could not end (it holds the lock and runs one at
      // a time), so it is ended as stopped rather than holding the line for 15 minutes.
      if (err instanceof UnfinishedJob) await endJob(owner, err.id, err.outcome, 5, 5000).catch(() => undefined);
      await endOrphanedAiJobs(owner).catch(() => undefined);
    }
    if (filed) continue;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 30_000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wake = null;
  }
}
