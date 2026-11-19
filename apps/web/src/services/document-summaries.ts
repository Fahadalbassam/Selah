import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { aiChunks, documentSummaries, documents, projects } from "@/db/schema";
import { assertAllowed, type Principal } from "@/authz";
import { BadRequestError, ConflictError, NotFoundError, UnavailableError } from "@/server/errors";
import { summarizePages, type SummaryPoint } from "./ai-client";
import { audit } from "./audit";
import { maskingOn, projectMasker } from "./masking";
import type { Masker } from "@/lib/masking";

// File summaries (baseline: AI sources). One per file version
// and language, made the first time someone asks and then kept. The model
// is asked in a job (services/ai-jobs.ts), never while a request waits. It is made
// from the same page text the assistant searches, read with the caller's own
// rights, and every line cites its pages. The database decides who reads it
// (whoever can open the file) and limits how many a person makes an hour.

export type Summarizer = (
  pages: { n: number; text: string }[],
  lang: "ar" | "en",
) => Promise<{ points: SummaryPoint[]; model: string }>;

const MAX_PAGES = 200;

// A file the model just failed on is not sent again for a while: a failed
// call keeps nothing, so it doesn't count towards the database's hourly
// limit. Per process (the jobs runner's, where the model is asked).
const FAILURE_PAUSE_MS = 10 * 60_000;
const failedUntil = new Map<string, number>();
function failed(key: string) {
  if (failedUntil.size > 10_000) failedUntil.clear();
  failedUntil.set(key, Date.now() + FAILURE_PAUSE_MS);
}

async function loadForSummary(tx: Tx, principal: Principal, documentId: string) {
  // Row-level security: a file the caller can't open is not found.
  const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) throw new NotFoundError("document");
  const [project] = await tx.select().from(projects).where(eq(projects.id, doc.projectId));
  if (!project) throw new NotFoundError("document");
  assertAllowed(principal, "document.summarize", {
    type: "project",
    id: project.id,
    orgId: project.orgId,
    firmOrgId: project.firmOrgId,
    projectId: project.id,
  });
  return doc;
}

async function keptSummary(tx: Tx, doc: { id: string; sha256: string }, lang: "ar" | "en") {
  const [kept] = await tx
    .select()
    .from(documentSummaries)
    .where(
      and(eq(documentSummaries.documentId, doc.id), eq(documentSummaries.sha256, doc.sha256), eq(documentSummaries.lang, lang)),
    );
  return kept ?? null;
}

/**
 * The summary already made for the file's current version in this language,
 * if any, and whether one can be made: never calls the model.
 */
export async function getDocumentSummary(tx: Tx, principal: Principal, documentId: string, lang: "ar" | "en") {
  const doc = await loadForSummary(tx, principal, documentId);
  const kept = await keptSummary(tx, doc, lang);
  // Reading a kept summary is reading the file's content, so it is logged like a download (R2).
  if (kept) {
    await audit(tx, {
      actorId: principal.userId,
      orgId: principal.orgId,
      action: "document.summary_view",
      resourceType: "document",
      resourceId: doc.id,
      outcome: "allow",
      meta: { version: doc.version, lang },
    });
  }
  return {
    aiIndexable: doc.aiIndexable,
    textStatus: doc.textStatus,
    summary: kept ? view(kept) : null,
  };
}

/** The file, if a summary can be made of it: the caller may open it and ask for one, it is for the assistant, and its text was read. */
async function summarizable(tx: Tx, principal: Principal, documentId: string) {
  const doc = await loadForSummary(tx, principal, documentId);
  if (!doc.aiIndexable) throw new ConflictError("this file is not available to the assistant");
  if (doc.textStatus === "not_searchable") throw new ConflictError("this file's text could not be read");
  if (doc.textStatus === "needs_ocr") throw new ConflictError("this file is a scan and its text has not been recognised yet");
  if (doc.textStatus !== "searchable") throw new ConflictError("this file has not been indexed yet");
  return doc;
}

/**
 * Asking for a summary on the page (POST): the kept one when there is one,
 * else null, and the caller files a job (services/ai-jobs.ts). Every check
 * the job makes again is made here first, so a refusal shows at once.
 */
export async function requestSummary(tx: Tx, principal: Principal, documentId: string, lang: "ar" | "en") {
  const doc = await summarizable(tx, principal, documentId);
  const kept = await keptSummary(tx, doc, lang);
  return kept ? view(kept) : null;
}

/** What the model is given for one summary, and what is needed to keep its answer. */
export interface SummaryWork {
  documentId: string;
  lang: "ar" | "en";
  sha256: string;
  /** The pages, masked for a hosted model. */
  pages: { n: number; text: string }[];
  masker: Masker;
}

/**
 * The first half of making a summary, as the person who asked (the job's
 * first transaction): the kept summary if one was made meanwhile, or the
 * pages to send. `masked` is maskingOn(), decided before the transaction.
 */
