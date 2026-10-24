// A holding group on the client side (F34 part 2, decision D4): the firm
// admin names the group's holding and grants named admins or managers there
// the group's roll-up. They read pooled counts per member company and open
// nothing of a linked client; the people of every other member never see
// the group or their siblings. These tests look for exactly those leaks.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { addMember, createGroup, grantViewer, groupOverview, groupRollup, myGroups, revokeViewer, setCompany, setHolding } from "@/services/client-groups";
import { loadPrincipal } from "@/services/principal";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c341-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const HOLD = id(2); // the holding, with a company kept inside it
const SUB = id(3); // a listed subsidiary, its own linked client
const SIB = id(4); // another linked subsidiary
const U = {
  admin: id(11),
  cons: id(12), // leads the holding
  ceo: id(13), // the holding's client admin, granted
  gov: id(14), // a holding manager, granted
  hmgr: id(15), // a holding manager, not granted
  howner: id(16), // a holding action owner
  sadmin: id(17), // the subsidiary's client admin
  smgr: id(18), // a subsidiary manager
  sibAdmin: id(19), // the other subsidiary's admin
};
const P = { hold: id(21), sub: id(22), sib: id(23), subDraft: id(24) };
const D = { co: id(31) };
const REC = { subPrivate: id(41), subClientOnly: id(42) };
const TODAY = "2026-10-20";
let n = 100;
const next = () => id(++n);
let G = "";

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
const sql = (userId: string, text: string, params: unknown[] = []) => as(userId, (c) => c.query(text, params));
const svc = <T>(userId: string, fn: (tx: Tx, p: Principal) => Promise<T>) =>
  as(userId, async (c) => {
    const tx = drizzle(c, { schema }) as unknown as Tx;
    return fn(tx, (await loadPrincipal(tx, userId))!);
  });
const refused = (p: Promise<unknown>) =>
  p.then(
    () => "",
    (e: Error & { cause?: Error }) => e.cause?.message ?? e.message,
  );
const rollup = (who: string) => svc(who, (tx, p) => groupRollup(tx, p, TODAY));
const rawRollup = async (who: string) => (await sql(who, `SELECT * FROM app_client_group_rollup($1, $2)`, [G, TODAY])).rows;

async function action(project: string, org: string, status: string, fields: { dept?: string; due?: string; rec?: string } = {}) {
  const rec = fields.rec ?? (await owner.query(`SELECT id FROM recommendations WHERE project_id = $1 ORDER BY created_at LIMIT 1`, [project])).rows[0].id;
  await owner.query(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, department_id, status, due_date, created_by)
     VALUES ($1,$2,$3,$4,'Secret work title',$5,$6,$7,$8)`,
    [next(), project, org, rec, fields.dept ?? null, status, fields.due ?? null, U.admin],
  );
}

async function seed() {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await truncateAuditLog(owner);
  await q(
    `INSERT INTO organizations (id, kind, name, name_ar, engagement_mode, departments_enabled) VALUES
      ($1,'firm','firm',NULL,NULL,false), ($2,'client','Holding','القابضة','full',true),
      ($3,'client','Listed Sub','التابعة المدرجة','full',false), ($4,'client','Sibling','الشقيقة','full',false)`,
    [FIRM, HOLD, SUB, SIB],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$10,'firm_admin'), ($2,$10,'consultant'), ($3,$11,'client_admin'), ($4,$11,'client_manager'), ($5,$11,'client_manager'),
      ($6,$11,'action_owner'), ($7,$12,'client_admin'), ($8,$12,'client_manager'), ($9,$13,'client_admin')`,
    [U.admin, U.cons, U.ceo, U.gov, U.hmgr, U.howner, U.sadmin, U.smgr, U.sibAdmin, FIRM, HOLD, SUB, SIB],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [HOLD, U.cons]);
  for (const [pid, org, state] of [
    [P.hold, HOLD, "active"],
    [P.sub, SUB, "active"],
    [P.sib, SIB, "active"],
    [P.subDraft, SUB, "draft"],
  ] as const) {
    await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Plan',$4,$5)`, [
      pid,
      org,
      FIRM,
      state,
      U.admin,
    ]);
    await q(`INSERT INTO recommendations (project_id, org_id, title, created_by) VALUES ($1,$2,'Charter',$3)`, [pid, org, U.admin]);
  }
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES
      ($1,$3,$4,'Firm draft','firm_private',$5), ($2,$3,$4,'Their own','client_private',$6)`,
    [REC.subPrivate, REC.subClientOnly, P.sub, SUB, U.admin, U.sadmin],
  );
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$2,'شركة التشغيل','Operating Co')`, [D.co, HOLD]);
  // The holding: 3 actions, 1 verified; its operating company holds 2 of them.
  await action(P.hold, HOLD, "verified_complete", { dept: D.co });
  await action(P.hold, HOLD, "in_progress", { dept: D.co });
  await action(P.hold, HOLD, "in_progress");
  // The subsidiary: 2 actions the client sees (1 verified, 1 overdue)...
  await action(P.sub, SUB, "verified_complete");
  await action(P.sub, SUB, "in_progress", { due: "2026-10-01" });
  // ...and work the group's viewers must not count: under a firm-only
  // recommendation, under the subsidiary's own private one, on a draft
  // project, and a draft action.
  await action(P.sub, SUB, "verified_complete", { rec: REC.subPrivate });
  await action(P.sub, SUB, "verified_complete", { rec: REC.subClientOnly });
  await action(P.subDraft, SUB, "in_progress");
  await action(P.sub, SUB, "draft");
  // The sibling: 1 blocked action.
  await action(P.sib, SIB, "blocked");

  ({ id: G } = await svc(U.admin, (tx, p) => createGroup(tx, p, { nameAr: "مجموعة القابضة", nameEn: "Holding Group", notes: "Firm-only note" })));
  for (const c of [HOLD, SUB, SIB]) await svc(U.admin, (tx, p) => addMember(tx, p, G, c));
  await svc(U.admin, (tx, p) => setCompany(tx, p, G, D.co, true));
}

