#!/usr/bin/env node
// The CI security check on the app's runtime packages (docs/security.md, V13).
//
// It runs `npm audit --omit=dev` and fails on any high or critical advisory,
// except one listed in audit-allowlist.json with its reason and a review-by
// date. An entry is for an advisory that has no fixed version yet and whose
// vulnerable code Selah does not run. It stops working on its review-by date,
// so an exception cannot be forgotten: after that date the check fails again
// until someone looks, and either removes the entry (a fix exists) or renews
// it with a new reason.
//
//   node scripts/npm-audit.mjs

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ALLOWLIST = join(HERE, "..", "audit-allowlist.json");
const BLOCKING = new Set(["high", "critical"]);

const today = new Date().toISOString().slice(0, 10);
const allow = JSON.parse(readFileSync(ALLOWLIST, "utf8"));

let failed = false;
const fail = (msg) => {
  console.error(`npm-audit: ${msg}`);
  failed = true;
};

for (const entry of allow) {
  for (const key of ["id", "package", "reason", "added", "reviewBy"]) {
    if (!entry[key]) fail(`audit-allowlist.json: an entry has no "${key}"`);
  }
  if (entry.reviewBy && entry.reviewBy < today) {
    fail(`${entry.id} (${entry.package}) was allowed until ${entry.reviewBy}. Check whether a fixed version exists; remove the entry, or renew it with a new reason and date.`);
  }
}

// npm audit exits non-zero when it finds anything; the report is on stdout either way.
const r = spawnSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", shell: process.platform === "win32" });
let report;
try {
  report = JSON.parse(r.stdout);
} catch {
  console.error(r.stderr || r.stdout);
  console.error("npm-audit: npm audit did not return a report");
  process.exit(1);
}

const found = new Map();
for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of v.via ?? []) {
    if (typeof via !== "object" || !BLOCKING.has(via.severity)) continue;
    const id = String(via.url ?? "").split("/").pop() || `${name}:${via.source}`;
    found.set(id, { id, package: via.name ?? name, severity: via.severity, title: via.title, url: via.url });
  }
}

const allowed = new Set(allow.filter((e) => !e.reviewBy || e.reviewBy >= today).map((e) => e.id));
for (const a of found.values()) {
  if (allowed.has(a.id)) {
    console.log(`npm-audit: allowed until its review date: ${a.id} ${a.package} (${a.severity}) ${a.title}`);
  } else {
    fail(`${a.severity}: ${a.package} ${a.title} ${a.url}`);
  }
}
for (const e of allow) {
  if (!found.has(e.id)) console.log(`npm-audit: ${e.id} (${e.package}) no longer reported; its allow-list entry can be removed.`);
}

if (failed) process.exit(1);
console.log(`npm-audit: no high or critical advisory outside the allow-list (${found.size} reported, all allowed).`);
