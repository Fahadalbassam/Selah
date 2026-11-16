#!/usr/bin/env node
// Second pass of the page audit: pages the link-following capture could not
// find (they sit in collapsed sidebar groups, the user menu or floating
// cards), named per account. Reuses the sign-ins of the first pass.
//   node scripts/review/capture-extra.mjs --base http://localhost:3010 --from ../../docs/review/shots/phase1 --out ../../docs/review/shots/phase1-extra
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", "http://localhost:3000");
const FROM = resolve(arg("from", "review-shots"));
const OUT = resolve(arg("out", "review-shots-extra"));
const NUKHBA = arg("nukhba", "");
const PROJECT = arg("project", "");
const HERE = dirname(fileURLToPath(import.meta.url));

mkdirSync(join(OUT, ".auth"), { recursive: true });
if (existsSync(join(FROM, ".auth"))) cpSync(join(FROM, ".auth"), join(OUT, ".auth"), { recursive: true });

const FIRM = ["/team", "/team/expertise", "/assistant", "/assessments/compare", "/leaving", ...(NUKHBA ? [`/indicators/import?client=${NUKHBA}`, `/clients/${NUKHBA}/departments`, `/clients/${NUKHBA}/people`] : [])];
const CLIENT = ["/assistant", "/indicators/import", "/indicators/data", "/group", "/leaving", "/audit", "/team", "/departments"];
const JOBS = [
  ["admin@mizan.test", [...FIRM, "/settings", ...(PROJECT ? [`/projects/${PROJECT}`] : [])]],
  ["lead@mizan.test", [...FIRM, "/settings", "/audit"]],
  ["consultant@mizan.test", [...FIRM, "/settings", "/audit"]],
  ["observer@mizan.test", FIRM],
  ["lead2@mizan.test", FIRM],
  ["deputy@mizan.test", FIRM],
  ["admin@nukhba.test", CLIENT],
  ["sponsor@nukhba.test", CLIENT],
  ["manager@nukhba.test", CLIENT],
  ["owner@nukhba.test", CLIENT],
  ["finance@nukhba.test", ["/assistant", "/team"]],
  ["admin@rawdah.test", CLIENT],
  ["manager@rawdah.test", CLIENT],
  ["owner@rawdah.test", ["/assistant", "/team", "/leaving"]],
];

const queue = [...JOBS];
let failed = 0;
const next = () => {
  const job = queue.shift();
  if (!job) return Promise.resolve();
  const [account, start] = job;
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(HERE, "capture.mjs"), "--account", account, "--base", BASE, "--out", OUT, "--start", start.join(","), "--no-follow", "--cards", "--limit", "60"], { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code) failed++;
      console.log(`[capture-extra] ${account} ${code ? "FAILED" : "done"}`);
      done();
    });
  }).then(next);
};
await Promise.all(Array.from({ length: 4 }, next));
console.log(`[capture-extra] finished, ${failed} failed`);
process.exit(failed ? 1 : 0);
