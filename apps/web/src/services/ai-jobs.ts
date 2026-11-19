import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import { aiJobs } from "@/db/schema";
import type { AiJob, AiJobError, AiJobKind, AiJobStatus } from "@/lib/ai-jobs";
import { ConflictError, NotFoundError } from "@/server/errors";
import { ANSWERS_AT_ONCE } from "./assistant-in-flight";
import { audit } from "./audit";
import { fetchOrgDraft, type OrgDraftResult } from "./org-chart-import";

// Slow AI calls as jobs (docs/assistant.md, "Slow calls as jobs"). The page
// asks; the route checks everything it can as the person, files a job here
// and answers 202 at once, so no response waits minutes on the local model
// (Cloudflare's tunnel gives up on one that has not started in 100 seconds).
// The jobs runner (src/jobs/ai-jobs.ts) does the jobs one at a time, as the
// person who asked, checking again. The database keeps each person's jobs
// to themselves and limits how many they may have waiting (migration 0113).

type Row = typeof aiJobs.$inferSelect;

async function view(tx: Tx, row: Row): Promise<AiJob> {
  const ahead =
    row.status === "queued" ? ((await tx.execute<{ n: number | null }>(sql`select app_ai_job_ahead(${row.id}) as n`)).rows[0]?.n ?? null) : null;
  return { id: row.id, kind: row.kind as AiJobKind, status: row.status as AiJobStatus, error: (row.error as AiJobError | null) ?? null, ahead };
}

/**
 * File a job for the person, or give back the one they already have waiting
 * for the same thing (`key`), so asking twice does not run the model twice.
 * The database refuses one more than they may have at once (SL429: 429).
 */
export async function fileJob(tx: Tx, principal: Principal, kind: AiJobKind, key: string, input: Record<string, unknown>): Promise<AiJob> {
  const [waiting] = await tx
    .select()
    .from(aiJobs)
    .where(and(eq(aiJobs.createdBy, principal.userId), eq(aiJobs.key, key), inArray(aiJobs.status, ["queued", "running"])));
  if (waiting) return view(tx, waiting);
  // As many at once as the assistant's answers (#208); the database checks it too (check_ai_job).
  const [{ n } = { n: 0 }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(aiJobs)
    .where(and(eq(aiJobs.createdBy, principal.userId), inArray(aiJobs.status, ["queued", "running"])));
  if (n >= ANSWERS_AT_ONCE[principal.orgKind]) throw new ConflictError("you already have requests being worked on");
  const [row] = await tx.insert(aiJobs).values({ kind, key, input, createdBy: principal.userId }).returning();
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
 * rows, signed for the review step, only while the person may still import
 * into that client's draft; a summary or translation is read where it is
 * kept, through its own route, with its own rights.
 */
export async function getJob(tx: Tx, principal: Principal, id: string): Promise<AiJob & { draft?: Awaited<ReturnType<typeof fetchOrgDraft>> }> {
  const row = await own(tx, id);
  const job = await view(tx, row);
  if (row.kind === "org_draft" && row.status === "done" && row.result) {
    const { clientOrgId, ...draft } = row.result as unknown as OrgDraftResult & { clientOrgId: string };
    try {
      return { ...job, draft: await fetchOrgDraft(tx, principal, clientOrgId, draft) };
    } catch (e) {
      // They may no longer import into that client's draft.
      if (e instanceof NotFoundError) return { ...job, status: "refused", error: "access" };
      throw e;
    }
  }
  return job;
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
