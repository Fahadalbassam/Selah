import { toNextJsHandler } from "better-auth/next-js";
import type { NextRequest } from "next/server";
import { auth } from "@/auth/auth";

// Better Auth's own endpoints (sign-in, sign-out, 2FA). It does its own
// origin checks and rate limiting. Sign-up is disabled in auth.ts.
export const GET = (req: NextRequest) => toNextJsHandler(auth()).GET(req);
export const POST = (req: NextRequest) => toNextJsHandler(auth()).POST(req);
