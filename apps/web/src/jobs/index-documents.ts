// The assistant's search index for files (ai_chunks). Runs as the schema
// owner. One index, built from each file's original text in whatever
// language it is written; the embedding model is multilingual, so an Arabic
// question finds English text and the other way round. Each passage keeps
// its page, and copies the file's project, label and owner so retrieval
// filters inside the vector query. A file with no readable text is marked
// "not searchable" instead of quietly missing from answers.
import { detectLang } from "../lib/translations";

interface Queryable {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

/** Turns passages into vectors; the AI service in production, a fake in tests. */
export type Embed = (texts: string[]) => Promise<number[][]>;

export interface Page {
  n: number;
  text: string;
}

const PASSAGE_CHARS = 1200;

/** Pages of a plain-text file: a form feed starts a new page (as pdftotext writes them). */
export function pagesFromText(text: string): Page[] {
  return text.split("\f").map((t, i) => ({ n: i + 1, text: t }));
}

/** Passages of at most ~1200 characters, split at blank lines, then lines, never across pages. */
export function passages(pages: Page[]): { page: number; text: string }[] {
  const out: { page: number; text: string }[] = [];
  for (const p of pages) {
    let current = "";
    for (const para of p.text.split(/\n\s*\n/).flatMap((x) => (x.length > PASSAGE_CHARS ? x.split("\n") : [x]))) {
      const piece = para.trim();
      if (!piece) continue;
      if (current && current.length + piece.length + 2 > PASSAGE_CHARS) {
        out.push({ page: p.n, text: current });
        current = "";
      }
      // A single line longer than a passage is cut.
      for (let i = 0; i < piece.length; i += PASSAGE_CHARS) {
        const part = piece.slice(i, i + PASSAGE_CHARS);
        if (part.length < PASSAGE_CHARS) current = current ? `${current}\n\n${part}` : part;
        else {
          if (current) out.push({ page: p.n, text: current });
          current = "";
          out.push({ page: p.n, text: part });
        }
      }
    }
    if (current) out.push({ page: p.n, text: current });
  }
  return out;
}

/**
 * Index one file from its pages, replacing what was indexed before. Returns
 * the number of passages; 0 means the file was marked not searchable, or
 * "needs text recognition" when it has scanned pages and nothing else.
 * `scanned` lists pages with no text layer (extract-text.ts).
 */
export async function indexDocument(db: Queryable, documentId: string, pages: Page[], embed: Embed, scanned: number[] = []): Promise<number> {
  const { rows } = await db.query<{
    project_id: string;
    org_id: string;
    version: number;
    visibility: string;
    uploaded_by: string;
    ai_indexable: boolean;
    state: string;
  }>(`SELECT project_id, org_id, version, visibility, uploaded_by, ai_indexable, state FROM documents WHERE id = $1`, [
    documentId,
  ]);
  const doc = rows[0];
  if (!doc || !doc.ai_indexable || doc.state === "archived") return 0;
  await db.query(`DELETE FROM ai_chunks WHERE source_type = 'document' AND source_id = $1`, [documentId]);

  const parts = passages(pages);
  if (!parts.length) {
    await db.query(`UPDATE documents SET text_status = $2, ocr_pages = $3 WHERE id = $1`, [
      documentId,
      scanned.length ? "needs_ocr" : "not_searchable",
      scanned,
    ]);
    return 0;
  }
  const vectors = await embed(parts.map((p) => p.text));
  if (vectors.length !== parts.length) throw new Error("the embedding service returned the wrong number of vectors");
  for (const [i, p] of parts.entries()) {
    await db.query(
      `INSERT INTO ai_chunks (project_id, org_id, source_type, source_id, source_version, visibility, owner_user_id,
                              chunk_index, page, lang, content, embedding)
       VALUES ($1, $2, 'document', $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        doc.project_id,
        doc.org_id,
        documentId,
        doc.version,
        doc.visibility,
        doc.visibility === "user_private" ? doc.uploaded_by : null,
        i,
        p.page,
        detectLang(p.text),
        p.text,
        `[${vectors[i]!.join(",")}]`,
      ],
    );
  }
  await db.query(`UPDATE documents SET text_status = 'searchable', ocr_pages = $2 WHERE id = $1`, [documentId, scanned]);
  return parts.length;
}

// --------------------------------------------------------- the plan's records

const EMBED_BATCH = 32;

/** One passage per record: what it says, never its status (that is read live when it's found). */
export function recordText(r: { title: string; parts: (string | null)[] }): string {
  return [r.title, ...r.parts]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, PASSAGE_CHARS);
}

/**
 * Index recommendations and actions that have no passage yet: new ones, and
 * ones whose passage a change dropped (baseline: Record passages).
 * Each passage takes its recommendation's label; who may read it is decided
 * by the record's own row-level security. Returns how many were indexed.
 */
export async function indexRecords(db: Queryable, embed: Embed, limit = 200): Promise<number> {
  const { rows } = await db.query<{
    type: "recommendation" | "action";
    id: string;
    project_id: string;
    org_id: string;
    visibility: string;
    owner: string | null;
    title: string;
    parts: (string | null)[];
  }>(
    `SELECT * FROM (
       SELECT 'recommendation' AS type, r.id, r.project_id, r.org_id, r.visibility::text AS visibility,
              CASE WHEN r.visibility = 'user_private' THEN r.created_by END AS owner, r.title,
              ARRAY[r.rationale, r.target_outcome, r.required_evidence] AS parts, r.created_at
       FROM recommendations r
       WHERE NOT EXISTS (SELECT 1 FROM ai_chunks c WHERE c.source_type = 'recommendation' AND c.source_id = r.id)
       UNION ALL
       SELECT 'action', a.id, a.project_id, a.org_id, r.visibility::text,
              CASE WHEN r.visibility = 'user_private' THEN r.created_by END, a.title,
              ARRAY[a.description, r.title], a.created_at
       FROM actions a JOIN recommendations r ON r.id = a.recommendation_id
       WHERE NOT EXISTS (SELECT 1 FROM ai_chunks c WHERE c.source_type = 'action' AND c.source_id = a.id)
     ) todo ORDER BY created_at LIMIT $1`,
    [limit],
  );
  // A few at a time, so one call never holds the embedding model for long.
  for (let start = 0; start < rows.length; start += EMBED_BATCH) {
    const batch = rows.slice(start, start + EMBED_BATCH);
    const texts = batch.map((r) => recordText(r));
    const vectors = await embed(texts);
    if (vectors.length !== batch.length) throw new Error("the embedding service returned the wrong number of vectors");
    for (const [i, r] of batch.entries()) {
      await db.query(
        `INSERT INTO ai_chunks (project_id, org_id, source_type, source_id, visibility, owner_user_id, chunk_index, lang, content, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9)
         ON CONFLICT (source_type, source_id) WHERE source_type IN ('recommendation', 'action') DO NOTHING`,
        [r.project_id, r.org_id, r.type, r.id, r.visibility, r.owner, detectLang(texts[i]!), texts[i], `[${vectors[i]!.join(",")}]`],
      );
    }
  }
  return rows.length;
}
