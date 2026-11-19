import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import { aiJobs } from "@/db/schema";
import type { AiJob, AiJobError, AiJobKind, AiJobStatus } from "@/lib/ai-jobs";
import { ConflictError, NotFoundError, RateLimitError } from "@/server/errors";
import { ANSWERS_AT_ONCE } from "./assistant-in-flight";
import { audit } from "./audit";
import { fetchOrgDraft, type ImportedRows, type OrgDraftResult } from "./org-chart-import";

// Slow AI calls as jobs (docs/assistant.md, "Slow calls as jobs"). The page
// asks; the route checks everything it can as the person, files a job here
// and answers 202 at once, so no response waits minutes on the local model
// (Cloudflare's tunnel gives up on one that has not started in 100 seconds).
// The jobs runner (src/jobs/ai-jobs.ts) does the jobs one at a time, as the
// person who asked, checking again. The database keeps each person's jobs
// to themselves and limits how many they may have waiting (migration 0113).

type Row = typeof aiJobs.$inferSelect;

/** The refusal when the person has as many jobs as they may (a 409; the page says "busy", not the hourly limit). */
export const BUSY = "you already have requests being worked on";

async function view(tx: Tx, row: Row): Promise<AiJob> {
  // Only "you're next" or not: never how many are ahead (the firm's load is not a client person's business).
  const next =
    row.status === "queued" ? ((await tx.execute<{ next: boolean | null }>(sql`select app_ai_job_next(${row.id}) as next`)).rows[0]?.next ?? null) : null;
  return { id: row.id, kind: row.kind as AiJobKind, status: row.status as AiJobStatus, error: (row.error as AiJobError | null) ?? null, next };
}

/** Jobs gone stale end now, whoever looks (app_end_stale_ai_jobs): a runner that is down holds nobody's places for long. */
async function endStale(tx: Tx) {
  await tx.execute(sql`select app_end_stale_ai_jobs()`);
}

/** The hourly limits the database holds on what is kept (30 summaries, 200 translations a person), asked before the model runs. */
export async function assertHourLeft(tx: Tx, kind: AiJobKind) {
  if (kind === "org_draft") return;
  const { rows } = await tx.execute<{ full: boolean }>(sql`select app_ai_hour_full(${kind}) as full`);
  if (rows[0]?.full) throw new RateLimitError(kind === "summary" ? "too many summaries, try again later" : "too many translations, try again later");
}

/**
 * File a job for the person, or give back the one they already have waiting
 * for the same thing (`key`), so asking twice does not run the model twice,
 * also when the two requests come at once (they take turns on the person's
 * lock). Refused: the hourly limit (429), or as many jobs as they may have
 * at once (409 "busy"; the database checks it too, check_ai_job).
 * `beforeNew` spends anything that only a new job should spend.
 */
export async function fileJob(
  tx: Tx,
  principal: Principal,
  kind: AiJobKind,
  key: string,
  input: Record<string, unknown>,
  beforeNew?: () => void,
): Promise<AiJob> {
  await endStale(tx);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ai_jobs:' || ${principal.userId}))`);
  const [waiting] = await tx
    .select()
    .from(aiJobs)
    .where(and(eq(aiJobs.createdBy, principal.userId), eq(aiJobs.key, key), inArray(aiJobs.status, ["queued", "running"])));
  if (waiting) return view(tx, waiting);
  await assertHourLeft(tx, kind);
  // As many at once as the assistant's answers (#208).
  const [{ n } = { n: 0 }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(aiJobs)
    .where(and(eq(aiJobs.createdBy, principal.userId), inArray(aiJobs.status, ["queued", "running"])));
  if (n >= ANSWERS_AT_ONCE[principal.orgKind]) throw new ConflictError(BUSY);
  beforeNew?.();
  const [row] = await tx.insert(aiJobs).values({ kind, key, input, createdBy: principal.userId, orgId: principal.orgId }).returning();
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "ai_job.request",
    resourceType: "ai_job",
    resourceId: row!.id,
    outcome: "allow",
    meta: { kind },
  });
  return view(tx, row!);
}

/** The route's answer for a filed job: 202, and the job to ask after. */
export function accepted(job: AiJob): Response {
  return NextResponse.json({ job }, { status: 202 });
}

async function own(tx: Tx, id: string): Promise<Row> {
  // Row-level security: another person's job is not found.
  const [row] = await tx.select().from(aiJobs).where(eq(aiJobs.id, id));
  if (!row) throw new NotFoundError("job");
  return row;
}

/**
 * Where the person's job stands. A finished org chart draft comes with its
 * rows, signed for the review step, once: only while the person may still
 * import into that client's draft with the assistant on, and the rows are
 * cleared as they are handed over. A summary or translation is read where
 * it is kept, through its own route, with its own rights.
 */
export async function getJob(tx: Tx, principal: Principal, id: string): Promise<AiJob & { draft?: ImportedRows }> {
  await endStale(tx);
  const row = await own(tx, id);
  const job = await view(tx, row);
  if (row.kind !== "org_draft" || row.status !== "done") return job;
  // The client is in the job's key ("org_draft:<client>:<hash of the text>").
  const clientOrgId = row.key.split(":")[1] ?? "";
  try {
    const draft = await fetchOrgDraft(tx, principal, clientOrgId, async () => {
      const { rows } = await tx.execute<{ result: OrgDraftResult | null }>(sql`select app_take_ai_job_result(${row.id}) as result`);
      return rows[0]?.result ?? null;
    });
    return draft ? { ...job, draft } : { ...job, status: "expired", error: "taken" };
  } catch (e) {
    // They may no longer import into that client's draft, or the assistant is off there now.
    if (e instanceof NotFoundError) return { ...job, status: "refused", error: "access" };
    throw e;
  }
}

/** The person stops their own job: a waiting one is not run; for a running one the runner hangs up on the model and keeps nothing. */
export async function cancelJob(tx: Tx, principal: Principal, id: string): Promise<AiJob> {
  const { rows } = await tx.execute<{ ok: boolean }>(sql`select app_cancel_ai_job(${id}) as ok`);
  if (!rows[0]?.ok) {
    // Already finished: say how it ended. Not theirs: not found.
    return view(tx, await own(tx, id));
  }
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "ai_job.cancel",
    resourceType: "ai_job",
    resourceId: id,
    outcome: "allow",
  });
  return view(tx, await own(tx, id));
}
