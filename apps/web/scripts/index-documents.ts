// Index files for the assistant: every file with the AI flag on, scanned,
// and not indexed yet; then the plan's recommendations and actions. Runs as
// the schema owner.
// Usage: npm run job:index-documents
//
// Text files are read here (a form feed starts a page). Images have no text
// layer and are marked not searchable. PDF and Office files wait for the
// extractor in the AI service and stay pending.
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { indexDocument, indexRecords, pagesFromText, type Embed } from "../src/jobs/index-documents";

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
const done = { searchable: 0, notSearchable: 0, waiting: 0 };
for (const d of rows) {
  if (d.content_type.startsWith("image/")) {
    await indexDocument(pool, d.id, [], embed);
    done.notSearchable++;
    continue;
  }
  if (!d.content_type.startsWith("text/")) {
    done.waiting++;
    continue;
  }
  const obj = await s3.send(new GetObjectCommand({ Bucket: need("S3_BUCKET"), Key: d.storage_key }));
  const n = await indexDocument(pool, d.id, pagesFromText((await obj.Body?.transformToString("utf-8")) ?? ""), embed);
  if (n) done.searchable++;
  else done.notSearchable++;
}
// Recommendations and actions, new or changed since (drizzle/0052_record_passages.sql).
const records = await indexRecords(pool, embed);
await pool.end();
console.log(
  `indexed ${done.searchable}, not searchable ${done.notSearchable}, waiting for an extractor ${done.waiting}; records ${records}`,
);
