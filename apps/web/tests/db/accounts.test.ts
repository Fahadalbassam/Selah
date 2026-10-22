// Accounts and identity (migrations 0020-0021) against a real Postgres:
// email rules, invitations, address changes, deactivation, access reviews,
// contacts without a login, and erasure.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { listPeople } from "@/services/accounts";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-f000-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = {
  admin: id(11),
  admin2: id(12),
  lead: id(13), // assigned to Acme
  other: id(14), // consultant not on Acme
  cadmin: id(15), // Acme client admin
  cadmin2: id(16),
  cmgr: id(17),
  cowner: id(18),
  betaMgr: id(19),
};
const EMAIL: Record<string, string> = {
  admin: "sara@firm.example",
  admin2: "omar@firm.example",
  lead: "khalid@firm.example",
  other: "noura@firm.example",
  cadmin: "fahd@acme.example",
  cadmin2: "lina@acme.example",
  cmgr: "reem@gmail.com",
  cowner: "abdullah@acme.example",
  betaMgr: "hind@beta.example",
};
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

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
const run = (userId: string | null, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params), true);
const attempt = (userId: string | null, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params));
const invite = (by: string, org: string, email: string, role: string, token = `t-${email}`) =>
  run(by, `INSERT INTO invitations (org_id, email, name, role, token_hash, invited_by, expires_at) VALUES ($1,$2,'New',$3,$4,$5,now())`, [
    org,
    email,
    role,
    hash(token),
    by,
  ]);
