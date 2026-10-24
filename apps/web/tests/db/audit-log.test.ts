// The audit log (R2) against a real Postgres: nobody edits or removes an
// entry, the hash chain finds a change made behind the guard's back, entries
// past the keep period are pruned without breaking the chain, and each admin
// reads only what is theirs.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, type Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { auditChainStatus, exportAuditCsv, listAuditEntries } from "@/services/audit-log";
import { loadPrincipal } from "@/services/principal";
import { truncateAuditLog } from "./audit-reset";

// The CSV's words come from the messages; here the keys stand in for them.
vi.mock("next-intl/server", () => ({
  getTranslations: async () => Object.assign((key: string) => key, { has: (key: string) => key === "actions.document_download" }),
}));

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-a160-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const OTHER = id(3);
const U = { admin: id(11), cons: id(12), cadmin: id(13), manager: id(14), otherAdmin: id(15) };

async function as<T>(userId: string | null, fn: (c: PoolClient) => Promise<T>, commit = false): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    if (userId) await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    const out = await fn(c);
    await c.query(commit ? "COMMIT" : "ROLLBACK");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>, commit = false) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    commit,
  );
const entries = (userId: string, extra = "NULL, NULL, NULL, NULL::text[], NULL, NULL") =>
  as(userId, async (c) => (await c.query(`SELECT * FROM app_audit_entries(${extra}, 100, 0)`)).rows);