export async function prepareSummary(
  tx: Tx,
  principal: Principal,
  documentId: string,
  lang: "ar" | "en",
  masked: boolean,
): Promise<{ kept: SummaryView } | { work: SummaryWork }> {
  const doc = await summarizable(tx, principal, documentId);
  const kept = await keptSummary(tx, doc, lang);
  if (kept) return { kept: view(kept) };

  const chunks = await tx
    .select({ page: aiChunks.page, content: aiChunks.content })
    .from(aiChunks)
    .where(and(eq(aiChunks.sourceType, "document"), eq(aiChunks.sourceId, doc.id), eq(aiChunks.sourceVersion, doc.version)))
    .orderBy(asc(aiChunks.page), asc(aiChunks.chunkIndex));
  const byPage = new Map<number, string[]>();
  for (const c of chunks) byPage.set(c.page ?? 1, [...(byPage.get(c.page ?? 1) ?? []), c.content]);
  const pages = [...byPage].slice(0, MAX_PAGES).map(([n, parts]) => ({ n, text: parts.join("\n").slice(0, 20000) }));
  if (!pages.length) throw new BadRequestError("this file has no text to summarise");

  if ((failedUntil.get(`${doc.sha256}:${lang}`) ?? 0) > Date.now())
    throw new UnavailableError("this file could not be summarised, try again later");
  // A hosted model gets placeholders for known names (docs/assistant.md); any model gets tags for
  // personal numbers (section 7 item 6), which stay tags in the summary as in the passages.
  const masker = await projectMasker(tx, doc.projectId, masked);
  return { work: { documentId: doc.id, lang, sha256: doc.sha256, pages: pages.map((p) => ({ ...p, text: masker.mask(p.text) })), masker } };
}

/** The model failed on this file: it is not sent again for a while. */
export function summaryFailed(work: SummaryWork) {
  failed(`${work.sha256}:${work.lang}`);
}

/**
 * The second half, as the person who asked (the job's second transaction):
 * every check again (they may have lost the file meanwhile), the file must
 * be the version the model read, then the answer is kept.
 */
export async function storeSummary(tx: Tx, principal: Principal, work: SummaryWork, reply: Awaited<ReturnType<Summarizer>>) {
  const doc = await summarizable(tx, principal, work.documentId);
  if (doc.sha256 !== work.sha256) throw new ConflictError("the file changed while it was being summarised");
  const made = { ...reply, points: reply.points.map((p) => ({ ...p, text: work.masker.unmask(p.text) })) };
  // Only points that cite pages we gave, one line each.
  const known = new Set(work.pages.map((p) => p.n));
  const points = made.points
    .map((p) => ({
      text: p.text.replace(/\s+/g, " ").trim(),
      pages: [...new Set(p.pages.filter((n) => known.has(n)))].sort((a, b) => a - b),
    }))
    .filter((p) => p.text && p.pages.length);
  if (!points.length) {
    summaryFailed(work);
    throw new UnavailableError("the model gave no summary that cites the file");
  }

  const [row] = await tx
    .insert(documentSummaries)
    .values({
      documentId: doc.id,
      projectId: doc.projectId,
      orgId: doc.orgId,
      sha256: doc.sha256,
      lang: work.lang,
      summary: points.map((p) => p.text).join("\n"),
      citations: points.map((p, i) => ({ line: i + 1, pages: p.pages })),
      model: made.model,
      createdBy: principal.userId,
    })
    .onConflictDoNothing()
    .returning();
  // Someone else made it a moment earlier: use theirs.
  if (row) return view(row);
  const theirs = await keptSummary(tx, doc, work.lang);
  if (!theirs) throw new NotFoundError("summary");
  return view(theirs);
}

/**
 * Both halves and the model in one transaction: for the tests, which fake
 * the model. The app makes summaries as jobs (services/ai-jobs.ts), so no
 * transaction waits on the model.
 */
export async function summarizeDocument(
  tx: Tx,
  principal: Principal,
  documentId: string,
  lang: "ar" | "en",
  summarizer: Summarizer = summarizePages,
  masked?: boolean,
) {
  const ready = await prepareSummary(tx, principal, documentId, lang, masked ?? (await maskingOn()));
  if ("kept" in ready) return ready.kept;
  let made: Awaited<ReturnType<Summarizer>>;
  try {
    made = await summarizer(ready.work.pages, lang);
  } catch {
    summaryFailed(ready.work);
    throw new UnavailableError("summaries are not available right now");
  }
  return storeSummary(tx, principal, ready.work, made);
}

export type SummaryView = ReturnType<typeof view>;

function view(s: typeof documentSummaries.$inferSelect) {
  const lines = s.summary.split("\n");
  return {
    id: s.id,
    documentId: s.documentId,
    lang: s.lang,
    model: s.model,
    createdAt: s.createdAt,
    points: lines.map((text, i) => ({ text, pages: s.citations.find((c) => c.line === i + 1)?.pages ?? [] })),
  };
}