const sessions = async (uid: string) => Number((await owner.query(`SELECT count(*) FROM session WHERE user_id = $1`, [uid])).rows[0].count);
const signIn = (uid: string) =>
  owner.query(`INSERT INTO session (token, expires_at, user_id) VALUES ($1, now() + interval '1 hour', $2)`, [`s-${uid}-${Math.random()}`, uid]);

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`TRUNCATE outbound_emails, audit_log`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [
    FIRM,
    ACME,
    BETA,
  ]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, EMAIL[name]]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role, active) VALUES
      ($1,$10,'firm_admin',true), ($2,$10,'firm_admin',true), ($3,$10,'consultant',true), ($4,$10,'consultant',true),
      ($5,$11,'client_admin',true), ($6,$11,'client_admin',true), ($7,$11,'client_manager',true), ($8,$11,'action_owner',true),
      ($9,$12,'client_manager',true)`,
    [U.admin, U.admin2, U.lead, U.other, U.cadmin, U.cadmin2, U.cmgr, U.cowner, U.betaMgr, FIRM, ACME, BETA],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [ACME, U.lead]);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("addresses", () => {
  it("are unique whatever their case", async () => {
    await expect(owner.query(`INSERT INTO "user" (name, email) VALUES ('x', 'Sara@Firm.Example')`)).rejects.toThrow(/user_email_lower_uq/);
  });

  it("users never see another organisation's people", async () => {
    const seen = (await attempt(U.cmgr, `SELECT id FROM "user"`)).rows.map((r) => r.id);
    expect(seen).not.toContain(U.betaMgr);
    expect(seen).not.toContain(U.other);
    expect(seen).toContain(U.cowner);
  });
});

describe("the people screen", () => {
  const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
    as(userId, async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    });

  it("lists the organisation, who has two-factor on, and whether erasure is offered", async () => {
    await owner.query(`UPDATE "user" SET two_factor_enabled = true WHERE id = $1`, [U.cmgr]);
    const mine = await svc(U.cadmin, (tx, p) => listPeople(tx, p, ACME));
    expect(mine.organization).toMatchObject({ id: ACME, kind: "client", name: "Acme" });
    expect(mine.people.find((x) => x.userId === U.cmgr)).toMatchObject({ twoFactor: true, personalEmail: true });
    expect(mine.people.find((x) => x.userId === U.cowner)!.twoFactor).toBe(false);
    expect(mine.can.erase).toBe(false);
    expect((await svc(U.admin, (tx, p) => listPeople(tx, p, ACME))).can.erase).toBe(true);
    expect((await svc(U.admin, (tx, p) => listPeople(tx, p, FIRM))).organization.kind).toBe("firm");
    await expect(svc(U.lead, (tx, p) => listPeople(tx, p, ACME))).rejects.toThrow();
    await expect(svc(U.cadmin, (tx, p) => listPeople(tx, p, BETA))).rejects.toThrow();
    await owner.query(`UPDATE "user" SET two_factor_enabled = false WHERE id = $1`, [U.cmgr]);
  });
});

describe("invitations", () => {
  it("to the firm need its email domains, and must match them", async () => {
    await expect(invite(U.admin, FIRM, "new@firm.example", "consultant")).rejects.toThrow(/set the firm's email domains/);
    await run(U.admin, `UPDATE organizations SET allowed_email_domains = '{@Firm.Example}' WHERE id = $1`, [FIRM]);
    expect((await owner.query(`SELECT allowed_email_domains FROM organizations WHERE id = $1`, [FIRM])).rows[0].allowed_email_domains).toEqual([
      "firm.example",
    ]);
    await expect(invite(U.admin, FIRM, "new@gmail.com", "consultant")).rejects.toThrow(/email domains/);
    await invite(U.admin, FIRM, " New@Firm.Example ", "consultant", "t-new@firm.example");
    const { rows } = await owner.query(`SELECT email, expires_at > now() + interval '6 days' AS week FROM invitations WHERE org_id = $1`, [
      FIRM,
    ]);
    expect(rows).toEqual([{ email: "new@firm.example", week: true }]);
    await expect(invite(U.admin, FIRM, "new@firm.example", "consultant", "again")).rejects.toThrow(/invitations_one_open/);
  });

  it("to a client take any address until the client sets a domain", async () => {
    await invite(U.cadmin, ACME, "someone@gmail.com", "action_owner");
    await run(U.cadmin, `UPDATE organizations SET allowed_email_domains = '{acme.example}' WHERE id = $1`, [ACME]);
    await expect(invite(U.cadmin, ACME, "another@gmail.com", "action_owner")).rejects.toThrow(/email domains/);
    await invite(U.cadmin, ACME, "another@acme.example", "action_owner");
    // Existing members off the domain keep their account (the UI flags them).
    expect((await attempt(U.cmgr, `SELECT app_role()`)).rows[0].app_role).toBe("client_manager");
    await run(U.cadmin, `UPDATE organizations SET allowed_email_domains = NULL WHERE id = $1`, [ACME]);
  });

  it("are refused for someone who already has an account, for the wrong role, or by the wrong person", async () => {
    await expect(invite(U.cadmin, ACME, "HIND@beta.example", "client_manager")).rejects.toThrow(/already has an account/);
    await expect(invite(U.cadmin, ACME, "x@acme.example", "consultant")).rejects.toThrow(/does not belong/);
    await expect(invite(U.cmgr, ACME, "y@acme.example", "action_owner")).rejects.toThrow(/row-level security/);
    await expect(invite(U.cadmin, BETA, "z@beta.example", "action_owner")).rejects.toThrow(/row-level security/);
    await expect(invite(U.lead, ACME, "w@acme.example", "action_owner")).rejects.toThrow(/row-level security/);
  });

  it("send their link only to the invited address, with the right token", async () => {
    const inv = (await owner.query(`SELECT id FROM invitations WHERE email = 'new@firm.example'`)).rows[0].id;
    await expect(run(U.admin, `SELECT app_send_invitation($1, 'wrong')`, [inv])).rejects.toThrow(/not allowed/);
    await expect(run(U.cadmin, `SELECT app_send_invitation($1, $2)`, [inv, "t-new@firm.example"])).rejects.toThrow(/not allowed/);
    await run(U.admin, `SELECT app_send_invitation($1, $2)`, [inv, "t-new@firm.example"]);
    const { rows } = await owner.query(`SELECT to_email, kind, link FROM outbound_emails`);
    expect(rows).toEqual([{ to_email: "new@firm.example", kind: "invitation", link: "/invite/t-new@firm.example" }]);
    await expect(attempt(U.admin, `SELECT * FROM outbound_emails`)).rejects.toThrow(/permission denied/);
  });

  it("are accepted once, by an account with the invited address", async () => {
    const token = hash("t-new@firm.example");
    const open = await run(null, `SELECT email, role, org_name FROM app_open_invitation($1)`, [token]);
    expect(open.rows).toEqual([{ email: "new@firm.example", role: "consultant", org_name: "firm" }]);
    const wrong = id(90);
    await owner.query(`INSERT INTO "user" (id, name, email) VALUES ($1, 'w', 'wrong@firm.example')`, [wrong]);
    await expect(run(null, `SELECT app_accept_invitation($1, $2)`, [token, wrong])).rejects.toThrow(/does not match/);
    const person = id(91);
    await owner.query(`INSERT INTO "user" (id, name, email) VALUES ($1, 'New', 'new@firm.example')`, [person]);
    await run(null, `SELECT app_accept_invitation($1, $2)`, [token, person]);
    expect((await owner.query(`SELECT role FROM org_memberships WHERE user_id = $1`, [person])).rows).toEqual([{ role: "consultant" }]);
    await expect(run(null, `SELECT app_accept_invitation($1, $2)`, [token, person])).rejects.toThrow(/no longer valid/);
    expect((await run(null, `SELECT * FROM app_open_invitation($1)`, [token])).rowCount).toBe(0);
  });

  it("can only be revoked", async () => {
    const sql = `UPDATE invitations SET %s WHERE email = 'someone@gmail.com'`;
    await expect(run(U.cadmin, sql.replace("%s", "role = 'client_admin'"))).rejects.toThrow(/can only be revoked/);
    await run(U.cadmin, sql.replace("%s", "revoked_at = now()"));
    await expect(run(U.cadmin, sql.replace("%s", "revoked_at = NULL"))).rejects.toThrow(/can only be revoked/);
  });
});

describe("address changes", () => {
  const request = (by: string, target: string, email: string, token = `c-${email}`) =>
    run(by, `INSERT INTO email_changes (user_id, new_email, token_hash, requested_by, old_email, expires_at) VALUES ($1,$2,$3,$4,'',now())`, [
      target,
      email,
      hash(token),
      by,
    ]);

  it("are made by the person's admin, never by themselves, and keep to the domains", async () => {
    await expect(request(U.cmgr, U.cmgr, "reem@acme.example")).rejects.toThrow(/row-level security/);
    await expect(request(U.cadmin, U.cadmin2, "lina2@acme.example")).rejects.toThrow(/row-level security/); // fellow admin
    await expect(request(U.cadmin, U.betaMgr, "h@beta.example")).rejects.toThrow(/row-level security/);
    await expect(request(U.admin, U.lead, "khalid@gmail.com")).rejects.toThrow(/email domains/);
    await expect(request(U.cadmin, U.cmgr, "fahd@acme.example")).rejects.toThrow(/already has an account/);
    await request(U.admin, U.cadmin2, "lina.new@acme.example");
  });

  it("switch over when the new address confirms: sessions end and the old address is told", async () => {
    await request(U.cadmin, U.cmgr, "Reem@Acme.Example");
    const cid = (await owner.query(`SELECT id, old_email FROM email_changes WHERE user_id = $1`, [U.cmgr])).rows[0];
    expect(cid.old_email).toBe("reem@gmail.com");
    await run(U.cadmin, `SELECT app_send_email_change($1, $2)`, [cid.id, "c-Reem@Acme.Example"]);
    await signIn(U.cmgr);
    await run(null, `SELECT app_confirm_email_change($1)`, [hash("c-Reem@Acme.Example")]);
    expect((await owner.query(`SELECT email, email_verified FROM "user" WHERE id = $1`, [U.cmgr])).rows[0]).toEqual({
      email: "reem@acme.example",
      email_verified: true,
    });
    expect(await sessions(U.cmgr)).toBe(0);
    const mail = (await owner.query(`SELECT to_email, kind FROM outbound_emails WHERE kind LIKE 'email_change%' ORDER BY created_at`)).rows;
    expect(mail).toEqual([
      { to_email: "reem@acme.example", kind: "email_change.confirm" },
      { to_email: "reem@gmail.com", kind: "email_change.notice" },
    ]);
    await expect(run(null, `SELECT app_confirm_email_change($1)`, [hash("c-Reem@Acme.Example")])).rejects.toThrow(/no longer valid/);
  });
});

describe("deactivation", () => {
  const off = (by: string, uid: string, reason: string | null) =>
    run(by, `UPDATE org_memberships SET active = false, deactivation_reason = $2 WHERE user_id = $1`, [uid, reason]);

  it("needs a reason, is never done to yourself, and ends the person's sessions at once", async () => {
    await signIn(U.cowner);
    await expect(off(U.cadmin, U.cowner, null)).rejects.toThrow(/say why/);
    await expect(off(U.cadmin, U.cadmin, "leaving")).rejects.toThrow(/your own account/);
    await off(U.cadmin, U.cowner, "left the company");
    expect(await sessions(U.cowner)).toBe(0);
    const m = (await owner.query(`SELECT deactivated_by, deactivated_at IS NOT NULL AS stamped FROM org_memberships WHERE user_id = $1`, [U.cowner])).rows[0];
    expect(m).toEqual({ deactivated_by: U.cadmin, stamped: true });
    // The next request finds no role, so every policy refuses.
    expect((await attempt(U.cowner, `SELECT app_role()`)).rows[0].app_role).toBeNull();
    expect((await attempt(U.cowner, `SELECT * FROM organizations`)).rowCount).toBe(0);
    const log = (await owner.query(`SELECT action, reason FROM audit_log WHERE resource_id = $1`, [U.cowner])).rows;
    expect(log).toEqual([{ action: "membership.deactivate", reason: "left the company" }]);
  });

  it("can be reversed, and the record is the database's to keep", async () => {
    await expect(run(U.cadmin, `UPDATE org_memberships SET deactivated_at = NULL WHERE user_id = $1`, [U.cowner])).rejects.toThrow(
      /kept by the database/,
    );
    await run(U.cadmin, `UPDATE org_memberships SET active = true WHERE user_id = $1`, [U.cowner]);
    expect((await owner.query(`SELECT deactivation_reason FROM org_memberships WHERE user_id = $1`, [U.cowner])).rows[0]).toEqual({
      deactivation_reason: null,
    });
    await expect(run(U.cadmin, `UPDATE org_memberships SET user_id = $2 WHERE user_id = $1`, [U.cowner, id(91)])).rejects.toThrow(
      /stays with its person/,
    );
  });
});

describe("access reviews", () => {
  const review = (by: string, org: string, kept: string[], deactivated: string[] = []) =>
    run(by, `INSERT INTO access_reviews (org_id, reviewed_by, kept, deactivated) VALUES ($1,$2,$3,$4)`, [org, by, kept, deactivated]);

  it("are due every access_review_days, through the organisation's admins", async () => {
    await owner.query(`UPDATE organizations SET created_at = now() - interval '100 days'`);
    const due = async () =>
      (await owner.query(`SELECT org_id, admin_user_id FROM app_access_reviews_due((now() AT TIME ZONE 'Asia/Riyadh')::date) ORDER BY 1, 2`)).rows;
    const rows = await due();
    expect(rows).toContainEqual({ org_id: ACME, admin_user_id: U.cadmin });
    expect(rows).toContainEqual({ org_id: FIRM, admin_user_id: U.admin });
    // Beta has no client admin: the firm's admins are asked.
    expect(rows.filter((r) => r.org_id === BETA).map((r) => r.admin_user_id).sort()).toEqual([U.admin, U.admin2].sort());
    const today = `(now() AT TIME ZONE 'Asia/Riyadh')::date`;
    const sent = (await owner.query(`SELECT app_notify_access_reviews(${today}) AS n`)).rows[0].n;
    expect(sent).toBe(rows.length);
    expect((await owner.query(`SELECT app_notify_access_reviews(${today}) AS n`)).rows[0].n).toBe(0); // once per period
  });

  it("must cover every active member, and then reset the clock", async () => {
    const acme = [U.cadmin, U.cadmin2, U.cmgr];
    await expect(review(U.cadmin, ACME, acme)).rejects.toThrow(/every active member/);
    await expect(review(U.cmgr, ACME, [...acme, U.cowner])).rejects.toThrow(/row-level security/);
    await expect(review(U.cadmin, ACME, [...acme, U.cowner], [U.cowner])).rejects.toThrow(/either kept or switched off/);
    await run(U.cadmin, `UPDATE org_memberships SET active = false, deactivation_reason = 'review' WHERE user_id = $1`, [U.cowner]);
    await review(U.cadmin, ACME, acme, [U.cowner]);
    const due = (await owner.query(`SELECT org_id FROM app_access_reviews_due((now() AT TIME ZONE 'Asia/Riyadh')::date)`)).rows;
    expect(due.map((r) => r.org_id)).not.toContain(ACME);
    await expect(run(U.cadmin, `UPDATE access_reviews SET kept = '{}'`)).rejects.toThrow(/permission denied|append-only|not allowed/);
  });
});

describe("contacts without a login", () => {
  it("are kept by the firm and invisible to clients and to consultants not on the client", async () => {
    await run(U.lead, `INSERT INTO client_contacts (org_id, name, email) VALUES ($1, 'Majed', ' Majed@Acme.Example ')`, [ACME]);
    expect((await owner.query(`SELECT email, created_by FROM client_contacts`)).rows).toEqual([{ email: "majed@acme.example", created_by: U.lead }]);
    expect((await attempt(U.admin, `SELECT * FROM client_contacts`)).rowCount).toBe(1);
    for (const who of [U.other, U.cadmin, U.cmgr]) {
      expect((await attempt(who, `SELECT * FROM client_contacts`)).rowCount, who).toBe(0);
    }
    await expect(run(U.other, `INSERT INTO client_contacts (org_id, name) VALUES ($1, 'x')`, [ACME])).rejects.toThrow(/row-level security/);
    await expect(run(U.admin, `INSERT INTO client_contacts (org_id, name) VALUES ($1, 'x')`, [FIRM])).rejects.toThrow(/row-level security/);
  });
});

describe("erasure", () => {
  it("is for firm admins only", async () => {
    await expect(run(U.cadmin, `SELECT app_erase_user($1, 'request')`, [U.cmgr])).rejects.toThrow(/not allowed/);
    await expect(run(U.admin, `SELECT app_erase_user($1, 'request')`, [U.admin])).rejects.toThrow(/not allowed/);
    await expect(run(U.admin, `SELECT app_erase_user($1, ' ')`, [U.cmgr])).rejects.toThrow(/say why/);
  });

  it("removes the person's details and sign-in, and keeps every id and audit row", async () => {
    await signIn(U.cmgr);
    await owner.query(`INSERT INTO account (account_id, provider_id, user_id, password) VALUES ($1, 'credential', $2, 'hash')`, [U.cmgr, U.cmgr]);
    const before = Number((await owner.query(`SELECT count(*) FROM audit_log WHERE resource_id = $1 OR actor_id = $1`, [U.cmgr])).rows[0].count);
    const n = (await run(U.admin, `SELECT app_erase_user($1, 'PDPL request 2026-10-20') AS n`, [U.cmgr])).rows[0].n;
    const person = (await owner.query(`SELECT name, email, image FROM "user" WHERE id = $1`, [U.cmgr])).rows[0];
    expect(person).toEqual({ name: `Former user #${n}`, email: `erased-${n}@erased.invalid`, image: null });
    expect(await sessions(U.cmgr)).toBe(0);
    expect((await owner.query(`SELECT 1 FROM account WHERE user_id = $1`, [U.cmgr])).rowCount).toBe(0);
    expect((await owner.query(`SELECT active FROM org_memberships WHERE user_id = $1`, [U.cmgr])).rows[0].active).toBe(false);
    const leftovers = await owner.query(
      `SELECT 1 FROM email_changes WHERE old_email LIKE 'reem@%' OR new_email LIKE 'reem@%'
       UNION ALL SELECT 1 FROM outbound_emails WHERE to_email LIKE 'reem@%'`,
    );
    expect(leftovers.rowCount).toBe(0);
    const after = Number((await owner.query(`SELECT count(*) FROM audit_log WHERE resource_id = $1 OR actor_id = $1`, [U.cmgr])).rows[0].count);
    expect(after).toBe(before + 2); // switched off, then erased
  });
});
