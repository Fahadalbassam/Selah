import "server-only";
import { timingSafeEqual } from "node:crypto";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { sql } from "drizzle-orm";
import { asAnonymous } from "@/db/client";
import { env } from "@/env";
import { pingClamd } from "@/lib/clamd";
import { statusOf, type Check } from "@/lib/ops";
import { s3 } from "./storage";

// Readiness (R4): can this web app serve? The database, the bucket and the
// virus scanner are critical (without them sign-in or uploads fail); the PDF
// renderer and the AI service only switch features off. Each check is a
// ping, reads no data, and gives up after three seconds.

const TIMEOUT_MS = 3000;

async function timed(
  name: string,
  critical: boolean,
  probe: () => Promise<boolean | "off">,
): Promise<Check | null> {
  const started = Date.now();
  try {
    const ok = await Promise.race([
      probe(),
      new Promise<boolean>((_, fail) =>
        setTimeout(() => fail(new Error("timed out")), TIMEOUT_MS),
      ),
    ]);
    if (ok === "off") return null;
    return {
      name,
      critical,
      ok,
      ms: Date.now() - started,
      ...(ok ? {} : { error: "no answer" }),
    };
  } catch (e) {
    return {
      name,
      critical,
      ok: false,
      ms: Date.now() - started,
      error: (e instanceof Error ? e.message : "failed").slice(0, 120),
    };
  }
}

const httpOk = async (url: string) =>
  (
    await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    })
  ).ok;

async function runChecks(): Promise<Check[]> {
  const e = env();
  const checks = await Promise.all([
    timed("database", true, async () => {
      await asAnonymous((tx) => tx.execute(sql`select 1`));
      return true;
    }),
    timed("storage", true, async () => {
      await s3().send(new HeadBucketCommand({ Bucket: e.S3_BUCKET }));
      return true;
    }),
    // Off only where uploads may skip scanning (development).
    timed("scanner", true, async () =>
      e.CLAMD_HOST
        ? pingClamd(e.CLAMD_HOST, e.CLAMD_PORT, TIMEOUT_MS)
        : e.SCAN_REQUIRED === "false"
          ? "off"
          : false,
    ),
    timed("pdf", false, async () =>
      e.PDF_SERVICE_URL
        ? httpOk(new URL("/health", e.PDF_SERVICE_URL).href)
        : "off",
    ),
    timed("ai", false, async () =>
      httpOk(new URL("/health", e.AI_SERVICE_URL).href),
    ),
  ]);
  return checks.filter((c): c is Check => c !== null);
}

// The probe is public, so its result is reused for a few seconds: hitting it
// in a loop can't turn into load on the database or the scanner.
const CACHE_MS = 10_000;
let cached: { at: number; checks: Promise<Check[]> } | null = null;

export async function readiness() {
  if (!cached || Date.now() - cached.at > CACHE_MS)
    cached = { at: Date.now(), checks: runChecks() };
  const checks = await cached.checks;
  return { status: statusOf(checks), checks };
}

/** Whether a request carries OPS_TOKEN, which shows each check's details. */
export function hasOpsToken(authorization: string | null): boolean {
  const token = env().OPS_TOKEN;
  if (!token || !authorization?.startsWith("Bearer ")) return false;
  const given = Buffer.from(authorization.slice(7));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}
