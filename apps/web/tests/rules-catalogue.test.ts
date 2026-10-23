// docs/rules.md lists every rule the database enforces. This keeps it honest:
// a trigger function or hand-written check constraint added to a migration
// without a line in the catalogue fails the build, and so does a line naming a
// file that is not there.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url).pathname;
const catalogue = readFileSync(new URL("../../../docs/rules.md", import.meta.url), "utf8");
const migrations = readdirSync(`${root}drizzle`)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(`${root}drizzle/${f}`, "utf8"))
  .join("\n");

/** Names inside backticks in the catalogue, without a trailing "()". */
const names = (text: string) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.replace(/\(\)$/, ""));
const named = new Set(names(catalogue));

/** What the tables' "Database" columns name. */
function databaseColumn(): string[] {
  const out: string[] = [];
  let column = -1;
  for (const line of catalogue.split("\n")) {
    if (!line.startsWith("|")) {
      column = -1;
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (column < 0) column = cells.indexOf("Database");
    else if (!/^-+$/.test(cells[0] ?? "")) out.push(...names(cells[column] ?? ""));
  }
  return out;
}

describe("rules catalogue", () => {
  it("lists every trigger function", () => {
    const functions = [...migrations.matchAll(/CREATE (?:OR REPLACE )?FUNCTION (\w+)\(\) RETURNS trigger/g)].map((m) => m[1]!);
    expect(functions.length).toBeGreaterThan(0);
    expect(functions.filter((f) => !named.has(f))).toEqual([]);
  });

  it("lists every hand-written check constraint as table.name", () => {
    const constraints = [...migrations.matchAll(/ALTER TABLE "?(\w+)"? ADD CONSTRAINT (\w+)\s+CHECK/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(constraints.length).toBeGreaterThan(0);
    expect(constraints.filter((c) => !named.has(c))).toEqual([]);
  });

  it("names only files that exist", () => {
    const paths = [...named].filter((n) => /^(src|tests|e2e|scripts)\/[^\s]+\.(ts|tsx)$/.test(n));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((p) => !existsSync(`${root}${p}`))).toEqual([]);
  });

  it("names only database objects that exist", () => {
    const objects = databaseColumn().filter((n) => /^[a-z_]+(\.[a-z_]+)?$/.test(n));
    expect(objects.length).toBeGreaterThan(0);
    const exists = (o: string) =>
      o.includes(".")
        ? new RegExp(`CONSTRAINT "?${o.split(".")[1]}"?\\s`).test(migrations)
        : new RegExp(`FUNCTION ${o}\\(`).test(migrations);
    expect(objects.filter((o) => !exists(o))).toEqual([]);
  });
});
