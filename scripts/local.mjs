#!/usr/bin/env node
// One command to run Selah on this machine, and one to test it, without
// knowing the parts. Plain Node (no packages), so it runs the same from
// PowerShell, cmd and bash. Called from the root package.json:
//
//   npm run dev:local              the app with sample data on http://localhost:3000
//   npm run dev:local -- --full    the same, plus the virus scanner and the local AI
//   npm run walkthrough            the team walkthrough: one sign-in per role, three
//                                  cases, the assistant and PDF exports (docs/walkthrough.md)
//   npm run walkthrough -- --fresh the same, starting again from clean walkthrough data
//   (both open every page once before saying ready; --no-warm skips that)
//   npm run test:all               every test suite, end-to-end included
//   npm run test:all -- --quick    everything but the end-to-end suite
//   npm run stop:local             stop the containers (data is kept)
//   npm run reset:local            stop them and delete the local sample data
//
// The first run writes .env and apps/web/.env.local with fresh random
// secrets. Both are git-ignored and only ever hold local, sample-data values.

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "apps", "web");
const ROOT_ENV = join(ROOT, ".env");
const WEB_ENV = join(WEB, ".env.local");
const WIN = process.platform === "win32";
const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.test.yml"];
const APP_URL = "http://localhost:3000";

// The walkthrough's sign-ins (apps/web/scripts/walkthrough/seed.ts), all with
// WALKTHROUGH_PASSWORD from .env, or the default in docs/walkthrough.md.
const WALKTHROUGH_USERS = [
  ["admin@mizan.test", "firm admin (sees every client)"],
  ["lead@mizan.test", "lead consultant, Al-Nukhba"],
  ["deputy@mizan.test", "deputy lead, Al-Nukhba; lead of Al-Nukhba Real Estate"],
  ["consultant@mizan.test", "consultant on the Al-Nukhba board project"],
  ["observer@mizan.test", "observer (read-only) on the Al-Nukhba board project"],
  ["lead2@mizan.test", "lead consultant, Rawdah and Al-Waha"],
  ["admin@nukhba.test", "client admin, Al-Nukhba"],
  ["sponsor@nukhba.test", "client manager and project sponsor, Al-Nukhba"],
  ["manager@nukhba.test", "client manager and coordinator, Al-Nukhba"],
  ["owner@nukhba.test", "action owner, Al-Nukhba (legal)"],
  ["finance@nukhba.test", "action owner, Al-Nukhba (finance)"],
  ["admin@rawdah.test", "client admin and sponsor, Rawdah"],
  ["manager@rawdah.test", "client manager, Rawdah"],
  ["owner@rawdah.test", "action owner, Rawdah"],
];
const WALKTHROUGH_PASSWORD = "123456789@Pass";

const USERS = [
  ["sara@mizan.example", "firm admin"],
  ["khalid@mizan.example", "consultant (Al-Nukhba, Waha)"],
  ["noura@mizan.example", "consultant (Rawdah)"],
  ["fahd@nukhba.example", "client admin, Al-Nukhba"],
  ["reem@nukhba.example", "client manager, Al-Nukhba"],
  ["abdullah@nukhba.example", "action owner, Al-Nukhba"],
  ["hind@rawdah.example", "client manager, Rawdah"],
];

// ---------- output ----------

const say = (msg) => console.log(`\x1b[36m[selah]\x1b[0m ${msg}`);
function fail(msg) {
  console.error(`\x1b[31m[selah] ${msg}\x1b[0m`);
  process.exit(1);
}

// ---------- running things ----------

/** Runs a command to completion with its output shown; exits on failure unless allowFail. */
function run(cmd, args, { cwd = ROOT, env = {}, allowFail = false, quiet = false } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: quiet ? "pipe" : "inherit",
    // npm and npx are .cmd files on Windows, which need a shell.
    shell: WIN && (cmd === "npm" || cmd === "npx"),
    encoding: "utf8",
  });
  if (r.status !== 0 && !allowFail) {
    if (quiet) process.stderr.write(r.stderr ?? "");
    fail(`failed: ${cmd} ${args.join(" ")}`);
  }
  return r;
}

