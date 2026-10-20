import "server-only";
import { env } from "@/env";
import { scanWithClamd } from "@/lib/clamd";
import { BadRequestError, UnavailableError } from "@/server/errors";

/**
 * Scan an upload before it is stored (ASVS V5). Infected files are refused;
 * if the scanner is down the upload is refused too (fail closed). Only with
 * SCAN_REQUIRED=false and no scanner configured (local development) is a
 * file accepted unscanned, and the caller records that.
 */
export async function scanUpload(bytes: Uint8Array): Promise<{ scanned: boolean }> {
  const e = env();
  if (!e.CLAMD_HOST) {
    if (e.SCAN_REQUIRED === "false") return { scanned: false };
    throw new UnavailableError("virus scanner is not configured");
  }
  let result;
  try {
    result = await scanWithClamd(bytes, e.CLAMD_HOST, e.CLAMD_PORT);
  } catch (err) {
    console.error("[scan] clamd failed", err);
    throw new UnavailableError("virus scanner is unavailable");
  }
  if (!result.clean) throw new BadRequestError(`file rejected: infected`);
  return { scanned: true };
}
