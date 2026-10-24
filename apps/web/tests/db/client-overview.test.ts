// A client's progress across its projects (F30) against a real Postgres:
// counts pooled across projects (never averaged), each reader counting only
// the work they could open, and who may read it at all.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { clientOverview } from "@/services/client-overview";
import { loadPrincipal } from "@/services/principal";
import { listActions } from "@/services/queries";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-a300-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const OTHER = id(3);
const U = {
  admin: id(11),
  lead: id(12), // leads Acme: every Acme project
  cons: id(13), // on Acme's team, staffed on the second project only
  stranger: id(14), // a consultant not on Acme's team
  cadmin: id(15),
  cmgr: id(16), // Acme manager in HR, on both projects
  doer: id(17), // Acme action owner
  oadmin: id(18), // the other client's admin
};
const P = { one: id(21), two: id(22), other: id(23) };
const DEPT = { hr: id(31), fin: id(32) };
const TODAY = "2026-10-20";
let n = 100;
const next = () => id(++n);

async function svc<R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>): Promise<R> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    const tx = drizzle(c, { schema }) as unknown as Tx;
    return await fn(tx, (await loadPrincipal(tx, userId))!);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}
const overview = (userId: string, client = ACME) => svc(userId, (tx, p) => clientOverview(tx, p, client, TODAY));

async function action(project: string, org: string, status: string, fields: { dept?: string; due?: string } = {}) {
  const rec = (await owner.query(`SELECT id FROM recommendations WHERE project_id = $1`, [project])).rows[0].id;
  await owner.query(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, department_id, status, due_date, created_by)
     VALUES ($1,$2,$3,$4,'Work',$5,$6,$7,$8,$9)`,
    [next(), project, org, rec, org === ACME ? U.doer : null, fields.dept ?? null, status, fields.due ?? null, U.lead],
  );
}

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode, departments_enabled) VALUES
      ($1,'firm','firm',NULL,false), ($2,'client','Acme',NULL,true), ($3,'client','Other',NULL,false)`,
    [FIRM, ACME, OTHER],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$9,'firm_admin'), ($2,$9,'consultant'), ($3,$9,'consultant'), ($4,$9,'consultant'),
      ($5,$10,'client_admin'), ($6,$10,'client_manager'), ($7,$10,'action_owner'), ($8,$11,'client_admin')`,
    [U.admin, U.lead, U.cons, U.stranger, U.cadmin, U.cmgr, U.doer, U.oadmin, FIRM, ACME, OTHER],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($1,$3,false), ($4,$2,true)`, [
    ACME,
    U.lead,
    U.cons,
    OTHER,
  ]);
  for (const [pid, org, seq] of [
    [P.one, ACME, 1],
    [P.two, ACME, 2],
    [P.other, OTHER, 1],
  ] as const) {
    await q(
      `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, sequence, created_by) VALUES ($1,'client',$2,$3,$4,'active',$5,$6)`,
      [pid, org, FIRM, `Phase ${seq}`, seq, U.admin],
    );
    await q(`INSERT INTO recommendations (project_id, org_id, title, created_by) VALUES ($1,$2,'Charter',$3)`, [pid, org, U.lead]);
  }
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$3), ($2,$4), ($1,$5), ($2,$5), ($1,$6), ($2,$6)`, [
    P.one,
    P.two,
    U.lead,
    U.cons,
    U.cmgr,
    U.doer,
  ]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3)`, [P.other, U.lead, U.oadmin]);
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$3,'الموارد البشرية','HR'), ($2,$3,'المالية','Finance')`, [
    DEPT.hr,
    DEPT.fin,
    ACME,
  ]);
  await q(`INSERT INTO department_members (department_id, user_id) VALUES ($1,$2)`, [DEPT.hr, U.cmgr]);

  // Phase 1: 1 of 2 verified (50%), one in each department.
  await action(P.one, ACME, "verified_complete", { dept: DEPT.hr });
  await action(P.one, ACME, "blocked", { dept: DEPT.fin, due: "2026-10-01" });
  // Phase 2: 1 of 8 verified (12.5%), company-wide; two overdue, one awaiting review, a draft that doesn't count.
  await action(P.two, ACME, "verified_complete");
  for (let i = 0; i < 4; i++) await action(P.two, ACME, "in_progress");
  await action(P.two, ACME, "in_progress", { due: "2026-10-01" });
  await action(P.two, ACME, "assigned", { due: "2026-10-19" });
  await action(P.two, ACME, "awaiting_review");
  await action(P.two, ACME, "draft");
  // The other client's work never mixes in.
  await action(P.other, OTHER, "verified_complete");
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("a client's progress across projects", () => {
  it("pools the counts of its projects instead of averaging their percentages", async () => {
    const o = await overview(U.lead);
    expect(o.total).toMatchObject({ total: 10, verified: 2, open: 8, overdue: 3, blocked: 1, awaitingReview: 1, implementedPct: 20 });
    expect(o.projects.map((p) => [p.title, p.numbers.total, p.numbers.implementedPct])).toEqual([
      ["Phase 1", 2, 50],
      ["Phase 2", 8, 12.5],
    ]);
    // The average of 50% and 12.5% would be 31.25%; the pooled figure is 2 of 10.
    expect(o.total.implementedPct).not.toBe((50 + 12.5) / 2);
  });

  it("puts each department and the company-wide work beside the total", async () => {
    const o = await overview(U.cadmin);
    const by = Object.fromEntries(o.departments.map((d) => [d.name?.nameEn ?? "none", d.numbers.total]));
    expect(by).toEqual({ HR: 1, Finance: 1, none: 8 });
    expect(o.departments.at(-1)?.id).toBeNull();
    // Without departments the breakdown is left out.
    await owner.query(`UPDATE organizations SET departments_enabled = false WHERE id = $1`, [ACME]);
    try {
      expect((await overview(U.cadmin)).departments).toEqual([]);
    } finally {
      await owner.query(`UPDATE organizations SET departments_enabled = true WHERE id = $1`, [ACME]);
    }
  });

  it("counts only what each reader could open", async () => {
    // A consultant staffed on phase 2 only.
    const cons = await overview(U.cons);
    expect(cons.projects.map((p) => p.id)).toEqual([P.two]);
    expect(cons.total.total).toBe(8);
    // A manager in HR: not Finance's action.
    const mgr = await overview(U.cmgr);
    expect(mgr.total.total).toBe(9);
    expect(mgr.departments.map((d) => d.name?.nameEn ?? "none")).toEqual(["HR", "none"]);
  });

  it("is read by the client's team and its admins and managers, nobody else", async () => {
    for (const who of [U.admin, U.lead, U.cons, U.cadmin, U.cmgr]) await expect(overview(who)).resolves.toBeTruthy();
    for (const who of [U.stranger, U.doer, U.oadmin]) await expect(overview(who), who).rejects.toThrow();
    await expect(overview(U.lead, FIRM)).rejects.toThrow();
  });

  it("lists the client's actions across its projects only", async () => {
    const rows = await svc(U.lead, (tx, p) => listActions(tx, p, { clientOrgId: ACME }));
    expect(new Set(rows.map((r) => r.projectId))).toEqual(new Set([P.one, P.two]));
  });
});
