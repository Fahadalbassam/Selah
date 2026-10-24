// Holding groups on the firm side (F34 part 1, decision D4): a group is a
// record of its own that only the firm admin keeps; each member company is
// either its own linked client or a unit inside one member client; the group
// page pools their counts (app_client_progress, under the reader's RLS) with
// a row per company. Consultants see a group only through the member clients
// they are assigned to, and the client side never reads these tables.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { addMember, createGroup, deleteGroup, groupOverview, listGroups, removeMember, setCompany, updateGroup } from "@/services/client-groups";
import { loadPrincipal } from "@/services/principal";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c340-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const HOLD = id(2); // the holding: one client, with a company kept inside it
const SUB = id(3); // a listed subsidiary: its own linked client
const OTHER = id(4); // a client outside the group
const U = {
  admin: id(11),
  holdLead: id(12), // leads the holding
  subCons: id(13), // assigned to the subsidiary only
  stranger: id(14), // assigned to neither
  hadmin: id(15), // the holding's client admin
  sadmin: id(16), // the subsidiary's client admin
};
const P = { hold: id(21), sub: id(22), other: id(23) };
const D = { co: id(31), hr: id(32), otherDept: id(33) };
const TODAY = "2026-10-20";
let n = 100;
const next = () => id(++n);

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
const isCompany = async (dept: string) => (await owner.query(`SELECT is_company FROM departments WHERE id = $1`, [dept])).rows[0].is_company;

async function action(project: string, org: string, status: string, fields: { dept?: string; due?: string } = {}) {
  const rec = (await owner.query(`SELECT id FROM recommendations WHERE project_id = $1`, [project])).rows[0].id;
  await owner.query(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, department_id, status, due_date, created_by)
     VALUES ($1,$2,$3,$4,'Work',$5,$6,$7,$8)`,
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
      ($3,'client','Listed Sub','التابعة المدرجة','full',false), ($4,'client','Other',NULL,'full',true)`,
    [FIRM, HOLD, SUB, OTHER],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$7,'firm_admin'), ($2,$7,'consultant'), ($3,$7,'consultant'), ($4,$7,'consultant'), ($5,$8,'client_admin'), ($6,$9,'client_admin')`,
    [U.admin, U.holdLead, U.subCons, U.stranger, U.hadmin, U.sadmin, FIRM, HOLD, SUB],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$3,true), ($2,$4,true)`, [HOLD, SUB, U.holdLead, U.subCons]);
  for (const [pid, org] of [
    [P.hold, HOLD],
    [P.sub, SUB],
    [P.other, OTHER],
  ] as const) {
    await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Plan','active',$4)`, [
      pid,
      org,
      FIRM,
      U.admin,
    ]);
    await q(`INSERT INTO recommendations (project_id, org_id, title, created_by) VALUES ($1,$2,'Charter',$3)`, [pid, org, U.admin]);
  }
  await q(
    `INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$4,'شركة التشغيل','Operating Co'), ($2,$4,'الموارد البشرية','HR'), ($3,$5,'المالية','Finance')`,
    [D.co, D.hr, D.otherDept, HOLD, OTHER],
  );
  // The holding: 5 actions, 2 verified. Its operating company holds 2 (1 verified).
  await action(P.hold, HOLD, "verified_complete", { dept: D.co });
  await action(P.hold, HOLD, "in_progress", { dept: D.co });
  await action(P.hold, HOLD, "verified_complete", { dept: D.hr });
  await action(P.hold, HOLD, "in_progress", { dept: D.hr });
  await action(P.hold, HOLD, "in_progress");
  await action(P.hold, HOLD, "draft"); // never counted
  // The subsidiary: 3 actions, 1 verified, 1 overdue, 1 blocked.
  await action(P.sub, SUB, "verified_complete");
  await action(P.sub, SUB, "in_progress", { due: "2026-10-01" });
  await action(P.sub, SUB, "blocked");
  // Outside the group.
  await action(P.other, OTHER, "verified_complete");
}

/** The admin's group: the holding with its company inside, and the subsidiary linked. */
async function makeGroup() {
  const { id: g } = await svc(U.admin, (tx, p) => createGroup(tx, p, { nameAr: "مجموعة القابضة", nameEn: "Holding Group", notes: "Family group" }));
  await svc(U.admin, (tx, p) => addMember(tx, p, g, HOLD));
  await svc(U.admin, (tx, p) => addMember(tx, p, g, SUB));
  await svc(U.admin, (tx, p) => setCompany(tx, p, g, D.co, true));
  return g;
}

