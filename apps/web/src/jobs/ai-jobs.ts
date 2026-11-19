// The jobs runner's side of slow AI calls (docs/assistant.md, "Slow calls as
// jobs"): file summaries, translations and org chart drafts from pasted
// text, filed by the routes (services/ai-jobs.ts) and done here one at a
// time, oldest first, whoever asked (app_claim_ai_job takes one only while
// none runs; the model is one shared queue). Each job runs as the person who
// asked, in four steps:
//
//   1. whether names are masked is decided first, before any transaction,
//      and fails closed (maskingOn: masked unless the AI service says local);
//   2. a transaction as the person: their rights checked again (they may
//      have lost them since asking), and what the model is given;
//   3. the model, outside any transaction (minutes on a processor); if the
//      person cancels, the runner hangs up and keeps nothing;
//   4. a second transaction as the person: their rights checked again, then
//      the answer kept where it always was, and audited.
//
// A refusal ends the job "refused" with a reason the page has words for; a
// model failure ends it "failed". The pasted text is cleared when the job ends.
import { sql } from "drizzle-orm";
import { ForbiddenError, type Principal } from "@/authz";
import type { AiJobError, AiJobKind, AiJobStatus } from "@/lib/ai-jobs";
import { BadRequestError, ConflictError, NotFoundError, RateLimitError } from "@/server/errors";
import type { OrgDraft, SummaryPoint } from "@/services/ai-client";
import { audit } from "@/services/audit";
import { prepareSummary, storeSummary, summaryFailed, type SummaryWork } from "@/services/document-summaries";
import { finishOrgDraft, orgDraftFailure, prepareOrgDraft, type OrgDraftWork } from "@/services/org-chart-import";
import { loadPrincipal } from "@/services/principal";
import { prepareTranslation, storeTranslation, type TranslationRequest, type TranslationWork } from "@/services/translations";

// A transaction as the person (the jobs may not open one: services do, and the runner hands one in).
type Tx = Parameters<typeof loadPrincipal>[0];

