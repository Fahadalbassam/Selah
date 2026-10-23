import { NextResponse, type NextRequest } from "next/server";

// Content Security Policy with a fresh nonce on every page (ASVS V3.4). Only
// scripts carrying the nonce run: Next.js adds it to its own scripts, and
// 'strict-dynamic' lets those load the page's bundles. An injected inline
// script has no nonce and is blocked. Every page renders per request (the
// language comes from a cookie), so each one gets its own nonce. Styles still
// allow inline attributes, which the UI's components set and which can't
// carry a nonce. API responses get a stricter fixed policy in next.config.ts.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      // Link prefetches return data, not a page to run.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
