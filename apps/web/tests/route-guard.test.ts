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
    for (const [, method, rest] of exported) {
      expect(rest, `${method} must be "= route(...)"`).toMatch(/^\s*=\s*route\(/);
    }
    // No direct database access in route files.
    expect(source).not.toMatch(/@\/db\//);
  });
});