/** The holding named and two of its people granted. */
async function grant() {
  await svc(U.admin, (tx, p) => setHolding(tx, p, G, HOLD));
  await svc(U.admin, (tx, p) => grantViewer(tx, p, G, U.ceo));
  await svc(U.admin, (tx, p) => grantViewer(tx, p, G, U.gov));
}

beforeEach(seed);
afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("granting the group's roll-up", () => {
  it("is the firm admin's: one holding, then named admins or managers there, all logged", async () => {
    // No holding yet: nobody can be granted.
    expect(await refused(svc(U.admin, (tx, p) => grantViewer(tx, p, G, U.ceo)))).toMatch(/admins or managers of its holding/);
    await grant();
    const log = (await owner.query(`SELECT action, meta FROM audit_log WHERE action LIKE 'client_group.%holding' OR action LIKE 'client_group.%viewer' ORDER BY created_at`))
      .rows;
    expect(log.map((r) => [r.action, r.meta.clientOrgId ?? r.meta.userId])).toEqual([
      ["client_group.set_holding", HOLD],
      ["client_group.grant_viewer", U.ceo],
      ["client_group.grant_viewer", U.gov],
    ]);
    expect((await owner.query(`SELECT count(*)::int AS n FROM client_group_members WHERE is_holding`)).rows[0].n).toBe(1);
    // Never the holding's action owner, a subsidiary's people or firm staff.
    for (const who of [U.howner, U.sadmin, U.smgr, U.sibAdmin, U.cons]) {
      expect(await refused(svc(U.admin, (tx, p) => grantViewer(tx, p, G, who)))).toMatch(/admins or managers of its holding/);
    }
    // Neither the consultant nor the holding's own admin grants anyone.
    expect(await refused(svc(U.cons, (tx, p) => grantViewer(tx, p, G, U.hmgr)))).toMatch(/forbidden/);
    expect(await refused(svc(U.ceo, (tx, p) => grantViewer(tx, p, G, U.hmgr)))).toMatch(/forbidden/);
    for (const who of [U.cons, U.ceo]) {
      expect(await refused(sql(who, `INSERT INTO client_group_viewers (group_id, user_id) VALUES ($1,$2)`, [G, U.hmgr]))).toMatch(/row-level security/);
      expect((await sql(who, `UPDATE client_group_members SET is_holding = true WHERE client_org_id = $1`, [SUB])).rowCount).toBe(0);
    }
    expect((await sql(U.ceo, `DELETE FROM client_group_viewers WHERE user_id = $1`, [U.gov])).rowCount).toBe(0);
    // The firm page shows who sees the group.
    const o = await svc(U.admin, (tx, p) => groupOverview(tx, p, G, TODAY));
    expect(o.holding?.id).toBe(HOLD);
    expect(o.viewers.map((v) => v.userId).sort()).toEqual([U.ceo, U.gov].sort());
    expect(o.viewerCandidates.map((c) => c.userId)).toEqual([U.hmgr]);
  });

  it("ends when revoked, when the person is switched off, or when the holding moves", async () => {
    await grant();
    await svc(U.admin, (tx, p) => revokeViewer(tx, p, G, U.gov));
    expect(await svc(U.gov, (tx, p) => myGroups(tx, p))).toEqual([]);
    expect(await rawRollup(U.gov)).toEqual([]);

    await owner.query(`UPDATE org_memberships SET active = false WHERE user_id = $1`, [U.ceo]);
    expect(await rawRollup(U.ceo)).toEqual([]);
    await owner.query(`UPDATE org_memberships SET active = true WHERE user_id = $1`, [U.ceo]);
    expect((await rawRollup(U.ceo)).length).toBeGreaterThan(0);

    // A new holding: the old holding's grants end, and its people can't be granted again.
    await svc(U.admin, (tx, p) => setHolding(tx, p, G, SUB));
    expect((await owner.query(`SELECT user_id FROM client_group_viewers`)).rows).toEqual([]);
    expect(await rawRollup(U.ceo)).toEqual([]);
    expect(await refused(svc(U.admin, (tx, p) => grantViewer(tx, p, G, U.ceo)))).toMatch(/admins or managers of its holding/);
  });
});

