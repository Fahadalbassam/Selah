// The pre-go-live clean-up (owner decision D8; review of #193, S1) against a
// real Postgres: old withdrawal rows that still hold a private file name and
// reason are found by a dry run that changes nothing, then blanked (never
// removed) in one transaction that keeps the audit chain checking, logs
// itself as a system event, finds nothing the second time, and refuses
// without the typed database name or on a test database without --allow-test.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CLEAN_ACTION, MIGRATION_0106_WHEN, cleanPrivateNames, looksLikeTestDatabase } from "@/jobs/clean-private-names";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");
const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 1 });

const id = (n: number) => `00000000-0000-4000-c1ea-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const P = { acme: id(5), beta: id(6) };
const U = { admin: id(11), lead: id(12), acmeAdmin: id(13), betaAdmin: id(14) };
const D = { a1: id(21), a2: id(22), a3: id(23), b1: id(24), firm: id(25), late: id(26) };
const SECRET = /Salary|Disciplinary|CFO|wrong file|mistake/;
// The stored text that is not a private name (the non-file event below).
const storedSecrets = (text: string) => text.replace(/Not a file/g, "");

let db = "";
const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
const n = async (sql: string, params: unknown[] = []) => (await q(sql, params)).rows[0].n as number;
const snapshot = async () => ({
  audit: (await q(`SELECT id, meta, chain_seq, chain_hash FROM audit_log ORDER BY created_at, id`)).rows,
  activity: (await q(`SELECT id, visibility, meta FROM activity_events ORDER BY created_at, id`)).rows,
  head: (await q(`SELECT head_seq, head_hash FROM audit_chain`)).rows[0],
});
const chainOk = async () => (await q(`SELECT ok FROM app_check_audit_chain()`)).rows[0].ok as boolean;
const oldAudit = (doc: string, actor: string, org: string, title: string) =>
  q(
    `INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
     VALUES ($1,$2,'document.withdraw','document',$3,'allow',jsonb_build_object('title', $4::text))`,
    [actor, org, doc, title],
  );
const oldEvent = (project: string, org: string, actor: string, doc: string, title: string, reason: string) =>
  q(
    `INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, meta)
     VALUES ($1,$2,$3,'document',$4,'document_withdrawn',jsonb_build_object('title', $5::text, 'reason', $6::text))`,
    [project, org, actor, doc, title, reason],
  );
const file = (docId: string, project: string, org: string, by: string, visibility: string) =>
  q(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility,
       storage_key, content_type, size_bytes, sha256, scan_status)
     VALUES ($1,$2,$3,$3,$4,'deliverable','submitted','a file',$5,$6,'application/pdf',10,'abc','clean')`,
    [docId, project, org, by, visibility, `k-${docId}`],
  );
const labelOf = async (doc: string) => (await q(`SELECT visibility FROM activity_events WHERE entity_id = $1`, [doc])).rows.map((r) => r.visibility);
const other = (action: string, meta: object = {}) =>
  q(`INSERT INTO audit_log (actor_id, org_id, action, resource_type, outcome, meta) VALUES ($1,$2,$3,'document','allow',$4)`, [U.admin, FIRM, action, meta]);

