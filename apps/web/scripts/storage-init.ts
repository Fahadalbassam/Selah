// Create the private evidence bucket if it does not exist. Usage: npm run storage:init
import { CreateBucketCommand, HeadBucketCommand, PutPublicAccessBlockCommand, S3Client } from "@aws-sdk/client-s3";

const { S3_ENDPOINT, S3_REGION = "us-east-1", S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;
if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) throw new Error("S3_* settings are missing");

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
});

try {
  await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
  console.log(`bucket ${S3_BUCKET} exists`);
} catch {
  await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
  console.log(`bucket ${S3_BUCKET} created`);
}

// Private bucket: objects are only reachable through short-lived signed links.
await s3
  .send(
    new PutPublicAccessBlockCommand({
      Bucket: S3_BUCKET,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    }),
  )
  .catch(() => console.log("storage does not support public access blocks; bucket is private by default"));
