import "server-only";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/env";

let client: S3Client | undefined;
let publicClient: S3Client | undefined;

function makeClient(endpoint: string): S3Client {
  const e = env();
  return new S3Client({
    endpoint,
    region: e.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: e.S3_ACCESS_KEY, secretAccessKey: e.S3_SECRET_KEY },
  });
}

/** For server-side calls (upload, delete). */
export function s3(): S3Client {
  client ??= makeClient(env().S3_ENDPOINT);
  return client;
}

/** For signing links the browser will open. Signing makes no network call. */
function s3Public(): S3Client {
  const e = env();
  publicClient ??= makeClient(e.S3_PUBLIC_ENDPOINT ?? e.S3_ENDPOINT);
  return publicClient;
}

/** Download links live for one minute and are issued only after authorize(). */
export const DOWNLOAD_TTL_SECONDS = 60;

export async function signedDownloadUrl(storageKey: string, fileName: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env().S3_BUCKET,
    Key: storageKey,
    ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  });
  return getSignedUrl(s3Public(), command, { expiresIn: DOWNLOAD_TTL_SECONDS });
}

/** Store a file under a random key. The key never contains the user's file name. */
export async function putObject(storageKey: string, body: Uint8Array, contentType: string, sha256Hex: string): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: env().S3_BUCKET,
      Key: storageKey,
      Body: body,
      ContentType: contentType,
      ChecksumSHA256: Buffer.from(sha256Hex, "hex").toString("base64"),
    }),
  );
}
