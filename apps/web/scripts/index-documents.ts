// Index files for the assistant: every file with the AI flag on, scanned,
// and not indexed yet; then the plan's recommendations and actions. Runs as
// the schema owner.
// Usage: npm run job:index-documents
//
// Text, PDF, Word, PowerPoint and Excel files are read (src/jobs/extract-text.ts).
// Scanned pages and images have no text layer: they are listed for text
// recognition later. A file that can't be read is marked not searchable; if
// pdftotext is missing, PDFs wait for the next round.
//
// Personal numbers are tagged in what is indexed and counted per file
// (section 7 item 6). Files the assistant may not read yet are read here too,
// only to count them, so the switch can warn before someone turns it on: the
// counts are kept, nothing of the text, and nothing leaves the server.
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { ExtractorMissingError, extractText } from "../src/jobs/extract-text";
import { countDocumentNumbers, indexDocument, indexRecords, type Embed } from "../src/jobs/index-documents";

const need = (k: string) =>
  process.env[k] ??
  (() => {
    throw new Error(`${k} is not set`);
  })();
const pool = new Pool({ connectionString: need("DATABASE_OWNER_URL"), max: 1 });
const s3 = new S3Client({
  endpoint: need("S3_ENDPOINT"),
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: need("S3_ACCESS_KEY"), secretAccessKey: need("S3_SECRET_KEY") },
});
const embed: Embed = async (texts) => {
  const res = await fetch(new URL("/v1/embed", need("AI_SERVICE_URL")), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${need("AI_SERVICE_TOKEN")}` },
    body: JSON.stringify({ texts }),
  });
  if (!res.ok) throw new Error(`embedding failed: ${res.status}`);
  return ((await res.json()) as { vectors: number[][] }).vectors;
};

const { rows } = await pool.query<{ id: string; storage_key: string; content_type: string; index: boolean }>(
  `(SELECT id, storage_key, content_type, true AS index, created_at FROM documents
    WHERE ai_indexable AND state <> 'archived' AND text_status = 'pending' AND scan_status IN ('clean', 'skipped')
    ORDER BY created_at LIMIT 100)
   UNION ALL
   -- Counted only: the assistant may not read these (or did before the counts were kept).
   (SELECT id, storage_key, content_type, false, created_at FROM documents
    WHERE number_counts IS NULL AND NOT (ai_indexable AND text_status = 'pending')
      AND state <> 'archived' AND scan_status IN ('clean', 'skipped')
    ORDER BY created_at LIMIT 100)`,
);
const done = { searchable: 0, notSearchable: 0, needsOcr: 0, waiting: 0, counted: 0 };
for (const d of rows) {
  let bytes: Uint8Array;
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: need("S3_BUCKET"), Key: d.storage_key }));
    bytes = (await obj.Body?.transformToByteArray()) ?? new Uint8Array();
  } catch (err) {
    // Storage is down or slow: try again next round, never mark the file unreadable.
    console.error(`index: ${d.id} could not be fetched: ${(err as Error).message}`);
    done.waiting++;
    continue;
  }
  let extracted;
  try {
    extracted = await extractText(d.content_type, bytes);
  } catch (err) {
    if (err instanceof ExtractorMissingError) {
      done.waiting++;
      continue;
    }
    console.error(`index: ${d.id} could not be read: ${(err as Error).message}`);
    extracted = { pages: [], scanned: [] };
  }
  if (!d.index) {
    await countDocumentNumbers(pool, d.id, extracted.pages);
    done.counted++;
    continue;
  }
  const n = await indexDocument(pool, d.id, extracted.pages, embed, extracted.scanned);
  if (n) done.searchable++;
  else if (extracted.scanned.length) done.needsOcr++;
  else done.notSearchable++;
}
// Recommendations and actions, new or changed since (baseline: Record passages).
const records = await indexRecords(pool, embed);
await pool.end();
console.log(
  `indexed ${done.searchable}, not searchable ${done.notSearchable}, scanned (needs text recognition) ${done.needsOcr}, waiting ${done.waiting}; numbers counted in ${done.counted} more; records ${records}`,
);
