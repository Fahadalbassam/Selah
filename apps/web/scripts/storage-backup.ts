// Copy every stored file into a backup folder (R3). Usage:
//   npm run backup:storage -- <folder>
// Files are kept under their storage key, which is random and never changes,
// so a later run only fetches what is new. The folder gets objects.tsv (key,
// size, sha256) listing what the bucket holds now; ops/backup.sh keeps that
// list with the database dump, and ops/restore-drill.sh checks it.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const { S3_ENDPOINT, S3_REGION = "us-east-1", S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;
if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) throw new Error("S3_* settings are missing");
const target = process.argv[2];
if (!target) throw new Error("usage: storage-backup <folder>");
const root = resolve(target);

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
});

const sha256 = (path: string) =>
  new Promise<string>((ok, fail) => {
    const h = createHash("sha256");
    createReadStream(path)
      .on("data", (d) => h.update(d))
      .on("end", () => ok(h.digest("hex")))
      .on("error", fail);
  });

const rows: string[] = [];
let fetched = 0;
let token: string | undefined;
do {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, ContinuationToken: token }));
  for (const o of page.Contents ?? []) {
    const key = o.Key!;
    const path = resolve(root, key);
    // A key can't climb out of the folder (keys are made by the app, but still).
    if (!path.startsWith(root + sep)) throw new Error(`refusing key outside the folder: ${key}`);
    const have = await stat(path).catch(() => null);
    if (!have || have.size !== o.Size) {
      await mkdir(dirname(path), { recursive: true });
      const body = (await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }))).Body as Readable;
      await pipeline(body, createWriteStream(`${path}.part`));
      await rename(`${path}.part`, path);
      fetched++;
    }
    rows.push(`${key}\t${o.Size}\t${await sha256(path)}`);
  }
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);

await writeFile(join(root, "objects.tsv"), rows.sort().join("\n") + (rows.length ? "\n" : ""));
console.log(`storage backup: ${rows.length} files, ${fetched} fetched`);
