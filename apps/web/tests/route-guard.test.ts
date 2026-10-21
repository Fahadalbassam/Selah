import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Every API route must be built with route() from src/server/http.ts, which
// enforces session, CSRF, validation, RLS context and authorization. This
// test fails if someone adds a route that skips it.
const API_DIR = join(__dirname, "../src/app/api");

// Routes allowed to skip route(), with the reason.
const EXEMPT: Record<string, string> = {
  "auth/[...all]/route.ts": "Better Auth's own endpoints; handle their own sessions, origin checks and rate limits",
  "health/route.ts": "liveness probe; reads no data",
};

// Routes the public uses without signing in. They go through publicRoute(),
// which runs with no user, so RLS allows only what the database grants the
// public (the submit_inquiry() function and the service and sector lists).
const PUBLIC: Record<string, string> = {
  "inquiries/route.ts": "the public inquiry form",
  "intake/options/route.ts": "the inquiry form's choices",
  "invite/[token]/route.ts": "an invited person opening their link",
  "invite/[token]/accept/route.ts": "an invited person setting up their account",
  "email-change/confirm/route.ts": "a new address confirming an admin's change",
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === "route.ts" ? [path] : [];
  });
}

describe("API route guard", () => {
  const files = routeFiles(API_DIR);

  it("finds the routes", () => {
    expect(files.length).toBeGreaterThan(Object.keys(EXEMPT).length);
  });

  it.each(files.map((f) => relative(API_DIR, f)))("%s goes through route()", (file) => {
    if (file in EXEMPT) return;
    const source = readFileSync(join(API_DIR, file), "utf8");
    expect(source).toMatch(/from "@\/server\/http"/);
    const exported = [...source.matchAll(/export\s+(?:const|async function|function)\s+(GET|POST|PUT|PATCH|DELETE)\b(.*)/g)];
    expect(exported.length).toBeGreaterThan(0);
    const wrapper = file in PUBLIC ? "publicRoute" : "route";
    for (const [, method, rest] of exported) {
      expect(rest, `${method} must be "= ${wrapper}(...)"`).toMatch(new RegExp(`^\\s*=\\s*${wrapper}\\(`));
    }
    // No direct database access in route files.
    expect(source).not.toMatch(/@\/db\//);
  });
});
