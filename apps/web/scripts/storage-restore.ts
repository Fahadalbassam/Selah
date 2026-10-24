// Put backed-up files back into the bucket (R3). Usage:
//   npm run restore:storage -- <folder>
// Uploads every file listed in <folder>/objects.tsv that the bucket doesn't
// hold, after checking its sha256 against the list. Never overwrites or
// deletes what is in the bucket.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const { S3_ENDPOINT, S3_REGION = "us-east-1", S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;
if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) throw new Error("S3_* settings are missing");
const source = process.argv[2];
if (!source) throw new Error("usage: storage-restore <folder>");
const root = resolve(source);

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
});

const list = (await readFile(resolve(root, "objects.tsv"), "utf8")).split("\n").filter(Boolean);
let put = 0;
for (const line of list) {
  const [key, , hash] = line.split("\t") as [string, string, string];
  const path = resolve(root, key);
  if (!path.startsWith(root + sep)) throw new Error(`refusing key outside the folder: ${key}`);
  const there = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key })).catch(() => null);
  if (there) continue;
  const bytes = await readFile(path);
  if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error(`${key} doesn't match its checksum`);
  await s3.send(
    new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: bytes, ChecksumSHA256: Buffer.from(hash, "hex").toString("base64") }),
  );
  put++;
}
console.log(`storage restore: ${list.length} files listed, ${put} put back`);