const docker = (args, opts) => run("docker", args, opts);
const compose = (args, opts) => docker([...COMPOSE, ...args], opts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what, check, { timeoutS = 180, everyS = 2 } = {}) {
  const until = Date.now() + timeoutS * 1000;
  while (Date.now() < until) {
    if (await check()) return;
    await sleep(everyS * 1000);
  }
  fail(`${what} did not come up within ${timeoutS} seconds (see: docker ${COMPOSE.join(" ")} logs)`);
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = createConnection({ host: "127.0.0.1", port });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });
}

// ---------- env files ----------

function parseEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** Copies an .env.example, filling the given keys (added at the end if the example lacks them). */
function writeFromExample(example, target, values) {
  const left = new Set(Object.keys(values));
  const quote = (v) => (/[\s"#<>]/.test(v) ? `"${v}"` : v);
  const lines = readFileSync(example, "utf8")
    .split(/\r?\n/)
    .map((line) => {
      const m = line.match(/^([A-Z0-9_]+)=/);
      if (!m || !left.has(m[1])) return line;
      left.delete(m[1]);
      return `${m[1]}=${quote(values[m[1]])}`;
    });
  for (const k of left) lines.push(`${k}=${quote(values[k])}`);
  writeFileSync(target, lines.join("\n"));
}

// Hex only: these end up inside postgres:// URLs.
const secret = () => randomBytes(24).toString("hex");

function ensureEnvFiles() {
  if (!existsSync(ROOT_ENV)) {
    say("first run: writing .env with new random local secrets");
    writeFromExample(join(ROOT, ".env.example"), ROOT_ENV, {
      POSTGRES_PASSWORD: secret(),
      SELAH_OWNER_PASSWORD: secret(),
      SELAH_APP_PASSWORD: secret(),
      SELAH_AUTH_PASSWORD: secret(),
      BETTER_AUTH_SECRET: secret(),
      AI_SERVICE_TOKEN: secret(),
      S3_SECRET_KEY: secret(),
      SMTP_URL: "smtp://mailpit:1025",
      MAIL_FROM: "Selah <no-reply@selah.localhost>",
      SEED_PASSWORD: `Selah-${randomBytes(4).toString("hex")}`,
    });
  }
  const root = parseEnv(ROOT_ENV);
  for (const k of ["POSTGRES_PASSWORD", "SELAH_OWNER_PASSWORD", "SELAH_APP_PASSWORD", "SELAH_AUTH_PASSWORD",
    "BETTER_AUTH_SECRET", "AI_SERVICE_TOKEN", "S3_SECRET_KEY", "SMTP_URL", "MAIL_FROM", "SEED_PASSWORD"]) {
    if (!root[k]) fail(`.env has no value for ${k}. Fill it in, or delete .env to have one written for you.`);
  }

  if (!existsSync(WEB_ENV)) {
    say("first run: writing apps/web/.env.local from .env");
    const db = (role, pw, name = "selah") => `postgres://${role}:${pw}@localhost:5432/${name}`;
    writeFromExample(join(WEB, ".env.example"), WEB_ENV, {
      DATABASE_OWNER_URL: db("selah_owner", root.SELAH_OWNER_PASSWORD),
      DATABASE_APP_URL: db("selah_app", root.SELAH_APP_PASSWORD),
      DATABASE_AUTH_URL: db("selah_auth", root.SELAH_AUTH_PASSWORD),
      TEST_DATABASE_OWNER_URL: db("selah_owner", root.SELAH_OWNER_PASSWORD, "selah_test"),
      TEST_DATABASE_APP_URL: db("selah_app", root.SELAH_APP_PASSWORD, "selah_test"),
      TEST_DATABASE_AUTH_URL: db("selah_auth", root.SELAH_AUTH_PASSWORD, "selah_test"),
      BETTER_AUTH_SECRET: root.BETTER_AUTH_SECRET,
      S3_ACCESS_KEY: root.S3_ACCESS_KEY || "selah",
      S3_SECRET_KEY: root.S3_SECRET_KEY,
      S3_BUCKET: root.S3_BUCKET || "selah-evidence",
      AI_SERVICE_TOKEN: root.AI_SERVICE_TOKEN,
      SEED_PASSWORD: root.SEED_PASSWORD,
      SMTP_URL: "smtp://localhost:1025",
      MAIL_FROM: root.MAIL_FROM,
      // Local development only; the app refuses both in production. With no
      // scanner host, uploads are kept as "skipped"; with one that is down,
      // every upload is refused. --full sets it.
      CLAMD_HOST: "",
      SCAN_REQUIRED: "false",
      TWO_FACTOR_REQUIRED: "false",
    });
  }
  return { root, web: parseEnv(WEB_ENV) };
}

// ---------- shared steps ----------

function checkTools() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) fail(`Node.js 22 or newer is needed (this is ${process.versions.node}). Get it from https://nodejs.org`);
  const r = docker(["info", "--format", "{{.ServerVersion}}"], { allowFail: true, quiet: true });
  if (r.error) fail("Docker is not installed. Install Docker Desktop: https://www.docker.com/products/docker-desktop/");
  if (r.status !== 0) fail("Docker is installed but not running. Start Docker Desktop, wait until it says it is running, then try again.");
}

