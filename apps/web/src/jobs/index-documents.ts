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
 * the number of passages; 0 means the file was marked not searchable.
 */
export async function indexDocument(db: Queryable, documentId: string, pages: Page[], embed: Embed): Promise<number> {
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
    await db.query(`UPDATE documents SET text_status = 'not_searchable' WHERE id = $1`, [documentId]);
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
  await db.query(`UPDATE documents SET text_status = 'searchable' WHERE id = $1`, [documentId]);
  return parts.length;
}
