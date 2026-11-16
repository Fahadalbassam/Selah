#!/usr/bin/env node
// Runs capture.mjs for every walkthrough account, a few at a time.
//   node scripts/review/capture-all.mjs --base http://localhost:3010 --out ../../docs/review/shots/phase1 [--parallel 4] [--only a@x,b@y]
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", "http://localhost:3000");
const OUT = arg("out", "review-shots");
const PARALLEL = Number(arg("parallel", "4"));
const ONLY = arg("only", "");
const HERE = dirname(fileURLToPath(import.meta.url));

// [account, most screens to capture, extra flags]
const ACCOUNTS = [
  ["admin@mizan.test", 260],
  ["lead@mizan.test", 220],
  ["deputy@mizan.test", 220],
  ["consultant@mizan.test", 160],
  ["observer@mizan.test", 160],
  ["lead2@mizan.test", 200],
  ["admin@nukhba.test", 180],
  ["sponsor@nukhba.test", 160],
  ["manager@nukhba.test", 160],
  ["owner@nukhba.test", 80],
  ["finance@nukhba.test", 80],
  ["admin@rawdah.test", 140],
  ["manager@rawdah.test", 120],
  ["owner@rawdah.test", 80, ["--accept-consent"]],
].filter(([a]) => !ONLY || ONLY.split(",").includes(a));

const queue = [...ACCOUNTS];
let failed = 0;
const next = () => {
  const job = queue.shift();
  if (!job) return Promise.resolve();
  const [account, limit, extra = []] = job;
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(HERE, "capture.mjs"), "--account", account, "--base", BASE, "--out", OUT, "--limit", String(limit), ...extra], { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code) failed++;
      console.log(`[capture-all] ${account} ${code ? "FAILED" : "done"} in ${Math.round((Date.now() - started) / 1000)} s`);
      done();
    });
  }).then(next);
};
await Promise.all(Array.from({ length: PARALLEL }, next));
console.log(`[capture-all] finished, ${failed} failed`);
process.exit(failed ? 1 : 0);
