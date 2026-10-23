import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { Principal } from "@/authz";
import { detectLang, isTranslatable } from "@/lib/translations";
import { BadRequestError, NotFoundError, UnavailableError } from "@/server/errors";
import { translateText } from "./ai-client";
import { projectMasker } from "./masking";

// On-demand translations (baseline: Translations). The database
// lets a person read or make a translation only while they can read the
// original and it is unchanged; this service finds the original, returns the
// kept translation if there is one, or asks the model once and keeps it.

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
  const { rows } = await tx.execute<{ project_id: string; org_id: string; body: string | null }>(
    sql`select project_id, org_id, body from app_translation_source(${r.entityType}, ${r.entityId}, ${r.field})`,
  );
  const row = rows[0];
  if (!row || !row.body?.trim()) throw new NotFoundError("text");
  return { projectId: row.project_id, orgId: row.org_id, body: row.body };
}

async function kept(tx: Tx, r: TranslationRequest, hash: string) {
  const { rows } = await tx.execute<Row>(sql`
    select id, text, reviewed_by from content_translations
    where entity_type = ${r.entityType} and entity_id = ${r.entityId} and field = ${r.field}
      and target_lang = ${r.to} and source_sha256 = ${hash}`);
  return rows[0];
}

export async function translate(tx: Tx, principal: Principal, r: TranslationRequest): Promise<TranslationResult> {
  const src = await source(tx, r);
  const sourceLang = detectLang(src.body);
  if (sourceLang === r.to) return { id: null, text: src.body, sourceLang, original: true, reviewed: false };
  if (src.body.length > MAX_CHARS) throw new BadRequestError("this text is too long to translate");

  const hash = sha256(src.body);
  const hit = await kept(tx, r, hash);
  if (hit) return { id: hit.id, text: hit.text, sourceLang, original: false, reviewed: hit.reviewed_by !== null };

  let made: { text: string; model: string };
  try {
    // A hosted model gets placeholders for known names (docs/assistant.md).
    const masker = await projectMasker(tx, src.projectId);
    made = await translateText(masker.mask(src.body), sourceLang, r.to);
    made = { ...made, text: masker.unmask(made.text) };
  } catch {
    throw new UnavailableError("translation is not available right now");
  }
  const { rows } = await tx.execute<Row>(sql`
    insert into content_translations
      (project_id, org_id, entity_type, entity_id, field, source_lang, target_lang, source_sha256, text, model, created_by)
    values (${src.projectId}, ${src.orgId}, ${r.entityType}, ${r.entityId}, ${r.field}, ${sourceLang}, ${r.to}, ${hash},
            ${made.text}, ${made.model}, ${principal.userId})
    on conflict (entity_type, entity_id, field, target_lang, source_sha256) do nothing
    returning id, text, reviewed_by`);
  // Someone else made it a moment earlier: use theirs.
  const row = rows[0] ?? (await kept(tx, r, hash));
  if (!row) throw new NotFoundError("text");
  return { id: row.id, text: row.text, sourceLang, original: false, reviewed: row.reviewed_by !== null };
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