beforeAll(async () => {
  db = (await q(`SELECT current_database() AS d`)).rows[0].d;
  // This suite rewrites rows; it runs only on a test database (selah_test in CI, selah_test_* locally).
  expect(looksLikeTestDatabase(db)).toBe(true);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await truncateAuditLog(owner);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [FIRM, ACME, BETA]);
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$5,'firm_admin'), ($2,$5,'consultant'), ($3,$6,'client_admin'), ($4,$7,'client_admin')`,
    [U.admin, U.lead, U.acmeAdmin, U.betaAdmin, FIRM, ACME, BETA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$4,'Acme work','active',$5), ($3,'client',$6,$4,'Beta work','active',$5)`,
    [P.acme, ACME, P.beta, FIRM, U.admin, BETA],
  );

  // The files: two private ones (one each side's) and a shared one.
  await file(D.a1, P.acme, ACME, U.acmeAdmin, "client_private");
  await file(D.firm, P.acme, ACME, U.lead, "firm_private");
  await file(D.b1, P.beta, BETA, U.betaAdmin, "shared");
  // Its event below, written since 0106, has a different label (as if the file was relabelled later): not an old row, left alone.
  await file(D.late, P.acme, ACME, U.acmeAdmin, "shared");

  // Written the old way (before 0106), with sealed rows after them, so the
  // chain has to be re-hashed past the changed rows.
  await other("document.upload");
  await oldAudit(D.a1, U.acmeAdmin, ACME, "Salary scale 2027 (client private).pdf");
  await oldAudit(D.a2, U.acmeAdmin, ACME, "Disciplinary - case 4.pdf");
  await oldAudit(D.b1, U.betaAdmin, BETA, "Salary bands Beta.pdf");
  await oldAudit(D.firm, U.lead, FIRM, "Lead's private notes on the CFO.pdf");
  await other("document.download", { note: "kept" });
  await oldEvent(P.acme, ACME, U.acmeAdmin, D.a1, "Salary scale 2027 (client private).pdf", "wrong file");
  await oldEvent(P.acme, ACME, U.lead, D.firm, "Lead's private notes on the CFO.pdf", "uploaded by mistake");
  await oldEvent(P.beta, BETA, U.betaAdmin, D.b1, "Salary bands Beta.pdf", "wrong file");
  expect(await q(`SELECT app_seal_audit_log(10000)`)).toBeTruthy();
  // One more old row the sealing job has not reached yet.
  await oldAudit(D.a3, U.acmeAdmin, ACME, "Salary scale draft.pdf");
  // Written since 0106: no name, no reason. Not touched.
  await q(
    `INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome) VALUES ($1,$2,'document.withdraw','document',$3,'allow')`,
    [U.acmeAdmin, ACME, D.late],
  );
  await q(
    `INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, visibility) VALUES ($1,$2,$3,'document',$4,'document_withdrawn','client_private')`,
    [P.acme, ACME, U.acmeAdmin, D.late],
  );
  // A withdrawal event about something other than a file is not one of these rows.
  await q(
    `INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, meta) VALUES ($1,$2,$3,'action',$4,'document_withdrawn','{"title":"Not a file"}')`,
    [P.acme, ACME, U.lead, id(41)],
  );
  // A different event that happens to carry a title stays as it is.
  await q(
    `INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, meta) VALUES ($1,$2,$3,'action',$4,'action_created','{"title":"Kept title"}')`,
    [P.acme, ACME, U.lead, id(40)],
  );
  expect(await chainOk()).toBe(true);
});
afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("pre-go-live clean-up of old private file names", () => {
  it("refuses a test or check database unless allowed", async () => {
    expect(looksLikeTestDatabase("selah_test_t")).toBe(true);
    expect(looksLikeTestDatabase("selah_check")).toBe(true);
    expect(looksLikeTestDatabase("selah")).toBe(false);
    expect(looksLikeTestDatabase("selah_prod")).toBe(false);
    await expect(cleanPrivateNames(owner)).rejects.toThrow(/looks like a test or check database/);
    await expect(cleanPrivateNames(owner, { apply: true, confirm: db })).rejects.toThrow(/--allow-test/);
  });

  it("refuses to run as the app's role", async () => {
    await expect(cleanPrivateNames(app, { allowTest: true })).rejects.toThrow(/schema owner/);
  });

  it("the dry run counts per kind and per organisation and changes nothing", async () => {
    const before = await snapshot();
    const checks = await n(`SELECT count(*)::int AS n FROM audit_chain_checks`);
    const r = await cleanPrivateNames(owner, { allowTest: true });
    expect(r.applied).toBe(false);
    expect(r.totals).toEqual({
      "audit_log document.withdraw": 5,
      "activity_events document_withdrawn": 3,
      "activity_events document_withdrawn label": 2,
    });
    const by = (kind: string) => Object.fromEntries(r.counts.filter((c) => c.kind === kind).map((c) => [c.orgId, c.rows]));
    expect(by("audit_log document.withdraw")).toEqual({ [ACME]: 3, [BETA]: 1, [FIRM]: 1 });
    expect(by("activity_events document_withdrawn")).toEqual({ [ACME]: 2, [BETA]: 1 });
    // The two private files' old events were stored "shared"; the shared file's is right already.
    expect(by("activity_events document_withdrawn label")).toEqual({ [ACME]: 2 });
    expect(r.counts.find((c) => c.orgId === FIRM)?.orgKind).toBe("firm");
    // Sealed entries 2..6 (from the first old row to the head) would be re-hashed.
    expect(r.rehashedFrom).toBe(2);
    expect(r.rehashed).toBe(5);
    // Counts only: no file name or reason anywhere in what it reports.
    expect(JSON.stringify(r)).not.toMatch(SECRET);
    expect(await snapshot()).toEqual(before);
    expect(await n(`SELECT count(*)::int AS n FROM audit_chain_checks`)).toBe(checks);
  });

  it("refuses to apply without the typed database name, and changes nothing", async () => {
    const before = await snapshot();
    await expect(cleanPrivateNames(owner, { apply: true, allowTest: true })).rejects.toThrow(/type the database name/);
    await expect(cleanPrivateNames(owner, { apply: true, allowTest: true, confirm: "selah" })).rejects.toThrow(/type the database name/);
    await expect(cleanPrivateNames(owner, { apply: true, allowTest: true, confirm: ` ${db}` })).rejects.toThrow(/type the database name/);
    expect(await snapshot()).toEqual(before);
  });

  it("refuses to re-hash a chain that is already broken, and leaves the guard on", async () => {
    // A change made behind the guard's back (the way only the owner could).
    const behindTheGuard = async (meta: object) => {
      const c = await owner.connect();
      try {
        await c.query("BEGIN");
        await c.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_guard");
        await c.query(`UPDATE audit_log SET meta = $1 WHERE action = 'document.download'`, [meta]);
        await c.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_guard");
        await c.query("COMMIT");
      } finally {
        c.release();
      }
    };
    await behindTheGuard({ note: "tampered" });
    const before = await snapshot();
    await expect(cleanPrivateNames(owner, { apply: true, allowTest: true, confirm: db })).rejects.toThrow(/already broken at entry 6/);
    expect(await snapshot()).toEqual(before);
    // Put it back so the rest of the suite starts from a good chain.
    await behindTheGuard({ note: "kept" });
    expect(await chainOk()).toBe(true);
  });

  it("apply blanks the names and reasons, keeps every row, keeps the chain checking and logs a system event", async () => {
    const before = await snapshot();
    const r = await cleanPrivateNames(owner, { apply: true, allowTest: true, confirm: db });
    expect(r.applied).toBe(true);
    expect(r.totals).toEqual({
      "audit_log document.withdraw": 5,
      "activity_events document_withdrawn": 3,
      "activity_events document_withdrawn label": 2,
    });
    expect(r.rehashed).toBe(5);

    // No row removed; ids, places in the chain and all other fields unchanged.
    const after = await snapshot();
    expect(after.audit.length).toBe(before.audit.length + 1);
    expect(after.activity.map((a) => a.id)).toEqual(before.activity.map((a) => a.id));
    expect(after.audit.slice(0, before.audit.length).map((a) => [a.id, a.chain_seq])).toEqual(before.audit.map((a) => [a.id, a.chain_seq]));
    expect(after.head.head_seq).toBe(before.head.head_seq);
    expect(after.head.head_hash).not.toBe(before.head.head_hash);
    // The entry before the first changed one keeps its hash.
    expect(after.audit[0].chain_hash).toBe(before.audit[0].chain_hash);

    // The names and reasons are gone from storage; a marker says so.
    const stored = JSON.stringify(await q(`SELECT meta FROM audit_log UNION ALL SELECT meta FROM activity_events`).then((x) => x.rows));
    expect(storedSecrets(stored)).not.toMatch(SECRET);
    expect(await n(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'document.withdraw' AND meta = '{"redacted": true}'`)).toBe(5);
    expect(await n(`SELECT count(*)::int AS n FROM activity_events WHERE event = 'document_withdrawn' AND meta = '{"redacted": true}'`)).toBe(3);
    // Each old event now has its file's label; the 0106-era event keeps its own.
    expect(await labelOf(D.a1)).toEqual(["client_private"]);
    expect(await labelOf(D.firm)).toEqual(["firm_private"]);
    expect(await labelOf(D.b1)).toEqual(["shared"]);
    expect(await labelOf(D.late)).toEqual(["client_private"]);
    // What was written since 0106, and other kinds of row, are untouched.
    expect((await q(`SELECT meta FROM audit_log WHERE resource_id = $1`, [D.late])).rows).toEqual([{ meta: {} }]);
    expect((await q(`SELECT meta FROM activity_events WHERE entity_id = $1`, [D.late])).rows).toEqual([{ meta: {} }]);
    expect((await q(`SELECT meta FROM activity_events WHERE event = 'action_created'`)).rows).toEqual([{ meta: { title: "Kept title" } }]);
    expect((await q(`SELECT meta FROM activity_events WHERE entity_id = $1`, [id(41)])).rows).toEqual([{ meta: { title: "Not a file" } }]);
    expect((await q(`SELECT meta FROM audit_log WHERE action = 'document.download'`)).rows).toEqual([{ meta: { note: "kept" } }]);

    // The chain still checks, and the row the job had not sealed yet seals cleanly.
    expect(await chainOk()).toBe(true);
    expect((await q(`SELECT app_seal_audit_log(10000) AS n`)).rows[0].n).toBe(3);
    expect(await chainOk()).toBe(true);

    // The system event: no person, counts and hashes only.
    const ev = (await q(`SELECT actor_id, org_id, outcome, meta FROM audit_log WHERE action = $1`, [CLEAN_ACTION])).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      actor_id: null,
      org_id: null,
      outcome: "allow",
      meta: {
        audit_rows: 5,
        activity_rows: 3,
        activity_labels_set: 2,
        organisations: 3,
        rehashed_from: 2,
        rehashed_rows: 5,
        previous_head_hash: before.head.head_hash,
        head_hash: after.head.head_hash,
      },
    });
    expect(JSON.stringify(ev)).not.toMatch(SECRET);

    // The guard is back on: the app and the owner are refused again.
    await expect(q(`UPDATE audit_log SET meta = '{}' WHERE action = 'document.withdraw'`)).rejects.toThrow(/append-only/);
    await expect(q(`UPDATE activity_events SET meta = '{}' WHERE event = 'document_withdrawn'`)).rejects.toThrow(/append-only/);
    const triggers = (await q(`SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'audit_log'::regclass AND NOT tgisinternal ORDER BY tgname`)).rows;
    expect(triggers).toEqual([
      { tgname: "audit_log_guard", tgenabled: "O" },
      { tgname: "audit_log_no_truncate", tgenabled: "O" },
    ]);
  });

  it("a second run finds nothing and changes nothing", async () => {
    const before = await snapshot();
    const dry = await cleanPrivateNames(owner, { allowTest: true });
    expect(dry.totals).toEqual({
      "audit_log document.withdraw": 0,
      "activity_events document_withdrawn": 0,
      "activity_events document_withdrawn label": 0,
    });
    const again = await cleanPrivateNames(owner, { apply: true, allowTest: true, confirm: db });
    expect(again).toMatchObject({ applied: true, counts: [], rehashed: 0, rehashedFrom: null });
    expect(await snapshot()).toEqual(before);
    expect(await n(`SELECT count(*)::int AS n FROM audit_log WHERE action = $1`, [CLEAN_ACTION])).toBe(1);
  });

  it("refuses a database without migration 0106, changing nothing", async () => {
    const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: { tag: string; when: number }[] };
    expect(journal.entries.find((e) => e.tag === "0106_classification_leaks")?.when).toBe(MIGRATION_0106_WHEN);
    const row = (await q(`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations WHERE created_at::bigint = $1`, [MIGRATION_0106_WHEN])).rows[0];
    expect(row).toBeTruthy();
    await oldAudit(id(28), U.acmeAdmin, ACME, "Salary before 0106.pdf");
    await q(`DELETE FROM drizzle.__drizzle_migrations WHERE id = $1`, [row.id]);
    try {
      const before = await snapshot();
      await expect(cleanPrivateNames(owner, { allowTest: true })).rejects.toThrow(/migration 0106 is not applied/);
      await expect(cleanPrivateNames(owner, { apply: true, allowTest: true, confirm: db })).rejects.toThrow(/migration 0106 is not applied/);
      expect(await snapshot()).toEqual(before);
    } finally {
      await q(`INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES ($1,$2,$3)`, [row.id, row.hash, row.created_at]);
    }
  });

  it("waits for a sealing run that holds the seal lock, without a deadlock", async () => {
    // The row left by the previous test is cleaned here.
    const sealer = await owner.connect();
    try {
      await sealer.query("BEGIN");
      await sealer.query(`SELECT pg_advisory_xact_lock(hashtext('selah.audit_seal'))`);
      const run = cleanPrivateNames(owner, { apply: true, allowTest: true, confirm: db });
      // Wait until the run is queued on the seal lock.
      for (let i = 0; i < 100; i++) {
        const waiting = (await app.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`)).rows[0].n;
        if (waiting > 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      // What a sealing run does next: write to the audit log. Had the run
      // locked the table before asking for the seal lock, this would deadlock.
      await sealer.query(`SET LOCAL lock_timeout = '5s'`);
      expect((await sealer.query(`SELECT app_seal_audit_log(10000) AS n`)).rows[0].n).toBeGreaterThan(0);
      await sealer.query("COMMIT");
      const r = await run;
      expect(r.totals["audit_log document.withdraw"]).toBe(1);
    } finally {
      sealer.release();
    }
    expect(await chainOk()).toBe(true);
    expect(await n(`SELECT count(*)::int AS n FROM audit_log WHERE meta ? 'title'`)).toBe(0);
  });

  it("the firm admin's audit page shows the system event, with no name", async () => {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('selah.user_id', $1, true)", [U.admin]);
      const rows = (await c.query(`SELECT action, meta FROM app_audit_entries(NULL, NULL, NULL, NULL, NULL, NULL, 1000, 0)`)).rows;
      expect(rows.map((r) => r.action)).toContain(CLEAN_ACTION);
      expect(JSON.stringify(rows)).not.toMatch(SECRET);
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });

  it("the command line refuses a test database without --allow-test, and an apply whose typed name is wrong", () => {
    const web = fileURLToPath(new URL("../../", import.meta.url));
    const run = (args: string[], input = "") =>
      spawnSync(process.execPath, ["--import", "tsx", "scripts/pre-go-live/clean-private-names.ts", ...args], {
        cwd: web,
        input,
        encoding: "utf8",
        env: { ...process.env, DATABASE_OWNER_URL: ownerUrl },
        timeout: 60_000,
      });
    const refused = run(["--apply"], `${db}\n`);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/looks like a test or check database/);

    const wrong = run(["--apply", "--allow-test"], "selah\n");
    expect(wrong.status).toBe(1);
    expect(wrong.stdout).toMatch(/DRY RUN/);
    expect(wrong.stderr).toMatch(/not confirmed/);

    const dry = run(["--allow-test"]);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain(`DRY RUN (nothing changed) on database ${db}`);
    expect(dry.stdout).toMatch(/Run again with --apply/);
    expect(dry.stdout + dry.stderr).not.toMatch(SECRET);
  });
});
