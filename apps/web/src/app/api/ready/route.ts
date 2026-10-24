import type { NextRequest } from "next/server";
import { hasOpsToken, readiness } from "@/services/readiness";

// Readiness probe (R4): 200 when the site can serve, 503 when a critical
// dependency is down. The public sees only the status; with OPS_TOKEN as a
// bearer token the answer lists each check (for ops/readiness.sh and the
// alert job). Reads no data.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { status, checks } = await readiness();
  const body = hasOpsToken(req.headers.get("authorization"))
    ? { status, checks }
    : { status };
  return Response.json(body, {
    status: status === "down" ? 503 : 200,
    headers: { "cache-control": "no-store" },
  });
}
