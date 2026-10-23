// Two-factor sign-in rules (baseline: Two-factor) against a real Postgres: who
// must use it, that they can't switch it off, who may reset it, and who
// sees whether it is on.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... TEST_DATABASE_AUTH_URL=... npm run test:db
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
const authUrl = process.env.TEST_DATABASE_AUTH_URL;
if (!ownerUrl || !appUrl || !authUrl)
  throw new Error("set TEST_DATABASE_OWNER_URL, TEST_DATABASE_APP_URL and TEST_DATABASE_AUTH_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });
const authDb = new Pool({ connectionString: authUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-f400-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = { admin: id(11), cons: id(12), cadmin: id(13), cadmin2: id(14), cmgr: id(15), owner: id(16), betaAdmin: id(17) };

async function as<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
const resetBy = (by: string, target: string, why = "lost phone") =>
  as(by, (c) => c.query(`SELECT app_reset_two_factor($1, $2)`, [target, why]));
const enable = async (uid: string) => {
  await owner.query(`INSERT INTO two_factor (user_id, secret, backup_codes) VALUES ($1, 's', 'b')`, [uid]);
  await owner.query(`UPDATE "user" SET two_factor_enabled = true WHERE id = $1`, [uid]);
  await owner.query(`INSERT INTO session (token, expires_at, user_id) VALUES ($1, now() + interval '1 hour', $2)`, [
    `s-${uid}-${Math.random()}`,
    uid,
  ]);
};
const state = async (uid: string) =>
  (
    await owner.query(
      `SELECT u.two_factor_enabled AS on, (SELECT count(*)::int FROM two_factor WHERE user_id = u.id) AS secrets,
              (SELECT count(*)::int FROM session WHERE user_id = u.id) AS sessions FROM "user" u WHERE u.id = $1`,
      [uid],
    )
  ).rows[0];

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [
    FIRM,
    ACME,
    BETA,
  ]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$8,'firm_admin'), ($2,$8,'consultant'), ($3,$9,'client_admin'), ($4,$9,'client_admin'),
      ($5,$9,'client_manager'), ($6,$9,'action_owner'), ($7,$10,'client_admin')`,
    [U.admin, U.cons, U.cadmin, U.cadmin2, U.cmgr, U.owner, U.betaAdmin, FIRM, ACME, BETA],
  );
});

beforeEach(async () => {
  await owner.query(`TRUNCATE two_factor, session, outbound_emails, audit_log`);
  await owner.query(`UPDATE "user" SET two_factor_enabled = false`);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end(), authDb.end()]);
});

describe("two-factor sign-in", () => {
  it("is required for firm admins, consultants and client admins only", async () => {
    const required = async (uid: string) =>
      (await as(uid, (c) => c.query(`SELECT app_requires_two_factor($1) AS r`, [uid]))).rows[0].r;
    expect(await required(U.admin)).toBe(true);
    expect(await required(U.cons)).toBe(true);
    expect(await required(U.cadmin)).toBe(true);
    expect(await required(U.cmgr)).toBe(false);
    expect(await required(U.owner)).toBe(false);
  });

  it("can't be switched off by Better Auth for a required role, but can for others", async () => {
    await enable(U.cons);
    await enable(U.cmgr);
    await expect(authDb.query(`UPDATE "user" SET two_factor_enabled = false WHERE id = $1`, [U.cons])).rejects.toThrow(
      /required for this role/,
    );
    expect((await state(U.cons)).on).toBe(true);
    await authDb.query(`UPDATE "user" SET two_factor_enabled = false WHERE id = $1`, [U.cmgr]);
    expect((await state(U.cmgr)).on).toBe(false);
    // Turning it on is never blocked.
    await authDb.query(`UPDATE "user" SET two_factor_enabled = true WHERE id = $1`, [U.cmgr]);
  });

  it("is reset by an admin: secret, flag and sessions gone, a mail queued, the reason logged", async () => {
    await enable(U.cons);
    await resetBy(U.admin, U.cons, "new phone");
    expect(await state(U.cons)).toEqual({ on: false, secrets: 0, sessions: 0 });
    const mail = (await owner.query(`SELECT to_email, kind, link FROM outbound_emails`)).rows;
    expect(mail).toEqual([{ to_email: "cons@example.test", kind: "two_factor.reset", link: null }]);
    const log = (await owner.query(`SELECT actor_id, org_id, action, resource_id, outcome, reason FROM audit_log`)).rows;
    expect(log).toEqual([
      { actor_id: U.admin, org_id: FIRM, action: "two_factor.reset", resource_id: U.cons, outcome: "allow", reason: "new phone" },
    ]);
  });

  it("follows the address-change rule for who may reset", async () => {
    for (const uid of Object.values(U)) await enable(uid);
    // The firm admin: anyone at the firm or its clients.
    await resetBy(U.admin, U.cadmin);
    // A client admin: their own people, but not a fellow admin.
    await resetBy(U.cadmin2, U.cmgr);
    await expect(resetBy(U.cadmin2, U.cadmin)).rejects.toThrow(/not allowed/);
    await expect(resetBy(U.cadmin2, U.betaAdmin)).rejects.toThrow(/not allowed/);
    // Nobody themselves; consultants and managers nobody.
    await expect(resetBy(U.admin, U.admin)).rejects.toThrow(/not allowed/);
    await expect(resetBy(U.cons, U.cmgr)).rejects.toThrow(/not allowed/);
    await expect(resetBy(U.cmgr, U.owner)).rejects.toThrow(/not allowed/);
    // A reason is needed.
    await expect(resetBy(U.admin, U.cons, "  ")).rejects.toThrow(/say why/);
    expect((await state(U.cons)).on).toBe(true);
    expect((await state(U.betaAdmin)).on).toBe(true);
    await resetBy(U.admin, U.betaAdmin);
  });

  it("shows who has it on to the organisation's admins only", async () => {
    await enable(U.cmgr);
    const status = (by: string, org: string) =>
      as(by, (c) => c.query(`SELECT user_id, enabled FROM app_two_factor_status($1) ORDER BY user_id`, [org]));
    const acme = (await status(U.cadmin, ACME)).rows;
    expect(acme).toHaveLength(4);
    expect(acme.find((r) => r.user_id === U.cmgr)!.enabled).toBe(true);
    expect((await status(U.admin, ACME)).rows).toHaveLength(4);
    expect((await status(U.admin, BETA)).rows).toHaveLength(1);
    expect((await status(U.cons, FIRM)).rows).toHaveLength(0);
    expect((await status(U.cmgr, ACME)).rows).toHaveLength(0);
    expect((await status(U.betaAdmin, ACME)).rows).toHaveLength(0);
  });

  it("isn't readable as a column by the app role", async () => {
    await expect(as(U.admin, (c) => c.query(`SELECT two_factor_enabled FROM "user"`))).rejects.toThrow(/permission denied/);
  });
});
