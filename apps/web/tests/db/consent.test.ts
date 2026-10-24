// Terms, privacy notice and AI-use notice at the first sign-in (R1) against a
// real Postgres: what is pending, only the current version is recorded, the
// record can't be changed, and who may read whose.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { LEGAL_VERSIONS } from "@/lib/legal";
import { BadRequestError } from "@/server/errors";
import { acceptConsents, myConsents, pendingConsents } from "@/services/consent";
import { loadPrincipal } from "@/services/principal";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-a210-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const OTHER = id(3);
const U = { admin: id(11), cons: id(12), cadmin: id(13), manager: id(14), otherAdmin: id(15), gone: id(16) };

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
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>, commit = true) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    commit,
  );
const pending = (u: string) => as(u, async (c) => (await c.query(`SELECT app_consent_pending()::text[] AS p`)).rows[0].p as string[]);
const record = (u: string | null, doc: string, version: string, lang = "en") =>
  as(u, (c) => c.query(`SELECT app_record_consent($1::legal_doc, $2, $3, '10.0.0.1')`, [doc, version, lang]), true);
const acceptAll = (u: string) => svc(u, (tx, p) => acceptConsents(tx, p, { ...LEGAL_VERSIONS }, "ar", "10.0.0.2"));

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','Mizan'), ($2,'client','Acme'), ($3,'client','Other Co')`, [FIRM, ACME, OTHER]);
  for (const [uid, email] of Object.entries(U).map(([k, v]) => [v, `${k}@x.test`])) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $2)`, [uid, email]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role, active) VALUES
      ($1,$7,'firm_admin',true), ($2,$7,'consultant',true), ($3,$8,'client_admin',true), ($4,$8,'client_manager',true),
      ($5,$9,'client_admin',true), ($6,$8,'action_owner',false)`,
    [U.admin, U.cons, U.cadmin, U.manager, U.otherAdmin, U.gone, FIRM, ACME, OTHER],
  );
});

beforeEach(async () => {
  await owner.query(`BEGIN; ALTER TABLE consent_records DISABLE TRIGGER append_only; DELETE FROM consent_records;
    ALTER TABLE consent_records ENABLE TRIGGER append_only; COMMIT`);
  await truncateAuditLog(owner);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("what is pending", () => {
  it("everything at first, nothing once accepted, and accepting again stores nothing new", async () => {
    expect((await pending(U.manager)).sort()).toEqual(["ai_notice", "privacy", "terms"]);
    await record(U.manager, "terms", LEGAL_VERSIONS.terms);
    expect((await pending(U.manager)).sort()).toEqual(["ai_notice", "privacy"]);
    await acceptAll(U.manager);
    expect(await pending(U.manager)).toEqual([]);
    await record(U.manager, "terms", LEGAL_VERSIONS.terms);
    expect((await owner.query(`SELECT count(*)::int AS n FROM consent_records WHERE user_id = $1`, [U.manager])).rows[0].n).toBe(3);
  });

  it("a record of an older version counts for nothing", async () => {
    await owner.query(`INSERT INTO consent_records (user_id, doc, version, locale) VALUES ($1, 'terms', '2020-01-01', 'en')`, [U.cons]);
    expect(await pending(U.cons)).toContain("terms");
  });
});

describe("recording", () => {
  it("takes only the current version, a known language, and a signed-in person with an active account", async () => {
    await expect(record(U.cons, "terms", "2020-01-01")).rejects.toThrow(/not the current version/);
    await expect(record(U.cons, "terms", LEGAL_VERSIONS.terms, "fr")).rejects.toThrow(/ar or en/);
    await expect(record(null, "terms", LEGAL_VERSIONS.terms)).rejects.toThrow(/signed-in person/);
    await expect(record(U.gone, "terms", LEGAL_VERSIONS.terms)).rejects.toThrow(/signed-in person/);
  });

  it("the app can't write the table directly, and nobody changes a record", async () => {
    await expect(
      as(U.cons, (c) => c.query(`INSERT INTO consent_records (user_id, doc, version, locale) VALUES ($1, 'terms', $2, 'en')`, [U.cons, LEGAL_VERSIONS.terms])),
    ).rejects.toThrow(/permission denied/);
    await acceptAll(U.cons);
    await expect(owner.query(`UPDATE consent_records SET version = '2020-01-01'`)).rejects.toThrow(/append-only/);
    await expect(owner.query(`DELETE FROM consent_records`)).rejects.toThrow(/append-only/);
  });

  it("the service needs the versions shown to be the current ones, and logs the acceptance", async () => {
    await expect(
      svc(U.cadmin, (tx, p) => acceptConsents(tx, p, { ...LEGAL_VERSIONS, privacy: "2020-01-01" }, "en", null)),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(await acceptAll(U.cadmin)).toEqual({ pending: [] });
    const logged = (await owner.query(`SELECT actor_id, action, ip FROM audit_log WHERE action = 'consent.accept'`)).rows;
    expect(logged).toEqual([{ actor_id: U.cadmin, action: "consent.accept", ip: "10.0.0.2" }]);
    const mine = await svc(U.cadmin, (tx, p) => myConsents(tx, p));
    expect(mine.map((m) => m.doc).sort()).toEqual(["ai_notice", "privacy", "terms"]);
    expect(await svc(U.cadmin, (tx) => pendingConsents(tx))).toEqual([]);
  });
});

describe("who reads the records", () => {
  beforeEach(async () => {
    for (const u of [U.admin, U.cons, U.cadmin, U.manager, U.otherAdmin]) await acceptAll(u);
  });
  const readers = (u: string) =>
    as(u, async (c) => [...new Set((await c.query(`SELECT user_id FROM consent_records`)).rows.map((r) => r.user_id as string))].sort());

  it("the firm admin everyone's; a client admin their organization's; everyone else only their own", async () => {
    expect(await readers(U.admin)).toEqual([U.admin, U.cons, U.cadmin, U.manager, U.otherAdmin].sort());
    expect(await readers(U.cadmin)).toEqual([U.cadmin, U.manager].sort());
    expect(await readers(U.otherAdmin)).toEqual([U.otherAdmin]);
    expect(await readers(U.cons)).toEqual([U.cons]);
    expect(await readers(U.manager)).toEqual([U.manager]);
  });
});
