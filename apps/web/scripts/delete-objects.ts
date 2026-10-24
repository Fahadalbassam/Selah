// Remove stored files whose rows were deleted (a discarded prospect, later a
// withdrawn upload): the documents trigger queues their keys in
// storage_deletions (baseline: Prospects, 0009). Run as the schema owner.
// Usage: npm run job:delete-objects
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";

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

// A key a file still uses is never removed.
const { rows } = await pool.query<{ storage_key: string }>(
  `SELECT q.storage_key FROM storage_deletions q
   WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.storage_key = q.storage_key)
   ORDER BY q.created_at LIMIT 500`,
);
let removed = 0;
for (const { storage_key } of rows) {
  try {
    // S3 treats a missing key as deleted, so a retry is harmless.
    await s3.send(new DeleteObjectCommand({ Bucket: need("S3_BUCKET"), Key: storage_key }));
    await pool.query(`DELETE FROM storage_deletions WHERE storage_key = $1`, [storage_key]);
    removed++;
  } catch (e) {
    console.error(`delete-objects: ${storage_key} stays queued: ${(e as Error).message}`);
  }
}
await pool.query(`DELETE FROM storage_deletions q WHERE EXISTS (SELECT 1 FROM documents d WHERE d.storage_key = q.storage_key)`);
await pool.end();
console.log(`stored files removed: ${removed}`);