describe("what a granted person of the holding sees", () => {
  it("pooled counts per member company, from work the firm and each company both see", async () => {
    await grant();
    expect(await svc(U.ceo, (tx, p) => myGroups(tx, p))).toEqual([{ id: G, nameAr: "مجموعة القابضة", nameEn: "Holding Group" }]);
    const r = await rollup(U.ceo);
    // 3 + 2 + 1: the firm-only, client-private, draft-project and draft work of the subsidiary is not counted.
    expect(r.total).toMatchObject({ total: 6, verified: 2, open: 4, overdue: 1, blocked: 1 });
    expect(r.companies.map((c) => [c.kind, c.client.id, c.unit?.id ?? null, c.numbers.total, c.numbers.verified, c.numbers.implementedPct])).toEqual([
      ["unit", HOLD, D.co, 2, 1, 50],
      ["client", HOLD, null, 1, 0, 0],
      ["client", SUB, null, 2, 1, 50],
      ["client", SIB, null, 1, 0, 0],
    ]);
    // A manager granted sees the same.
    expect((await rollup(U.gov)).total).toEqual(r.total);
  });

  it("opens nothing of a linked company, and nothing the firm keeps", async () => {
    await grant();
    for (const who of [U.ceo, U.gov]) {
      for (const [table, col] of [
        ["organizations", "id"],
        ["projects", "org_id"],
        ["recommendations", "org_id"],
        ["actions", "org_id"],
        ["org_memberships", "org_id"],
      ] as const) {
        expect((await sql(who, `SELECT * FROM ${table} WHERE ${col} = ANY($1)`, [[SUB, SIB]])).rows).toEqual([]);
      }
      // Not the group record (its firm notes), not the member list, not the other grants.
      expect((await sql(who, `SELECT * FROM client_groups`)).rows).toEqual([]);
      expect((await sql(who, `SELECT * FROM client_group_members`)).rows).toEqual([]);
      expect((await sql(who, `SELECT user_id FROM client_group_viewers`)).rows).toEqual([{ user_id: who }]);
      // The firm's group page stays the firm's.
      expect(await refused(svc(who, (tx, p) => groupOverview(tx, p, G, TODAY)))).toMatch(/not found/);
    }
    // The roll-up carries counts and names of companies, never a record.
    const columns = Object.keys((await rawRollup(U.ceo))[0]!);
    expect(columns.some((c) => /title|user|owner|email|note/.test(c))).toBe(false);
    expect(JSON.stringify(await rawRollup(U.ceo))).not.toMatch(/Secret work title|Firm-only note/);
  });
});

describe("everyone else at a member company", () => {
  it("never sees the group or a sibling: the subsidiaries' people, and the holding's people not granted", async () => {
    await grant();
    for (const who of [U.sadmin, U.smgr, U.sibAdmin, U.hmgr, U.howner]) {
      expect(await svc(who, (tx, p) => myGroups(tx, p))).toEqual([]);
      expect(await refused(rollup(who))).toMatch(/not found/);
      expect(await rawRollup(who)).toEqual([]);
      expect((await sql(who, `SELECT * FROM app_my_client_groups()`)).rows).toEqual([]);
      expect((await sql(who, `SELECT * FROM client_groups`)).rows).toEqual([]);
      expect((await sql(who, `SELECT * FROM client_group_members`)).rows).toEqual([]);
      expect((await sql(who, `SELECT * FROM client_group_viewers`)).rows).toEqual([]);
    }
    // Siblings stay apart.
    expect((await sql(U.sadmin, `SELECT id FROM organizations WHERE id = ANY($1)`, [[HOLD, SIB]])).rows).toEqual([]);
    expect((await sql(U.sibAdmin, `SELECT id FROM actions WHERE org_id = ANY($1)`, [[HOLD, SUB]])).rows).toEqual([]);
    // A grant row typed in by hand for a subsidiary person is refused, so it can't open the roll-up either.
    expect(await refused(owner.query(`INSERT INTO client_group_viewers (group_id, user_id) VALUES ($1,$2)`, [G, U.sadmin]))).toMatch(
      /admins or managers of its holding/,
    );
  });
});
