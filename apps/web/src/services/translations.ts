import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { Principal } from "@/authz";
import { detectLang, isTranslatable } from "@/lib/translations";
import type { Masker } from "@/lib/masking";
import { BadRequestError, ConflictError, NotFoundError, UnavailableError } from "@/server/errors";
import { translateText } from "./ai-client";
import { maskingOn, textMasker } from "./masking";

// On-demand translations (baseline: Translations). The database
// lets a person read or make a translation only while they can read the
// original and it is unchanged; this service finds the original, returns the
// kept translation if there is one, or asks the model once, in a job
// (services/ai-jobs.ts), and keeps it.

export interface TranslationRequest {
  entityType: string;
  entityId: string;
  field: string;
  to: "ar" | "en";
}

export interface TranslationResult {
  id: string | null;
  text: string;
  sourceLang: "ar" | "en";
  /** True when the text is the original, already in the language asked for. */
  original: boolean;
  reviewed: boolean;
}

const MAX_CHARS = 20000;
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

type Row = { id: string; text: string; reviewed_by: string | null };

async function source(tx: Tx, r: Omit<TranslationRequest, "to">) {
  if (!isTranslatable(r.entityType, r.field)) throw new BadRequestError("this text cannot be translated");
  const { rows } = await tx.execute<{ project_id: string | null; org_id: string; body: string | null }>(
    sql`select project_id, org_id, body from app_translation_source(${r.entityType}, ${r.entityId}, ${r.field})`,
  );
  const row = rows[0];
  if (!row || !row.body?.trim()) throw new NotFoundError("text");
  // An answer in a chat across projects quotes the projects it names (ai_messages.project_ids).
  const projectIds = row.project_id
    ? [row.project_id]
    : ((await tx.execute<{ ids: string[] | null }>(sql`select project_ids as ids from ai_messages where id = ${r.entityId}`)).rows[0]?.ids ?? []);
  return { projectId: row.project_id, projectIds, orgId: row.org_id, body: row.body };
}

async function kept(tx: Tx, r: TranslationRequest, hash: string) {
  const { rows } = await tx.execute<Row>(sql`
    select id, text, reviewed_by from content_translations
    where entity_type = ${r.entityType} and entity_id = ${r.entityId} and field = ${r.field}
      and target_lang = ${r.to} and source_sha256 = ${hash}`);
  return rows[0];
}

/** The original in the language asked for, or the kept translation; null when the model must be asked. */
async function ready(tx: Tx, r: TranslationRequest) {
  const src = await source(tx, r);
  const sourceLang = detectLang(src.body);
  if (sourceLang === r.to) return { src, sourceLang, hash: "", done: { id: null, text: src.body, sourceLang, original: true, reviewed: false } as TranslationResult };
  if (src.body.length > MAX_CHARS) throw new BadRequestError("this text is too long to translate");
  const hash = sha256(src.body);
  const hit = await kept(tx, r, hash);
  const done: TranslationResult | null = hit ? { id: hit.id, text: hit.text, sourceLang, original: false, reviewed: hit.reviewed_by !== null } : null;
  return { src, sourceLang, hash, done };
}

/**
 * Asking on the page (POST): the original or the kept translation, or null,
 * and the caller files a job (services/ai-jobs.ts). The database lets the
 * person read the original, or the call is a 404, before any job is filed.
 */
export async function requestTranslation(tx: Tx, r: TranslationRequest): Promise<TranslationResult | null> {
  return (await ready(tx, r)).done;
}

/** What the model is given for one translation, and what is needed to keep its answer. */
export interface TranslationWork {
  request: TranslationRequest;
  sourceLang: "ar" | "en";
  hash: string;
  /** The text, masked for a hosted model. */
  text: string;
  masker: Masker;
}

/**
 * The first half, as the person who asked (the job's first transaction): the
 * kept translation if one was made meanwhile, or the text to send. `masked`
 * is maskingOn(), decided before the transaction.
 */
export async function prepareTranslation(
  tx: Tx,
  r: TranslationRequest,
  masked: boolean,
): Promise<{ done: TranslationResult } | { work: TranslationWork }> {
  const { src, sourceLang, hash, done } = await ready(tx, r);
  if (done) return { done };
  // A hosted model gets placeholders for the known names written in the text (docs/translations.md).
  const masker = await textMasker(tx, src.projectIds, src.body, masked);
  return { work: { request: r, sourceLang, hash, text: masker.mask(src.body), masker } };
}

/**
 * The second half, as the person who asked (the job's second transaction):
 * they must still read the original, unchanged since the model read it; the
 * database checks both again on insert (app_translation_current).
 */
export async function storeTranslation(tx: Tx, principal: Principal, work: TranslationWork, reply: { text: string; model: string }): Promise<TranslationResult> {
  const r = work.request;
  const src = await source(tx, r);
  if (sha256(src.body) !== work.hash) throw new ConflictError("the text changed while it was being translated");
  const text = work.masker.unmask(reply.text);
  const { rows } = await tx.execute<Row>(sql`
    insert into content_translations
      (project_id, org_id, entity_type, entity_id, field, source_lang, target_lang, source_sha256, text, model, created_by)
    values (${src.projectId}, ${src.orgId}, ${r.entityType}, ${r.entityId}, ${r.field}, ${work.sourceLang}, ${r.to}, ${work.hash},
            ${text}, ${reply.model}, ${principal.userId})
    on conflict (entity_type, entity_id, field, target_lang, source_sha256) do nothing
    returning id, text, reviewed_by`);
  // Someone else made it a moment earlier: use theirs.
  const row = rows[0] ?? (await kept(tx, r, work.hash));
  if (!row) throw new NotFoundError("text");
  return { id: row.id, text: row.text, sourceLang: work.sourceLang, original: false, reviewed: row.reviewed_by !== null };
}

/**
 * Both halves and the model in one transaction: for the tests, which fake
 * the model. The app translates in jobs (services/ai-jobs.ts), so no
 * transaction waits on the model. `masked`: maskingOn(); left out, it is asked here.
 */
export async function translate(tx: Tx, principal: Principal, r: TranslationRequest, masked?: boolean): Promise<TranslationResult> {
  const prepared = await prepareTranslation(tx, r, masked ?? (await maskingOn()));
  if ("done" in prepared) return prepared.done;
  let made: { text: string; model: string };
  try {
    made = await translateText(prepared.work.text, prepared.work.sourceLang, r.to);
  } catch {
    throw new UnavailableError("translation is not available right now");
  }
  return storeTranslation(tx, principal, prepared.work, made);
}

/**
 * Firm staff correct a translation and mark it reviewed; it then loses the
 * "machine translated" label. The original stays the record.
 */
export async function reviewTranslation(tx: Tx, principal: Principal, id: string, input: { text?: string }) {
  if (principal.orgKind !== "firm") throw new NotFoundError("translation");
  const { rows } = await tx.execute<{ id: string; text: string }>(sql`
    update content_translations set text = coalesce(${input.text ?? null}, text), reviewed_at = now()
    where id = ${id} returning id, text`);
  if (!rows[0]) throw new NotFoundError("translation");
  return { id: rows[0].id, text: rows[0].text, reviewed: true };
}