function npmInstall() {
  const stamp = join(WEB, "node_modules", ".package-lock.json");
  if (existsSync(stamp) && statSync(stamp).mtimeMs >= statSync(join(WEB, "package-lock.json")).mtimeMs) return;
  say("installing the web app's packages (npm ci)");
  run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: WEB });
}

async function startServices(services, root) {
  say(`starting ${services.join(", ")}`);
  compose(["up", "-d", ...services]);
  // The database is ready once the init script has made the Selah roles and
  // the server listens on TCP (it does not during the first-start init).
  await waitFor("Postgres", () => {
    const r = compose(
      ["exec", "-T", "-e", `PGPASSWORD=${root.POSTGRES_PASSWORD}`, "db", "psql", "-h", "127.0.0.1", "-U", "postgres",
        "-d", "selah", "-tAc", "select 1 from pg_roles where rolname = 'selah_auth'"],
      { allowFail: true, quiet: true },
    );
    return r.status === 0 && r.stdout.trim() === "1";
  });
  say("Postgres is ready");
}

async function prepareDatabase(env, seed = "db:seed") {
  run("npm", ["run", "db:migrate"], { cwd: WEB, env });
  // RustFS takes a few seconds after its container starts.
  await waitFor("File storage", async () => {
    if (!(await portOpen(9000))) return false;
    return run("npm", ["run", "storage:init"], { cwd: WEB, env, allowFail: true, quiet: true }).status === 0;
  }, { timeoutS: 90 });
  say("file storage is ready");
  const seeded = run("npm", ["run", seed], { cwd: WEB, env, allowFail: true });
  if (seeded.status !== 0) {
    fail(
      seed === "db:seed:walkthrough"
        ? "the walkthrough data could not be loaded (see above). If this database holds other sample data, run: npm run walkthrough -- --fresh"
        : `failed: npm run ${seed}`,
    );
  }
}

function printAccounts(users, password) {
  const width = Math.max(...users.map(([e]) => e.length));
  console.log("");
  say(`Selah is running: ${APP_URL}  (you start signed out; sign in with any account below)`);
  say(`Mail it sends (invitations, resets): http://localhost:8025`);
  say(`Sample accounts, all with the password ${password}`);
  for (const [email, role] of users) console.log(`         ${email.padEnd(width)}  ${role}`);
  say("Ctrl+C stops the app; the containers keep running (npm run stop:local stops them).");
  console.log("");
}

// In development Next.js builds each page, and the browser code it needs, the
// first time someone opens it: several seconds a page, longer on Windows. So
// before saying the app is ready, open every main page once, signed in as a
// firm admin and a client admin, and fetch the scripts and styles each page
// asks for. Reading pages changes nothing; the only trace is one sign-in each
// in the audit log. A failure here only means slower first clicks.
const WARM_FIRM = ["/", "/today", "/projects", "/clients", "/clients/groups", "/inquiries", "/actions", "/review", "/oversight",
  "/templates", "/team", "/team/expertise", "/audit", "/settings", "/notifications", "/security", "/assistant"];
const WARM_CLIENT = ["/", "/projects", "/actions", "/team", "/departments", "/help", "/audit"];
// One page of each kind behind a link on the lists above (a project, an action...).
const WARM_DETAIL = /href="(\/(?:projects|actions|clients|recommendations|meetings|engagements)\/[0-9a-f-]{36})"/g;

