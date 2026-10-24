// Restructures (F31) against a real Postgres: moving a department's
// unfinished work to another moves what is still to do, keeps finished work
// and closed projects where they were, logs it on each project and in the
// audit log, and is the firm admin's alone.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { departmentWorkToMove, moveDepartmentWork } from "@/services/engagement";
import { loadPrincipal } from "@/services/principal";
import { getActionDetail } from "@/services/queries";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-a400-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const OTHER = id(3);
const U = { admin: id(11), lead: id(12), cadmin: id(13), oadmin: id(14) };
const P = { open: id(21), closed: id(22), other: id(23) };
const D = { fin: id(31), treasury: id(32), hr: id(33), otherDept: id(34) };
// Recommendations and actions, named for what should happen to them.
const R = { busy: id(41), done: id(42), unplanned: id(43), wide: id(44), frozen: id(45) };
const A = { busyOpen: id(51), busyDone: id(52), doneDone: id(53), wideOpen: id(54), wideDone: id(55), frozenOpen: id(56) };
const DOC = id(61);

async function svc<R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>, commit = false): Promise<R> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    const tx = drizzle(c, { schema }) as unknown as Tx;
    const out = await fn(tx, (await loadPrincipal(tx, userId))!);
    await c.query(commit ? "COMMIT" : "ROLLBACK");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

