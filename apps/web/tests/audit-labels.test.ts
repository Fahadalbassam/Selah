// Every action the app writes to the audit log has a label on the audit-log
// screen in both languages, and falls in one of the filter's areas (R2).
// Denials are logged under the permission's name, so every permission has an
// area too.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { POLICY } from "@/authz/policy";
import { auditActionKey, auditAreaOf, csvCell } from "@/lib/audit";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|sql)$/.test(f) ? [p] : [];
  });

/** Action names written by the app (`action: "x.y"`) and by SQL functions (INSERT INTO audit_log ... VALUES (..., 'x.y', ...)). */
function writtenActions(): string[] {
  const out = new Set<string>();
  for (const f of [...files(`${root}src`), ...files(`${root}drizzle`)]) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/action: "([a-z_]+(?:\.[a-z_]+)+)"/g)) out.add(m[1]!);
    // Sign-in events are chosen in expressions, so every "auth.*" name in the auth module counts.
    if (f.replaceAll("\\", "/").endsWith("src/auth/auth.ts")) for (const m of text.matchAll(/"(auth(?:\.[a-z_]+)+)"/g)) out.add(m[1]!);
    for (const m of text.matchAll(/INSERT INTO audit_log[^;]*;/g)) {
      for (const a of m[0].matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)) out.add(a[1]!);
    }
  }
  return [...out].sort();
}

const actions = (messages: unknown) => (messages as { audit?: { actions?: Record<string, string> } }).audit?.actions ?? {};

describe("audit-log labels", () => {
  const written = writtenActions();

  it("finds the actions", () => {
    expect(written).toContain("document.download");
    expect(written).toContain("auth.sign_in");
    expect(written).toContain("membership.deactivate");
  });

  it("labels every written action in Arabic and English", () => {
    expect(written.filter((a) => !actions(ar)[auditActionKey(a)])).toEqual([]);
    expect(written.filter((a) => !actions(en)[auditActionKey(a)])).toEqual([]);
  });

  it("puts every written action and every permission in an area", () => {
    expect(written.filter((a) => auditAreaOf(a) === null)).toEqual([]);
    expect(Object.keys(POLICY).filter((p) => auditAreaOf(p) === null)).toEqual([]);
  });

  it("CSV cells can't run as formulas", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("-1")).toBe(`"'-1"`);
    expect(csvCell('say "hi"')).toBe(`"say ""hi"""`);
    expect(csvCell(null)).toBe(`""`);
  });
});
