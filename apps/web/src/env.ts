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
  // ClamAV daemon for upload scanning (host:port). Without it, uploads are
  // refused, unless SCAN_REQUIRED is "false" (local development only: files
  // are then stored as "skipped" and refused for download once it is "true").
  CLAMD_HOST: z.string().optional(),
  CLAMD_PORT: z.coerce.number().int().default(3310),
  SCAN_REQUIRED: z.enum(["true", "false"]).default("true"),
  // Two-factor sign-in for firm admins, consultants and client admins.
  // "false" is for local development only and refused in production.
  TWO_FACTOR_REQUIRED: z.enum(["true", "false"]).default("true"),
  // The PDF renderer (Gotenberg, its own container). Without it, PDF exports
  // are refused and the export buttons say the service is unavailable.
  PDF_SERVICE_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
  AI_SERVICE_URL: z.url(),
  AI_SERVICE_TOKEN: z.string().min(32),
  // Which model the AI service calls (its own setting, repeated here), and
  // whether names are masked before text goes to it. "auto" masks whenever
  // the model is hosted outside our server (docs/assistant.md).
  LLM_PROVIDER: z.enum(["ollama", "openai_compat"]).default("ollama"),
  AI_MASKING: z.enum(["auto", "on", "off"]).default("auto"),
  // The compose profiles in use (R5): "direct" or "tunnel" says how traffic
  // reaches the site, shown on the sub-processor list and the security page.
  SELAH_EDGE: z.string().optional(),
  // Shows the details of /api/ready to ops/readiness.sh and the alert job
  // (docs/operations.md). Without it, the probe answers only its status.
  OPS_TOKEN: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(32).optional()),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.parse(process.env);
    // Uploads must never be stored unscanned in production.
    if (parsed.NODE_ENV === "production" && parsed.SCAN_REQUIRED === "false") {
      throw new Error("SCAN_REQUIRED=false is not allowed in production");
    }
    if (parsed.NODE_ENV === "production" && parsed.TWO_FACTOR_REQUIRED === "false") {
      throw new Error("TWO_FACTOR_REQUIRED=false is not allowed in production");
    }
    cached = parsed;
  }
  return cached;
}
