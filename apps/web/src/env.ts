import { z } from "zod";

// Server-side configuration, validated once. Secrets come from the
// environment (.env.local in development), never from Git.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),
  // Runtime role: subject to row-level security.
  DATABASE_APP_URL: z.string().min(1),
  // Better Auth's role: auth tables only.
  DATABASE_AUTH_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  S3_ENDPOINT: z.url(),
  // Host the browser uses to fetch signed download links, if different
  // (e.g. http://localhost:9000 when the app talks to http://storage:9000).
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  AI_SERVICE_URL: z.url(),
  AI_SERVICE_TOKEN: z.string().min(32),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}