interface Queryable {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

/** The model's three calls (services/ai-client.ts in the runner; fakes in the tests). */
export interface AiModel {
  summarize(pages: { n: number; text: string }[], lang: "ar" | "en", stop: AbortSignal): Promise<{ points: SummaryPoint[]; model: string }>;
  translate(text: string, source: "ar" | "en", target: "ar" | "en", stop: AbortSignal): Promise<{ text: string; model: string }>;
  draftOrgChart(text: string, stop: AbortSignal): Promise<OrgDraft>;
}

export interface AiJobDeps {
  /** The schema owner: takes and ends jobs. */
  owner: Queryable;
  /** A transaction as the person, under row-level security (the app role with selah.user_id set). */
  asUser: <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;
  /** services/masking.ts maskingOn: true unless the AI service says its model is local. */
  maskingOn: () => Promise<boolean>;
  model: AiModel;
  /** How often a running job looks whether it was cancelled (10 s). */
  checkEveryMs?: number;
}

interface ClaimedJob {
  id: string;
  kind: AiJobKind;
  input: Record<string, unknown> | null;
  created_by: string;
}

type Prepared<W> = { done: true } | { work: W };

interface Kind<W> {
  prepare(tx: Tx, principal: Principal, input: Record<string, unknown>, masked: boolean): Promise<Prepared<W>>;
  ask(model: AiModel, work: W, stop: AbortSignal): Promise<unknown>;
  /** The model failed: anything to note, and the error the page is told. */
  failed(work: W, e: unknown): Error;
  /** Keep the answer; what is returned waits in ai_jobs.result (only an org chart draft). */
  finish(tx: Tx, principal: Principal, work: W, reply: unknown, input: Record<string, unknown>): Promise<Record<string, unknown> | null>;
}

const summary: Kind<SummaryWork> = {
  async prepare(tx, principal, input, masked) {
    const r = await prepareSummary(tx, principal, String(input.documentId), input.lang === "en" ? "en" : "ar", masked);
    return "kept" in r ? { done: true } : r;
  },
  ask: (model, work, stop) => model.summarize(work.pages, work.lang, stop),
  failed(work) {
    summaryFailed(work);
    return new Error("unavailable");
  },
  async finish(tx, principal, work, reply) {
    await storeSummary(tx, principal, work, reply as Awaited<ReturnType<AiModel["summarize"]>>);
    return null;
  },
};

const translation: Kind<TranslationWork> = {
  async prepare(tx, _principal, input, masked) {
    const r = await prepareTranslation(tx, input as unknown as TranslationRequest, masked);
    return "done" in r ? { done: true } : r;
  },
  ask: (model, work, stop) => model.translate(work.text, work.sourceLang, work.request.to, stop),
  failed: () => new Error("unavailable"),
  async finish(tx, principal, work, reply) {
    await storeTranslation(tx, principal, work, reply as Awaited<ReturnType<AiModel["translate"]>>);
    return null;
  },
};

const orgDraft: Kind<OrgDraftWork> = {
  prepare: (tx, principal, input, masked) => prepareOrgDraft(tx, principal, String(input.clientOrgId), String(input.text ?? ""), masked),
  ask: (model, work, stop) => model.draftOrgChart(work.masked, stop),
  failed: (_work, e) => orgDraftFailure(e),
  async finish(tx, principal, work, reply) {
    const d = await finishOrgDraft(tx, principal, work, reply as OrgDraft);
    return { clientOrgId: work.clientOrgId, ...d };
  },
};

const KINDS: Record<AiJobKind, Kind<unknown>> = {
  summary: summary as Kind<unknown>,
  translation: translation as Kind<unknown>,
  org_draft: orgDraft as Kind<unknown>,
};

class Cancelled extends Error {}

/** A refusal's reason, in the words the page knows (lib/ai-jobs.ts); null when it is not a refusal but a failure. */
export function refusalOf(e: unknown): AiJobError | null {
  if (e instanceof NotFoundError || e instanceof ForbiddenError) return "access";
  if (e instanceof RateLimitError) return "limit";
  if (e instanceof ConflictError) {
    if (e.message === "local model only") return "local_only";
    if (/changed/.test(e.message)) return "changed";
    return "access";
  }
  if (e instanceof BadRequestError) {
    if (/too long/.test(e.message)) return "too_long";
    if (/no text/.test(e.message)) return "no_text";
    return "access";
  }
  // The database refused: row-level security (42501) is not having access; SL429 an hourly limit.
  for (let x = e; x instanceof Error; x = x.cause) {
    const code = (x as { code?: unknown }).code;
    if (code === "42501") return "access";
    if (code === "SL429") return "limit";
  }
  return null;
}

interface Outcome {
  status: Extract<AiJobStatus, "done" | "failed" | "refused" | "cancelled">;
  error?: AiJobError;
  result?: Record<string, unknown> | null;
}

async function asPerson<T>(deps: AiJobDeps, job: ClaimedJob, fn: (tx: Tx, p: Principal) => Promise<T>): Promise<T> {
  return deps.asUser(job.created_by, async (tx) => {
    // Rights as they are now: a person who left has none.
    const principal = await loadPrincipal(tx, job.created_by);
    if (!principal) throw new NotFoundError("person");
    return fn(tx, principal);
  });
}

async function run(deps: AiJobDeps, job: ClaimedJob): Promise<Outcome> {
  const kind = KINDS[job.kind];
  const input = job.input ?? {};
  const refusedOr = (e: unknown, failure: Outcome): Outcome => {
    if (e instanceof Cancelled) return { status: "cancelled", error: "cancelled" };
    const why = refusalOf(e);
    return why ? { status: "refused", error: why } : failure;
  };
  // 1. Masking, decided before any transaction (fails closed).
  const masked = await deps.maskingOn();
  // 2. The person's rights, and what the model is given.
  let prepared: Prepared<unknown>;
  try {
    prepared = await asPerson(deps, job, (tx, p) => kind.prepare(tx, p, input, masked));
  } catch (e) {
    return refusedOr(e, { status: "failed", error: "unavailable" });
  }
  // Made by someone else meanwhile (a kept summary or translation): nothing to ask.
  if ("done" in prepared) return { status: "done", result: null };
  const work = prepared.work;

  // 3. The model, outside any transaction; a cancel hangs up on it.
  const stop = new AbortController();
  const watch = setInterval(() => {
    deps.owner
      .query<{ status: string }>("SELECT status FROM ai_jobs WHERE id = $1", [job.id])
      .then(({ rows }) => {
        if (rows[0]?.status !== "running") stop.abort(new Cancelled());
      })
      .catch(() => undefined);
  }, deps.checkEveryMs ?? 10_000);
  let reply: unknown;
  try {
    reply = await kind.ask(deps.model, work, stop.signal);
  } catch (e) {
    if (stop.signal.aborted) return { status: "cancelled", error: "cancelled" };
    const err = kind.failed(work, e);
    console.error(`ai job ${job.id} (${job.kind}): the model failed: ${e instanceof Error ? e.message : String(e)}`);
    return refusedOr(err, { status: "failed", error: "unavailable" });
  } finally {
    clearInterval(watch);
  }

  // 4. The person's rights again, then the answer kept.
  try {
    const result = await asPerson(deps, job, async (tx, p) => {
      // Their own job, still running: not cancelled meanwhile.
      const { rows } = await tx.execute<{ status: string }>(sql`select status from ai_jobs where id = ${job.id}`);
      if (rows[0]?.status !== "running") throw new Cancelled();
      return kind.finish(tx, p, work, reply, input);
    });
    return { status: "done", result };
  } catch (e) {
    return refusedOr(e, { status: "failed", error: "unavailable" });
  }
}

/**
 * Take the oldest waiting job, if none runs, and do it. Returns what became
 * of it, or null when there was nothing to take.
 */
export async function runNextAiJob(deps: AiJobDeps): Promise<{ id: string; kind: AiJobKind; status: Outcome["status"]; error: AiJobError | null } | null> {
  const { rows } = await deps.owner.query<ClaimedJob>("SELECT id, kind, input, created_by FROM app_claim_ai_job()");
  const job = rows[0];
  if (!job) return null;
  let out: Outcome;
  try {
    out = await run(deps, job);
  } catch (e) {
    console.error(`ai job ${job.id} (${job.kind}) failed: ${e instanceof Error ? e.message : String(e)}`);
    out = { status: "failed", error: "unavailable" };
  }
  // The pasted text goes now; a cancelled job keeps its own ending.
  await deps.owner.query(
    `UPDATE ai_jobs SET status = $2, error = $3, result = $4, input = NULL, finished_at = now() WHERE id = $1 AND status = 'running'`,
    [job.id, out.status, out.status === "done" ? null : (out.error ?? null), out.result ? JSON.stringify(out.result) : null],
  );
  if (out.status === "refused") {
    // Rights lost between asking and the answer: on the record, like any denial.
    await deps
      .asUser(job.created_by, (tx) =>
        audit(tx, {
          actorId: job.created_by,
          action: "ai_job.refused",
          resourceType: "ai_job",
          resourceId: job.id,
          outcome: "deny",
          reason: out.error,
          meta: { kind: job.kind },
        }),
      )
      .catch(() => undefined);
  }
  return { id: job.id, kind: job.kind, status: out.status, error: out.status === "done" ? null : (out.error ?? null) };
}

/** A runner that starts finds no job of its own running: one left "running" was the last runner's, stopped mid-job. */
export async function endOrphanedAiJobs(owner: Queryable): Promise<number> {
  const { rows } = await owner.query(
    `UPDATE ai_jobs SET status = 'failed', error = 'stopped', input = NULL, finished_at = now() WHERE status = 'running' RETURNING id`,
  );
  return rows.length;
}