const deptOf = async (table: "recommendations" | "actions" | "documents", rowId: string) =>
  (await owner.query(`SELECT department_id FROM ${table} WHERE id = $1`, [rowId])).rows[0].department_id as string | null;

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode, departments_enabled) VALUES
      ($1,'firm','firm',NULL,false), ($2,'client','Acme',NULL,true), ($3,'client','Other',NULL,true)`,
    [FIRM, ACME, OTHER],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$5,'firm_admin'), ($2,$5,'consultant'), ($3,$6,'client_admin'), ($4,$7,'client_admin')`,
    [U.admin, U.lead, U.cadmin, U.oadmin, FIRM, ACME, OTHER],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [ACME, U.lead]);
  for (const [pid, org, seq] of [
    [P.open, ACME, 1],
    [P.closed, ACME, 2],
    [P.other, OTHER, 1],
  ] as const) {
    await q(
      `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, sequence, created_by) VALUES ($1,'client',$2,$3,$4,'active',$5,$6)`,
      [pid, org, FIRM, `Phase ${seq}`, seq, U.admin],
    );
  }
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$3), ($2,$3)`, [P.open, P.closed, U.lead]);
  await q(
    `INSERT INTO departments (id, org_id, name_ar, name_en) VALUES
      ($1,$5,'المالية','Finance'), ($2,$5,'الخزينة','Treasury'), ($3,$5,'الموارد البشرية','HR'), ($4,$6,'المالية','Finance')`,
    [D.fin, D.treasury, D.hr, D.otherDept, ACME, OTHER],
  );
  const rec = (rid: string, project: string, dept: string | null) =>
    q(`INSERT INTO recommendations (id, project_id, org_id, title, department_id, created_by) VALUES ($1,$2,$3,'Rec',$4,$5)`, [
      rid,
      project,
      ACME,
      dept,
      U.lead,
    ]);
  const act = (aid: string, project: string, rid: string, dept: string, status: string) =>
    q(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, department_id, status, created_by) VALUES ($1,$2,$3,$4,'Work',$5,$6,$7)`,
      [aid, project, ACME, rid, dept, status, U.lead],
    );
  await rec(R.busy, P.open, D.fin);
  await act(A.busyOpen, P.open, R.busy, D.fin, "in_progress");
  await act(A.busyDone, P.open, R.busy, D.fin, "verified_complete");
  await rec(R.done, P.open, D.fin);
  await act(A.doneDone, P.open, R.done, D.fin, "verified_complete");
  await rec(R.unplanned, P.open, D.fin);
  await rec(R.wide, P.open, null);
  await act(A.wideOpen, P.open, R.wide, D.fin, "blocked");
  await act(A.wideDone, P.open, R.wide, D.fin, "verified_complete");
  await rec(R.frozen, P.closed, D.fin);
  await act(A.frozenOpen, P.closed, R.frozen, D.fin, "assigned");
  await q(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, department_id, storage_key, content_type, size_bytes, sha256, scan_status)
     VALUES ($1,$2,$3,$3,$4,'evidence','submitted','f.pdf','shared',$5,'k','application/pdf',1,'x','clean')`,
    [DOC, P.open, ACME, U.cadmin, D.fin],
  );
  await q(`INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by) VALUES ($1,$2,$3,$4,$5)`, [
    P.open,
    ACME,
    A.busyOpen,
    DOC,
    U.cadmin,
  ]);
  // Closing itself is tested in tests/db/closure.test.ts; here the project is simply closed.
  await q(`UPDATE projects SET state = 'closed' WHERE id = $1`, [P.closed]);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("moving a department's work", () => {
  it("counts what would move without moving it", async () => {
    const counts = await svc(U.admin, (tx, p) => departmentWorkToMove(tx, p, D.fin));
    expect(counts).toEqual({ recommendations: 2, actions: 3, files: 1 });
    expect(await deptOf("actions", A.busyOpen)).toBe(D.fin);
  });

  it("is the firm admin's alone, within the same client", async () => {
    for (const who of [U.lead, U.cadmin, U.oadmin]) {
      await expect(svc(who, (tx, p) => departmentWorkToMove(tx, p, D.fin))).rejects.toThrow();
      await expect(svc(who, (tx, p) => moveDepartmentWork(tx, p, D.fin, { to: D.treasury, switchOff: false }))).rejects.toThrow();
    }
    // The database refuses on its own, too.
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('selah.user_id', $1, true)", [U.cadmin]);
      await expect(c.query(`SELECT * FROM app_move_department_work($1, $2, false, false)`, [D.fin, D.treasury])).rejects.toThrow(
        /only the firm admin/,
      );
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
    for (const to of [D.fin, D.otherDept]) {
      await expect(svc(U.admin, (tx, p) => moveDepartmentWork(tx, p, D.fin, { to, switchOff: false }))).rejects.toThrow(
        /another active department/,
      );
    }
    await owner.query(`UPDATE departments SET active = false WHERE id = $1`, [D.hr]);
    await expect(svc(U.admin, (tx, p) => moveDepartmentWork(tx, p, D.fin, { to: D.hr, switchOff: false }))).rejects.toThrow(
      /another active department/,
    );
  });

  it("moves the unfinished work, keeps the finished work, and switches the old department off", async () => {
    const moved = await svc(U.admin, (tx, p) => moveDepartmentWork(tx, p, D.fin, { to: D.treasury, switchOff: true }), true);
    expect(moved).toEqual({ recommendations: 2, actions: 3, files: 1 });

    // A recommendation with work still to do, or none planned, moves whole.
    expect(await deptOf("recommendations", R.busy)).toBe(D.treasury);
    expect(await deptOf("actions", A.busyOpen)).toBe(D.treasury);
    expect(await deptOf("actions", A.busyDone)).toBe(D.treasury);
    expect(await deptOf("recommendations", R.unplanned)).toBe(D.treasury);
    // Finished work stays where it was done.
    expect(await deptOf("recommendations", R.done)).toBe(D.fin);
    expect(await deptOf("actions", A.doneDone)).toBe(D.fin);
    // Under a company-wide recommendation, only the unfinished action moves.
    expect(await deptOf("recommendations", R.wide)).toBeNull();
    expect(await deptOf("actions", A.wideOpen)).toBe(D.treasury);
    expect(await deptOf("actions", A.wideDone)).toBe(D.fin);
    // A closed project is frozen.
    expect(await deptOf("recommendations", R.frozen)).toBe(D.fin);
    expect(await deptOf("actions", A.frozenOpen)).toBe(D.fin);
    // Evidence follows its action.
    expect(await deptOf("documents", DOC)).toBe(D.treasury);
    expect((await owner.query(`SELECT active FROM departments WHERE id = $1`, [D.fin])).rows[0].active).toBe(false);

    const events = (await owner.query(`SELECT project_id, meta FROM activity_events WHERE event = 'department_moved'`)).rows;
    expect(events).toHaveLength(1);
    expect(events[0].project_id).toBe(P.open);
    expect(events[0].meta.from).toBe(D.fin);
    expect(events[0].meta.to).toBe(D.treasury);
    expect([...events[0].meta.actions].sort()).toEqual([A.busyDone, A.busyOpen, A.wideOpen].sort());
    const logged = (await owner.query(`SELECT actor_id, meta FROM audit_log WHERE action = 'department.move_work' AND resource_id = $1`, [D.fin]))
      .rows;
    expect(logged).toHaveLength(1);
    expect(logged[0].actor_id).toBe(U.admin);
    expect(logged[0].meta).toMatchObject({ to: D.treasury, recommendations: 2, actions: 3, files: 1, switchedOff: true });
  });

  it("shows the move in each moved action's history, naming both departments", async () => {
    const detail = await svc(U.lead, (tx, p) => getActionDetail(tx, p, A.wideOpen));
    const entry = detail.timeline.find((e) => e.kind === "moved");
    expect(entry).toMatchObject({ kind: "moved", who: "admin", from: { nameEn: "Finance" }, to: { nameEn: "Treasury" } });
    const untouched = await svc(U.lead, (tx, p) => getActionDetail(tx, p, A.doneDone));
    expect(untouched.timeline.some((e) => e.kind === "moved")).toBe(false);
  });

  it("can move work out of a switched-off department, and finds nothing left the second time", async () => {
    await owner.query(`UPDATE departments SET active = true WHERE id = $1`, [D.hr]);
    const left = await svc(U.admin, (tx, p) => departmentWorkToMove(tx, p, D.fin));
    expect(left).toEqual({ recommendations: 0, actions: 0, files: 0 });
    const back = await svc(U.admin, (tx, p) => moveDepartmentWork(tx, p, D.treasury, { to: D.hr, switchOff: false }));
    expect(back).toEqual({ recommendations: 2, actions: 3, files: 1 });
  });
});