beforeEach(seed);
afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("keeping a group", () => {
  it("is the firm admin's, and every change is logged", async () => {
    const g = await makeGroup();
    await svc(U.admin, (tx, p) => updateGroup(tx, p, g, { nameEn: "The Holding Group", notes: null }));
    const log = (await owner.query(`SELECT action, meta FROM audit_log WHERE resource_id = $1 ORDER BY created_at`, [g])).rows;
    expect(log.map((r) => r.action)).toEqual([
      "client_group.create",
      "client_group.add_member",
      "client_group.add_member",
      "client_group.set_company",
      "client_group.update",
    ]);
    expect(log[3].meta).toEqual({ clientOrgId: HOLD, departmentId: D.co });
    const row = (await owner.query(`SELECT name_en, notes, created_by FROM client_groups WHERE id = $1`, [g])).rows[0];
    expect(row).toEqual({ name_en: "The Holding Group", notes: null, created_by: U.admin });

    // Consultants, even the holding's lead, change nothing.
    for (const who of [U.holdLead, U.subCons]) {
      expect(await refused(svc(who, (tx, p) => createGroup(tx, p, { nameAr: "أخرى" })))).toMatch(/forbidden/);
      expect(await refused(svc(who, (tx, p) => updateGroup(tx, p, g, { nameAr: "x" })))).toMatch(/forbidden/);
      expect(await refused(svc(who, (tx, p) => addMember(tx, p, g, OTHER)))).toMatch(/forbidden/);
      expect(await refused(sql(who, `INSERT INTO client_groups (firm_org_id, name_ar) VALUES ($1,'x')`, [FIRM]))).toMatch(/row-level security/);
      expect(await refused(sql(who, `INSERT INTO client_group_members (group_id, client_org_id) VALUES ($1,$2)`, [g, OTHER]))).toMatch(
        /row-level security/,
      );
      expect((await sql(who, `UPDATE client_groups SET name_ar = 'x' WHERE id = $1`, [g])).rowCount).toBe(0);
      expect((await sql(who, `DELETE FROM client_group_members WHERE group_id = $1`, [g])).rowCount).toBe(0);
      expect((await sql(who, `DELETE FROM client_groups WHERE id = $1`, [g])).rowCount).toBe(0);
    }
  });

  it("holds a client in one group at most", async () => {
    await makeGroup();
    const { id: g2 } = await svc(U.admin, (tx, p) => createGroup(tx, p, { nameAr: "مجموعة أخرى" }));
    expect(await refused(svc(U.admin, (tx, p) => addMember(tx, p, g2, SUB)))).toMatch(/already in a group/);
    expect(await refused(svc(U.admin, (tx, p) => createGroup(tx, p, { nameAr: "مجموعة القابضة" })))).toMatch(/exists/);
    // The firm is not a member.
    expect(await refused(sql(U.admin, `INSERT INTO client_group_members (group_id, client_org_id) VALUES ($1,$2)`, [g2, FIRM]))).toMatch(
      /row-level security|members are clients/,
    );
  });

  it("marks a company inside a client only by the firm admin, and only while the client is in a group", async () => {
    // Not in a group yet.
    expect(await refused(sql(U.admin, `UPDATE departments SET is_company = true WHERE id = $1`, [D.otherDept]))).toMatch(/to a group first/);
    const g = await makeGroup();
    expect(await isCompany(D.co)).toBe(true);
    // The holding's own admin names departments but does not mark companies.
    expect(await refused(sql(U.hadmin, `UPDATE departments SET is_company = true WHERE id = $1`, [D.hr]))).toMatch(/only the firm admin/);
    expect(await refused(sql(U.hadmin, `UPDATE departments SET is_company = false WHERE id = $1`, [D.co]))).toMatch(/only the firm admin/);
    expect(await refused(sql(U.hadmin, `INSERT INTO departments (org_id, name_ar, is_company) VALUES ($1,'جديدة',true)`, [HOLD]))).toMatch(
      /only the firm admin/,
    );
    await sql(U.hadmin, `UPDATE departments SET name_en = 'OpCo' WHERE id = $1`, [D.co]);
    // A department of a client outside this group is not this group's to mark.
    expect(await refused(svc(U.admin, (tx, p) => setCompany(tx, p, g, D.otherDept, true)))).toMatch(/not found/);
    // Unmarking is logged too.
    await svc(U.admin, (tx, p) => setCompany(tx, p, g, D.co, false));
    expect(await isCompany(D.co)).toBe(false);
    expect((await owner.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'client_group.clear_company'`)).rows[0].n).toBe(1);
  });

  it("turns a leaving client's companies back into departments, and a removed group leaves its clients as they were", async () => {
    const g = await makeGroup();
    await svc(U.admin, (tx, p) => removeMember(tx, p, g, HOLD));
    expect(await isCompany(D.co)).toBe(false);
    await svc(U.admin, (tx, p) => addMember(tx, p, g, HOLD));
    await svc(U.admin, (tx, p) => setCompany(tx, p, g, D.co, true));
    await svc(U.admin, (tx, p) => deleteGroup(tx, p, g));
    expect(await isCompany(D.co)).toBe(false);
    expect((await owner.query(`SELECT count(*)::int AS n FROM organizations WHERE id = ANY($1)`, [[HOLD, SUB]])).rows[0].n).toBe(2);
    expect((await owner.query(`SELECT count(*)::int AS n FROM actions WHERE org_id = ANY($1)`, [[HOLD, SUB]])).rows[0].n).toBe(9);
    expect((await owner.query(`SELECT meta FROM audit_log WHERE action = 'client_group.delete'`)).rows[0].meta).toEqual({ members: 2 });
  });
});

describe("the group page", () => {
  it("pools the counts of every member company, whichever form it takes, with a row per company", async () => {
    const g = await makeGroup();
    const o = await svc(U.admin, (tx, p) => groupOverview(tx, p, g, TODAY));
    // 8 released actions across the group, 3 verified: 37.5%, not the average of the companies' rates.
    expect(o.total).toMatchObject({ total: 8, verified: 3, open: 5, overdue: 1, blocked: 1, implementedPct: 37.5 });
    expect(o.companies.map((c) => [c.kind, c.client.id, c.unit?.id ?? null, c.hasUnits, c.numbers.total, c.numbers.verified, c.numbers.implementedPct])).toEqual([
      // The holding: its operating company inside it, then its own work outside it (HR and company-wide).
      ["unit", HOLD, D.co, false, 2, 1, 50],
      ["client", HOLD, null, true, 3, 1, 33.3],
      ["client", SUB, null, false, 3, 1, 33.3],
    ]);
    expect(o.can.manage).toBe(true);
    // The admin can link clients in no group yet.
    expect(o.candidates.map((c) => c.id)).toEqual([OTHER]);
    expect(o.members.find((m) => m.id === HOLD)!.departments.map((d) => d.id)).toEqual([D.hr]);
  });

  it("shows a consultant only the member clients they are assigned to", async () => {
    const g = await makeGroup();
    const o = await svc(U.subCons, (tx, p) => groupOverview(tx, p, g, TODAY));
    expect(o.members.map((m) => m.id)).toEqual([SUB]);
    expect(o.companies.map((c) => c.client.id)).toEqual([SUB]);
    expect(o.total).toMatchObject({ total: 3, verified: 1 });
    expect(o.can.manage).toBe(false);
    expect(o.candidates).toEqual([]);
    expect((await svc(U.subCons, (tx, p) => listGroups(tx, p))).map((x) => [x.id, x.members.map((m) => m.id)])).toEqual([[g, [SUB]]]);
    // Straight to the database, too.
    expect((await sql(U.subCons, `SELECT client_org_id FROM client_group_members`)).rows).toEqual([{ client_org_id: SUB }]);
    expect((await sql(U.subCons, `SELECT * FROM departments WHERE id = $1`, [D.co])).rows).toEqual([]);

    // The holding's lead sees the holding and its company, not the subsidiary.
    const h = await svc(U.holdLead, (tx, p) => groupOverview(tx, p, g, TODAY));
    expect(h.companies.map((c) => [c.kind, c.client.id])).toEqual([
      ["unit", HOLD],
      ["client", HOLD],
    ]);
  });

  it("is closed to a consultant on none of its clients and to every client person", async () => {
    const g = await makeGroup();
    expect(await svc(U.stranger, (tx, p) => listGroups(tx, p))).toEqual([]);
    expect(await refused(svc(U.stranger, (tx, p) => groupOverview(tx, p, g, TODAY)))).toMatch(/not found/);
    for (const who of [U.stranger, U.hadmin, U.sadmin]) {
      expect((await sql(who, `SELECT * FROM client_groups`)).rows).toEqual([]);
      expect((await sql(who, `SELECT * FROM client_group_members`)).rows).toEqual([]);
    }
    for (const who of [U.hadmin, U.sadmin]) {
      expect(await svc(who, (tx, p) => listGroups(tx, p))).toEqual([]);
      expect(await refused(svc(who, (tx, p) => groupOverview(tx, p, g, TODAY)))).toMatch(/not found/);
      expect(await refused(sql(who, `INSERT INTO client_groups (firm_org_id, name_ar) VALUES ($1,'x')`, [FIRM]))).toMatch(/row-level security/);
    }
    // The subsidiary never sees its sibling, nor the sibling the subsidiary.
    expect((await sql(U.sadmin, `SELECT id FROM organizations WHERE id = $1`, [HOLD])).rows).toEqual([]);
    expect((await sql(U.hadmin, `SELECT id FROM organizations WHERE id = $1`, [SUB])).rows).toEqual([]);
  });
});