/** Run as the owner in one transaction; the error message if it was refused, else null. */
async function ownerRefusal(sql: string, params: unknown[] = []): Promise<string | null> {
  const c = await owner.connect();
  try {
    await c.query("BEGIN");
    await c.query(sql, params);
    return null;
  } catch (e) {
    return (e as Error).message;
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}
const seal = async () => (await owner.query(`SELECT app_seal_audit_log() AS n`)).rows[0].n as number;
const check = async () => (await owner.query(`SELECT * FROM app_check_audit_chain()`)).rows[0];
const log = (action: string, actor: string | null, org: string | null, extra: Record<string, unknown> = {}) =>
  owner.query(
    `INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now())) RETURNING id`,
    [actor, org, action, extra.type ?? null, extra.resource ?? null, extra.outcome ?? "allow", extra.reason ?? null, extra.at ?? null],
  );

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','Mizan'), ($2,'client','Acme'), ($3,'client','Other Co')`, [FIRM, ACME, OTHER]);
  for (const [uid, name, email] of [
    [U.admin, "Sara", "sara@firm.test"],
    [U.cons, "Khalid", "khalid@firm.test"],
    [U.cadmin, "Fahd", "fahd@acme.test"],
    [U.manager, "Reem", "reem@acme.test"],
    [U.otherAdmin, "Omar", "omar@other.test"],
  ]) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, email]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role, active) VALUES
      ($1,$6,'firm_admin',true), ($2,$6,'consultant',true), ($3,$7,'client_admin',true), ($4,$7,'client_manager',true), ($5,$8,'client_admin',true)`,
    [U.admin, U.cons, U.cadmin, U.manager, U.otherAdmin, FIRM, ACME, OTHER],
  );
});

beforeEach(async () => {
  await truncateAuditLog(owner);
  await owner.query(`DELETE FROM firm_settings`);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("nobody changes the log", () => {
  it("the app only inserts: it can't read, change or remove an entry, or reach the chain", async () => {
    await as(U.admin, (c) => c.query(`INSERT INTO audit_log (actor_id, action, outcome) VALUES ($1, 'x.test', 'allow')`, [U.admin]), true);
    for (const sql of [
      `SELECT * FROM audit_log`,
      `UPDATE audit_log SET reason = 'x'`,
      `DELETE FROM audit_log`,
      `SELECT * FROM audit_chain`,
      `SELECT * FROM audit_chain_checks`,
      `SELECT app_seal_audit_log()`,
      `SELECT app_check_audit_chain()`,
      `SELECT app_prune_audit_log()`,
    ]) {
      await expect(as(U.admin, (c) => c.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
  });

  it("not even the owner edits, deletes or truncates an entry, sealed or not", async () => {
    await log("x.one", U.admin, FIRM);
    expect(await ownerRefusal(`UPDATE audit_log SET reason = 'changed'`)).toMatch(/append-only/);
    expect(await ownerRefusal(`DELETE FROM audit_log`)).toMatch(/append-only/);
    expect(await ownerRefusal(`TRUNCATE audit_log`)).toMatch(/can't be truncated/);
    await seal();
    expect(await ownerRefusal(`UPDATE audit_log SET reason = 'changed'`)).toMatch(/append-only/);
    // The seal flag only fills an empty seal; it never rewrites one or anything else.
    expect(
      await ownerRefusal(`SELECT set_config('selah.audit_seal', 'on', true); UPDATE audit_log SET chain_hash = repeat('f', 64)`),
    ).toMatch(/append-only/);
    // The prune flag never reaches an entry younger than the keep period.
    expect(
      await ownerRefusal(
        `SELECT set_config('selah.audit_prune', 'on', true); UPDATE audit_chain SET anchor_seq = head_seq; DELETE FROM audit_log`,
      ),
    ).toMatch(/append-only/);
    expect(await ownerRefusal(`UPDATE audit_chain SET head_seq = 0`)).toMatch(/only moves forward/);
    expect(await ownerRefusal(`DELETE FROM audit_chain`)).toMatch(/only moves forward/);
    await check();
    expect(await ownerRefusal(`DELETE FROM audit_chain_checks`)).toMatch(/append-only/);
  });
});

describe("the hash chain", () => {
  it("seals new entries in order and a check over them passes", async () => {
    for (const a of ["x.a", "x.b", "x.c"]) await log(a, U.admin, FIRM);
    expect(await seal()).toBe(3);
    expect(await seal()).toBe(0);
    await log("x.d", U.admin, FIRM);
    expect(await seal()).toBe(1);
    const c = await check();
    expect(c).toMatchObject({ ok: true, first_bad_seq: null, unsealed: 0 });
    expect(Number(c.rows_checked)).toBe(4);
    expect(Number(c.head_seq)).toBe(4);
    const seqs = (await owner.query(`SELECT action, chain_seq FROM audit_log ORDER BY chain_seq`)).rows;
    expect(seqs.map((r) => r.action)).toEqual(["x.a", "x.b", "x.c", "x.d"]);
  });

  it("finds an entry changed behind the guard's back, and where", async () => {
    for (const a of ["x.a", "x.b", "x.c"]) await log(a, U.admin, FIRM);
    await seal();
    const c = await owner.connect();
    try {
      await c.query("BEGIN");
      await c.query(`ALTER TABLE audit_log DISABLE TRIGGER audit_log_guard`);
      await c.query(`UPDATE audit_log SET reason = 'covered up' WHERE action = 'x.b'`);
      const r = (await c.query(`SELECT * FROM app_check_audit_chain()`)).rows[0];
      expect(r.ok).toBe(false);
      expect(Number(r.first_bad_seq)).toBe(2);
      // A failed check stops pruning.
      await expect(c.query(`SELECT app_prune_audit_log()`)).rejects.toThrow(/check failed/);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("finds an entry removed, and one removed from the end", async () => {
    for (const a of ["x.a", "x.b", "x.c"]) await log(a, U.admin, FIRM);
    await seal();
    for (const [where, bad] of [
      ["x.b", 2],
      ["x.c", 3],
    ] as const) {
      const c = await owner.connect();
      try {
        await c.query("BEGIN");
        await c.query(`ALTER TABLE audit_log DISABLE TRIGGER audit_log_guard`);
        await c.query(`DELETE FROM audit_log WHERE action = $1`, [where]);
        const r = (await c.query(`SELECT * FROM app_check_audit_chain()`)).rows[0];
        expect(r.ok, where).toBe(false);
        expect(Number(r.first_bad_seq), where).toBe(bad);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    }
    expect((await check()).ok).toBe(true);
  });
});

describe("keeping and pruning", () => {
  it("removes entries past the keep period from the start, and the chain still checks", async () => {
    await log("x.old1", U.admin, FIRM, { at: new Date(Date.now() - 425 * 864e5).toISOString() });
    await log("x.old2", U.admin, FIRM, { at: new Date(Date.now() - 400 * 864e5).toISOString() });
    await log("x.young", U.admin, FIRM, { at: new Date(Date.now() - 300 * 864e5).toISOString() });
    await log("x.now", U.admin, FIRM);
    await seal();
    // Kept for 24 months: nothing goes.
    await owner.query(`INSERT INTO firm_settings (org_id, audit_keep_months) VALUES ($1, 24)`, [FIRM]);
    expect((await owner.query(`SELECT app_prune_audit_log() AS n`)).rows[0].n).toBe(0);
    // The default 12: the two older than a year go.
    await owner.query(`UPDATE firm_settings SET audit_keep_months = 12 WHERE org_id = $1`, [FIRM]);
    expect((await owner.query(`SELECT app_prune_audit_log() AS n`)).rows[0].n).toBe(2);
    const left = (await owner.query(`SELECT action FROM audit_log ORDER BY chain_seq`)).rows.map((r) => r.action);
    expect(left).toEqual(["x.young", "x.now"]);
    const chain = (await owner.query(`SELECT anchor_seq, pruned_at FROM audit_chain`)).rows[0];
    expect(Number(chain.anchor_seq)).toBe(2);
    expect(chain.pruned_at).not.toBeNull();
    await log("x.later", U.admin, FIRM);
    await seal();
    expect(await check()).toMatchObject({ ok: true });
  });

  it("the keep period is 12 to 120 months, 12 by default", async () => {
    expect((await owner.query(`SELECT app_audit_keep_months() AS m`)).rows[0].m).toBe(12);
    expect(await ownerRefusal(`INSERT INTO firm_settings (org_id, audit_keep_months) VALUES ($1, 11)`, [FIRM])).toMatch(/audit_keep_months_range/);
    expect(await ownerRefusal(`INSERT INTO firm_settings (org_id, audit_keep_months) VALUES ($1, 121)`, [FIRM])).toMatch(/audit_keep_months_range/);
  });
});

describe("who reads what", () => {
  beforeEach(async () => {
    await log("document.download", U.cadmin, ACME, { type: "document", resource: id(90) });
    await log("document.read", U.manager, ACME, { type: "document", resource: id(91), outcome: "deny", reason: "label:firm_private" });
    await log("auth.sign_in.failed", null, null, { type: "user", resource: U.manager, outcome: "deny" });
    await log("auth.sign_in", U.manager, null, { type: "user", resource: U.manager });
    await log("project.update", U.cons, FIRM, { type: "project", resource: id(92) });
    await log("document.download", U.otherAdmin, OTHER, { type: "document", resource: id(93) });
    await log("membership.deactivate", U.admin, FIRM, { type: "user", resource: U.manager });
  });

  it("the firm admin reads everything, with every detail", async () => {
    const rows = await entries(U.admin);
    expect(rows).toHaveLength(7);
    const denied = rows.find((r) => r.action === "document.read")!;
    expect(denied).toMatchObject({ reason: "label:firm_private", resource_id: id(91), actor_name: "Reem", actor_org: "Acme" });
    expect(Number(rows[0].total)).toBe(7);
  });

  it("a client admin reads only their own people's events, and not what a refusal was about", async () => {
    const rows = await entries(U.cadmin);
    expect(rows.map((r) => r.action).sort()).toEqual(["auth.sign_in", "auth.sign_in.failed", "document.download", "document.read"]);
    const denied = rows.find((r) => r.action === "document.read")!;
    expect(denied).toMatchObject({ outcome: "deny", reason: null, resource_id: null, meta: {} });
    expect(rows.find((r) => r.action === "document.download")!.resource_id).toBe(id(90));
    // The other client's admin sees none of Acme's.
    expect((await entries(U.otherAdmin)).map((r) => r.action)).toEqual(["document.download"]);
  });

  it("consultants and client managers read nothing, and nobody but the firm admin sees the chain", async () => {
    expect(await entries(U.cons)).toEqual([]);
    expect(await entries(U.manager)).toEqual([]);
    for (const u of [U.cons, U.cadmin, U.manager]) {
      expect((await as(u, (c) => c.query(`SELECT * FROM app_audit_chain_status()`))).rows, u).toEqual([]);
    }
    expect((await as(U.admin, (c) => c.query(`SELECT * FROM app_audit_chain_status()`))).rows).toHaveLength(1);
    expect((await as(U.cadmin, (c) => c.query(`SELECT * FROM app_audit_people()`))).rows.map((r) => r.name).sort()).toEqual(["Fahd", "Reem"]);
  });

  it("filters by day, person, area, result and organization", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
    const list = (f: Parameters<typeof listAuditEntries>[2]) => svc(U.admin, (tx, p) => listAuditEntries(tx, p, f, 1));
    expect((await list({ area: "files" })).entries.map((e) => e.action)).toEqual(["document.download", "document.read", "document.download"]);
    expect((await list({ outcome: "deny" })).total).toBe(2);
    expect((await list({ person: U.manager })).total).toBe(3);
    expect((await list({ org: ACME })).total).toBe(4);
    expect((await list({ from: today, to: today })).total).toBe(7);
    expect((await list({ to: "2000-01-01" })).total).toBe(0);
  });

  it("the services refuse everyone but admins, and only the firm gets the chain's state", async () => {
    for (const u of [U.cons, U.manager]) {
      await expect(svc(u, (tx, p) => listAuditEntries(tx, p, {}, 1)), u).rejects.toBeInstanceOf(ForbiddenError);
      await expect(svc(u, (tx, p) => exportAuditCsv(tx, p, {}, "en")), u).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await svc(U.cadmin, (tx, p) => auditChainStatus(tx, p))).toBeNull();
    await seal();
    await check();
    const status = await svc(U.admin, (tx, p) => auditChainStatus(tx, p));
    expect(status).toMatchObject({ ok: true, headSeq: 7, unsealed: 0, keepMonths: 12 });
  });

  it("exports CSV with a byte-order mark, and the export is logged", async () => {
    const file = await svc(U.cadmin, (tx, p) => exportAuditCsv(tx, p, { area: "files" }, "en"), true);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(file.bytes);
    expect(text.startsWith("﻿")).toBe(true);
    const lines = text.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"csv.time"');
    expect(lines.slice(1).some((l) => l.includes('"actions.document_download"') || l.includes("document.download"))).toBe(true);
    // The refused attempt's record and reason stay out of the client's file.
    expect(text).not.toContain("label:firm_private");
    expect(text).not.toContain(id(91));
    const logged = (await owner.query(`SELECT actor_id, meta FROM audit_log WHERE action = 'audit_log.export'`)).rows;
    expect(logged).toEqual([{ actor_id: U.cadmin, meta: { rows: 2, total: 2, area: "files", outcome: null } }]);
  });
});