async function warm(accounts) {
  say("opening every page once so the first clicks are quick (development builds each page on first use)");
  const started = Date.now();
  const fetched = new Set();
  // A page that never answers (a service still starting) must not hold up the start.
  const timeout = () => AbortSignal.timeout(120_000);
  let warmed = 0;
  const get = async (path, cookie) => {
    const res = await fetch(APP_URL + path, { headers: cookie ? { cookie } : {}, redirect: "manual", signal: timeout() }).catch(() => null);
    if (!res?.ok) return "";
    warmed++;
    return res.text().catch(() => "");
  };
  // The browser code each page loads is built on first request too.
  const assets = async (html) => {
    const urls = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]).filter((u) => !fetched.has(u));
    urls.forEach((u) => fetched.add(u));
    await Promise.all(urls.map((u) => fetch(APP_URL + u, { signal: timeout() }).then((r) => r.arrayBuffer()).catch(() => {})));
  };
  try {
    await assets(await get("/sign-in"));
    for (const [email, password, pages] of accounts) {
      const res = await fetch(`${APP_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP_URL },
        body: JSON.stringify({ email, password }),
        signal: timeout(),
      });
      // With two-factor sign-in on, the answer asks for a code instead of signing in.
      const body = await res.json().catch(() => ({}));
      const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
      if (!res.ok || !cookie || body.twoFactorRedirect) continue;
      // The first page of each kind is enough: the build is per route, not per record.
      const details = new Map();
      for (const page of pages) {
        const html = await get(page, cookie);
        for (const [, path] of html.matchAll(WARM_DETAIL)) if (!details.has(path.split("/")[1])) details.set(path.split("/")[1], path);
        await assets(html);
      }
      for (const path of details.values()) await assets(await get(path, cookie));
      await fetch(`${APP_URL}/api/auth/sign-out`, {
        method: "POST",
        headers: { cookie, origin: APP_URL, "content-type": "application/json" },
        body: "{}",
        signal: timeout(),
      }).catch(() => {});
    }
    if (warmed > 1) say(`pages ready (${Math.round((Date.now() - started) / 1000)} s)`);
    else say("could not sign in to open the pages in advance; the first visit to each page will be slower");
  } catch {
    say("could not open every page in advance; the first visit to each page will be slower");
  }
}

// ---------- commands ----------

/** Deletes the database and file storage volumes only, keeping the downloaded AI models and virus signatures. */
function wipeData() {
  say("deleting the local database and stored files (the AI models are kept)");
  compose(["rm", "-s", "-f", "-v", "db", "storage"], { allowFail: true, quiet: true });
  for (const v of ["selah_db-data", "selah_storage-data"]) docker(["volume", "rm", v], { allowFail: true, quiet: true });
}

/** Keeps the assistant's index current while the app runs: the first run once the embedding model is in, then every minute. */
function indexLoop(env) {
  let stopped = false;
  // Runs beside the app, so it never holds up the start or Ctrl+C.
  const once = () =>
    new Promise((done) => {
      const child = spawn("npm", ["run", "-s", "job:index-documents"], { cwd: WEB, env: { ...process.env, ...env }, stdio: "ignore", shell: WIN });
      child.on("exit", (status) => done({ status }));
      child.on("error", () => done({ status: 1 }));
    });
  (async () => {
    // The embedding model downloads once (about 1.2 GB) into the ollama volume.
    while (!stopped) {
      const r = docker(["inspect", "-f", "{{.State.Status}} {{.State.ExitCode}}", "selah-ollama-pull-1"], { allowFail: true, quiet: true });
      const state = r.stdout?.trim();
      if (state === "exited 0") break;
      if (state?.startsWith("exited")) {
        say("the AI model download failed; the assistant stays off (see: docker logs selah-ollama-pull-1)");
        return;
      }
      await sleep(10_000);
    }
    let first = true;
    while (!stopped) {
      const r = await once();
      if (first) {
        say(r.status === 0 ? "the assistant has read the sample files and records; it is ready" : "indexing for the assistant failed; it retries every minute");
        first = false;
      }
      await sleep(60_000);
    }
  })();
  return () => (stopped = true);
}

async function dev(flags, { walkthrough = false } = {}) {
  const full = flags.includes("--full");
  const ai = full || (walkthrough && !flags.includes("--no-ai"));
  checkTools();
  const { root, web } = ensureEnvFiles();
  // The end-to-end stack runs its own web app on port 3000.
  compose(["stop", "web", "mail", "jobs"], { allowFail: true, quiet: true });
  if (await portOpen(3000)) fail("Something else is using port 3000. Close it (another `npm run dev`?) and try again.");
  if (walkthrough && flags.includes("--fresh")) wipeData();

  const services = [
    "db",
    "storage",
    "mailpit",
    ...(full ? ["clamav"] : []),
    ...(ai ? ["ollama", "ollama-pull", "ai"] : []),
    ...(walkthrough ? ["pdf-local"] : []),
  ];
  npmInstall();
  await startServices(services, root);
  const env = {
    ...web,
    NODE_ENV: "development",
    ...(full ? { CLAMD_HOST: "localhost", SCAN_REQUIRED: "true" } : { CLAMD_HOST: "", SCAN_REQUIRED: "false" }),
    // The web app masks names before a hosted model sees them (docs/assistant.md), so it must know which kind runs.
    // The root .env sets it for the AI service; apps/web/.env.local keeps its own when the root has none.
    ...(root.LLM_PROVIDER ? { LLM_PROVIDER: root.LLM_PROVIDER } : {}),
    ...(root.AI_MASKING ? { AI_MASKING: root.AI_MASKING } : {}),
    ...(walkthrough ? { PDF_SERVICE_URL: "http://localhost:3001", WALKTHROUGH_PASSWORD: root.WALKTHROUGH_PASSWORD || WALKTHROUGH_PASSWORD } : {}),
  };
  // The seed's uploads don't wait for the scanner, which is still loading its signatures.
  await prepareDatabase(walkthrough ? { ...env, CLAMD_HOST: "", SCAN_REQUIRED: "false" } : env, walkthrough ? "db:seed:walkthrough" : "db:seed");
  if (ai) {
    const hosted = (env.LLM_PROVIDER || "ollama") === "openai_compat";
    say(
      hosted
        ? `the assistant answers with ${root.LLM_MODEL || "the hosted model"}; only the search model (bge-m3, about 1.2 GB) downloads, once`
        : "the assistant answers with the local model (qwen3:4b): slow without a GPU. A hosted model is faster: docs/walkthrough.md, \"The assistant\"",
    );
  }
  if (full) say("the virus scanner loads in the background; the first start downloads its signatures");
  else if (!walkthrough) say("lean start: no virus scanner (uploads are stored unscanned) and no AI assistant. Add --full for both.");

  const children = [
    spawn("npm", ["run", "dev"], { cwd: WEB, env: { ...process.env, ...env }, stdio: "inherit", shell: WIN }),
    // Sends queued mail to Mailpit as it is written.
    spawn("npm", ["run", "job:mail", "--", "--watch"], { cwd: WEB, env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "inherit"], shell: WIN }),
  ];
  const stopIndexing = ai ? indexLoop(env) : () => {};
  const stop = () => {
    stopIndexing();
    for (const c of children) {
      if (c.exitCode !== null) continue;
      if (WIN) spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
      else c.kill("SIGINT");
    }
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  children[0].on("exit", (code) => {
    if (code) console.error(`[selah] the web app stopped (exit ${code})`);
    stop();
  });

  await waitFor("The web app", async () => {
    try {
      return (await fetch(`${APP_URL}/sign-in`, { redirect: "manual" })).status < 500;
    } catch {
      return false;
    }
  }, { timeoutS: 300, everyS: 3 });
  if (!flags.includes("--no-warm")) {
    const password = walkthrough ? env.WALKTHROUGH_PASSWORD : root.SEED_PASSWORD;
    const [firm, client] = walkthrough ? ["admin@mizan.test", "admin@nukhba.test"] : ["sara@mizan.example", "fahd@nukhba.example"];
    await warm([[firm, password, WARM_FIRM], [client, password, WARM_CLIENT]]);
  }
  if (walkthrough) printAccounts(WALKTHROUGH_USERS, env.WALKTHROUGH_PASSWORD);
  else printAccounts(USERS, root.SEED_PASSWORD);
}

async function test(flags) {
  const quick = flags.includes("--quick");
  checkTools();
  const { root, web } = ensureEnvFiles();
  npmInstall();
  const results = [];
  const step = async (name, fn) => {
    say(`---- ${name} ----`);
    results.push([name, await fn()]);
  };
  const ok = (r) => r.status === 0;
  // UTC like CI: pg reads date columns as local midnight, so a machine on
  // Riyadh time would see some dates a day early.
  const inWeb = (args, env = {}) => ok(run("npm", args, { cwd: WEB, env: { ...web, TZ: "UTC", ...env }, allowFail: true }));

  await step("lint", () => inWeb(["run", "lint"]));
  await step("typecheck", () => inWeb(["run", "typecheck"]));
  await step("unit tests", () => inWeb(["test"]));

  await startServices(["db", "storage", "mailpit", "clamav"], root);
  const testDb = {
    DATABASE_OWNER_URL: web.TEST_DATABASE_OWNER_URL,
    TEST_DATABASE_OWNER_URL: web.TEST_DATABASE_OWNER_URL,
    TEST_DATABASE_APP_URL: web.TEST_DATABASE_APP_URL,
    TEST_DATABASE_AUTH_URL: web.TEST_DATABASE_AUTH_URL,
  };
  await step("database tests (row-level security)", () => inWeb(["run", "db:migrate"], testDb) && inWeb(["run", "test:db"], testDb));

  say("waiting for the virus scanner (the first start takes a few minutes)");
  await waitFor("ClamAV", () => {
    const r = docker(["inspect", "-f", "{{.State.Health.Status}}", "selah-clamav-1"], { allowFail: true, quiet: true });
    return r.stdout?.trim() === "healthy";
  }, { timeoutS: 900, everyS: 10 });
  await step("upload scanning tests", () => inWeb(["run", "test:scan"], { CLAMD_HOST: "localhost" }));

  // The AI service's tests in the same Python as CI, so nothing to install here.
  await step("AI service tests", () =>
    ok(docker(["run", "--rm", "-v", `${join(ROOT, "services", "ai")}:/src`, "-w", "/src", "python:3.13-slim",
      "sh", "-c", "pip install -q --root-user-action=ignore -r requirements-dev.txt && python -m pytest -q -p no:cacheprovider"],
    { allowFail: true })));

  if (quick) {
    say("skipping the end-to-end tests (--quick)");
  } else {
    if (await portOpen(3000)) {
      const r = docker(["inspect", "-f", "{{.State.Running}}", "selah-web-1"], { allowFail: true, quiet: true });
      if (r.stdout?.trim() !== "true") fail("Port 3000 is in use (is `npm run dev:local` still running?). Stop it, then run the tests again.");
    }
    await step("end-to-end tests (the whole stack in Docker, about 30 minutes)", async () => {
      say("building and starting the whole stack; the first run downloads the AI models (a few GB)");
      if (!ok(compose(["up", "-d", "--build", "web", "mail", "jobs", "mailpit", "ollama-pull"], { allowFail: true }))) return false;
      await waitFor("The web app in Docker", async () => {
        try {
          return (await fetch(`${APP_URL}/sign-in`, { redirect: "manual" })).status < 500;
        } catch {
          return false;
        }
      }, { timeoutS: 1200, everyS: 10 });
      say("waiting for the AI models to finish downloading");
      await waitFor("The AI model download", () => {
        const r = docker(["inspect", "-f", "{{.State.Status}} {{.State.ExitCode}}", "selah-ollama-pull-1"], { allowFail: true, quiet: true });
        return r.stdout?.trim() === "exited 0";
      }, { timeoutS: 3600, everyS: 10 });
      if (!ok(compose(["run", "--rm", "seed"], { allowFail: true }))) return false;
      if (!ok(compose(["run", "--rm", "seed", "npx", "tsx", "scripts/assistant-eval/seed.ts"], { allowFail: true }))) return false;
      run("npx", ["playwright", "install", "chromium"], { cwd: WEB });
      const passed = ok(run("npx", ["playwright", "test"], { cwd: WEB, env: { SEED_PASSWORD: root.SEED_PASSWORD }, allowFail: true }));
      // Free port 3000 for dev:local again.
      compose(["stop", "web", "mail", "jobs"], { allowFail: true, quiet: true });
      return passed;
    });
  }

  console.log("");
  for (const [name, passed] of results) console.log(`  ${passed ? "\x1b[32mpass\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${name}`);
  console.log("");
  process.exit(results.every(([, p]) => p) ? 0 : 1);
}

const [command = "dev", ...flags] = process.argv.slice(2);
if (command === "dev") await dev(flags);
else if (command === "walkthrough") await dev(flags, { walkthrough: true });
else if (command === "test") await test(flags);
else if (command === "stop") {
  checkTools();
  compose(["stop"]);
} else if (command === "reset") {
  checkTools();
  say("deleting the local containers and their sample data");
  compose(["down", "-v"]);
} else fail(`unknown command: ${command} (dev, walkthrough, test, stop or reset)`);
