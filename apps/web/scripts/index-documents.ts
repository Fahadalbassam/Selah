// Index files for the assistant: every file with the AI flag on, scanned,
// and not indexed yet; then the plan's recommendations and actions. Runs as
// the schema owner.
// Usage: npm run job:index-documents
//
// Text, PDF, Word, PowerPoint and Excel files are read (src/jobs/extract-text.ts).
// Scanned pages and images have no text layer: they are listed for text
// recognition later. A file that can't be read is marked not searchable; if
// pdftotext is missing, PDFs wait for the next round.
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { ExtractorMissingError, extractText } from "../src/jobs/extract-text";
import { indexDocument, indexRecords, type Embed } from "../src/jobs/index-documents";

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

const { rows } = await pool.query<{ id: string; storage_key: string; content_type: string }>(
  `SELECT id, storage_key, content_type FROM documents
   WHERE ai_indexable AND state <> 'archived' AND text_status = 'pending' AND scan_status IN ('clean', 'skipped')
   ORDER BY created_at LIMIT 100`,
);
const done = { searchable: 0, notSearchable: 0, needsOcr: 0, waiting: 0 };
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
  const n = await indexDocument(pool, d.id, extracted.pages, embed, extracted.scanned);
  if (n) done.searchable++;
  else if (extracted.scanned.length) done.needsOcr++;
  else done.notSearchable++;
}
// Recommendations and actions, new or changed since (baseline: Record passages).
const records = await indexRecords(pool, embed);
await pool.end();
console.log(
  `indexed ${done.searchable}, not searchable ${done.notSearchable}, scanned (needs text recognition) ${done.needsOcr}, waiting ${done.waiting}; records ${records}`,
);
