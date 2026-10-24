// A read-only observer on a project (migration 0034, wave 1 N6): who may be
// one, what they read and write, and how the rest of the team's rules leave
// them out, against a real Postgres.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorize, type Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { OBSERVER_READ_ONLY_TABLES } from "@/lib/observers";
import { canWriteContacts, createContact } from "@/services/accounts";
import { loadPrincipal } from "@/services/principal";
import { getProjectTeam, staffProject } from "@/services/staffing";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 3 });

const id = (n: number) => `00000000-0000-4000-f902-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const PROJ = id(3); // Acme's project
const INT = id(4); // the firm's own project, led by U.cons
const REC = id(5);
const ACT = id(6); // open, on Acme's project
const REVIEW = id(7); // waiting for review on Acme's project
const U = {
  admin: id(11),
  lead: id(12), // Acme's lead
  cons: id(13), // staffed on Acme's project, leads the internal one
  obs: id(14), // on Acme's team; becomes the observer
  other: id(15), // a consultant not on Acme's team
  cmgr: id(16),
  cowner: id(17),
};

async function as<T>(userId: string, fn: (c: PoolClient) => Promise<T>, commit = false): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
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
const run = (userId: string, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params), true);
const attempt = (userId: string, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params));
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    true,
  );
const principal = (userId: string) => svc(userId, async (_tx, p) => p);
const observing = async (uid: string, pid: string) =>
  (await owner.query(`SELECT observer FROM project_members WHERE project_id = $1 AND user_id = $2`, [pid, uid])).rows[0]?.observer;
const OBSERVED = /you observe this project/;

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme')`, [FIRM, ACME]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$8,'firm_admin'), ($2,$8,'consultant'), ($3,$8,'consultant'), ($4,$8,'consultant'), ($5,$8,'consultant'),
      ($6,$9,'client_manager'), ($7,$9,'action_owner')`,
    [U.admin, U.lead, U.cons, U.obs, U.other, U.cmgr, U.cowner, FIRM, ACME],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state) VALUES
      ($1,'client',$2,$3,'Acme governance','active'), ($4,'internal',$3,$3,'Our method','active')`,
    [PROJ, ACME, FIRM, INT],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($1,$3,false), ($1,$4,false)`, [
    ACME,
    U.lead,
    U.cons,
    U.obs,
  ]);
  await q(`INSERT INTO project_members (project_id, user_id, is_lead) VALUES ($1,$2,false), ($1,$3,false), ($1,$4,false), ($5,$2,true)`, [
    PROJ,
    U.cons,
    U.cmgr,
    U.cowner,
    INT,
  ]);
  await q(`INSERT INTO recommendations (id, project_id, org_id, title, created_by, visibility) VALUES ($1,$2,$3,'Charter',$4,'shared')`, [
    REC,
    PROJ,
    ACME,
    U.cons,
  ]);
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, created_by) VALUES
      ($1,$3,$4,$5,'Sign the charter',$6,'in_progress',$7), ($2,$3,$4,$5,'Board minutes',$6,'awaiting_review',$7)`,
    [ACT, REVIEW, PROJ, ACME, REC, U.cowner, U.cons],
  );
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("who may observe", () => {
  it("whoever staffs the project adds a colleague from the client's team as an observer", async () => {
    await svc(U.lead, (tx, p) => staffProject(tx, p, PROJ, U.obs, true));
    expect(await observing(U.obs, PROJ)).toBe(true);
    const team = await svc(U.lead, (tx, p) => getProjectTeam(tx, p, PROJ));
    expect(team!.firm.find((m) => m.userId === U.obs)).toMatchObject({
      observer: true,
      isLead: false,
    });
    const told = await owner.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'project.staffed' AND entity_id = $2`, [
      U.obs,
      PROJ,
    ]);
    expect(told.rowCount).toBe(1);
  });

  it("only a firm consultant, never the client's lead, never a lead, never someone with open work there", async () => {
    await expect(
      run(U.admin, `INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,true)`, [PROJ, U.admin]),
    ).rejects.toThrow(/observer is a consultant of the firm/);
    await expect(
      run(U.admin, `UPDATE project_members SET observer = true WHERE project_id = $1 AND user_id = $2`, [PROJ, U.cmgr]),
    ).rejects.toThrow(/observer is a consultant of the firm/);
    await expect(
      run(U.admin, `INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,true)`, [PROJ, U.lead]),
    ).rejects.toThrow(/lead or deputy consultant works on its projects/);
    await expect(
      run(U.admin, `UPDATE project_members SET observer = true WHERE project_id = $1 AND user_id = $2`, [INT, U.cons]),
    ).rejects.toThrow(/project_member_observer_not_lead/);
    // A consultant who owns open work on the internal project is not made an observer there.
    await owner.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [INT, U.other]);
    const aid = id(30);
    await owner.query(
      `INSERT INTO recommendations (id, project_id, org_id, title, created_by, visibility) VALUES ($1,$2,$3,'Method',$4,'shared')`,
      [id(31), INT, FIRM, U.cons],
    );
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, created_by) VALUES ($1,$2,$3,$6,'Write the method',$4,'in_progress',$5)`,
      [aid, INT, FIRM, U.other, U.cons, id(31)],
    );
    await expect(
      run(U.cons, `UPDATE project_members SET observer = true WHERE project_id = $1 AND user_id = $2`, [INT, U.other]),
    ).rejects.toThrow(/hand over their open actions/);
    await owner.query(`DELETE FROM actions WHERE id = $1`, [aid]);
  });

  it("someone off the client's team is not added to its project, observer or not", async () => {
    await expect(svc(U.lead, (tx, p) => staffProject(tx, p, PROJ, U.other, true))).rejects.toThrow(/client's team first/);
  });
});

describe("what an observer does", () => {
  it("reads the project and its records", async () => {
    const seen = await attempt(
      U.obs,
      `SELECT app_can_see_project($1) AS v, (SELECT count(*) FROM actions WHERE project_id = $1)::int AS n`,
      [PROJ],
    );
    expect(seen.rows[0]).toEqual({ v: true, n: 2 });
    const p = await principal(U.obs);
    const resource = {
      type: "action" as const,
      id: ACT,
      orgId: ACME,
      firmOrgId: FIRM,
      projectId: PROJ,
      projectKind: "client" as const,
      clientOrgId: ACME,
    };
    expect(authorize(p, "action.read", resource).allowed).toBe(true);
    expect(authorize(p, "action_note.create", resource).allowed).toBe(true);
    expect(authorize(p, "action.review", resource)).toMatchObject({
      allowed: false,
      reason: "project:observer",
    });
    expect(
      authorize(p, "recommendation.write", {
        ...resource,
        type: "recommendation",
      }),
    ).toMatchObject({ allowed: false, reason: "project:observer" });
  });

  it("writes nothing in the record: no recommendations, no moves, no reviews, no files", async () => {
    await expect(
      attempt(U.obs, `INSERT INTO recommendations (project_id, org_id, title, created_by, visibility) VALUES ($1,$2,'Mine',$3,'shared')`, [
        PROJ,
        ACME,
        U.obs,
      ]),
    ).rejects.toThrow(OBSERVED);
    await expect(attempt(U.obs, `UPDATE actions SET due_date = '2027-01-31' WHERE id = $1`, [REVIEW])).rejects.toThrow(OBSERVED);
    await expect(attempt(U.obs, `UPDATE recommendations SET title = 'Changed' WHERE id = $1`, [REC])).rejects.toThrow(OBSERVED);
  });

  it("comments: adds notes on actions", async () => {
    const r = await attempt(
      U.obs,
      `INSERT INTO action_notes (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'Worth a second look')`,
      [PROJ, ACME, ACT, U.obs],
    );
    expect(r.rowCount).toBe(1);
  });

  it("keeps the client's contacts as they are: no add, edit or remove (review M05)", async () => {
    expect(await svc(U.obs, (tx, p) => canWriteContacts(tx, p, ACME))).toBe(false);
    await expect(svc(U.obs, (tx, p) => createContact(tx, p, ACME, { name: "Board secretary" }))).rejects.toThrow(/forbidden/);
    // Someone working on the client's projects still can.
    expect(await svc(U.cons, (tx, p) => canWriteContacts(tx, p, ACME))).toBe(true);
  });

  it("the same consultant writes freely on a project they work on", async () => {
    await owner.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [INT, U.obs]);
    const r = await attempt(
      U.obs,
      `INSERT INTO recommendations (project_id, org_id, title, created_by, visibility) VALUES ($1,$2,'Ours',$3,'shared')`,
      [INT, FIRM, U.obs],
    );
    expect(r.rowCount).toBe(1);
    const p = await principal(U.obs);
    expect(p.observedProjectIds?.has(PROJ)).toBe(true);
    expect(p.observedProjectIds?.has(INT)).toBe(false);
  });

  it("owns no actions, gets no team work notifications, and does no reviews", async () => {
    await owner.query(
      `INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,true) ON CONFLICT (project_id, user_id) DO UPDATE SET observer = true`,
      [INT, U.other],
    );
    await expect(
      run(
        U.cons,
        `INSERT INTO actions (project_id, org_id, title, owner_user_id, status, created_by) VALUES ($1,$2,'x',$3,'assigned',$4)`,
        [INT, FIRM, U.other, U.cons],
      ),
    ).rejects.toThrow(/active member of the project team/);
    // Not granted to the app: the notifying functions call it. Asked as the admin.
    const c = await owner.connect();
    let audience: string[];
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('selah.user_id', $1, true)", [U.admin]);
      audience = (await c.query(`SELECT u FROM app_project_audience($1) u`, [PROJ])).rows.map((r) => r.u);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
    expect(audience).toContain(U.cons);
    expect(audience).not.toContain(U.obs);
    const holds = await owner.query(`SELECT kind FROM app_person_holdings_of($1) WHERE kind = 'review'`, [U.cons]);
    expect(holds.rowCount).toBe(0); // the client's lead can review too
    // The lead steps off Acme and U.cons leads it: now nobody else there can review.
    await owner.query(`BEGIN;
      DELETE FROM client_assignments WHERE client_org_id = '${ACME}' AND user_id = '${U.lead}';
      UPDATE client_assignments SET is_lead = true WHERE client_org_id = '${ACME}' AND user_id = '${U.cons}';
      COMMIT`);
    expect(await observing(U.obs, PROJ)).toBe(true);
    const sole = await owner.query(`SELECT kind FROM app_person_holdings_of($1) WHERE kind = 'review'`, [U.cons]);
    expect(sole.rowCount).toBe(1); // the observer does not count as a reviewer
  });

  it("stops observing on becoming the client's lead", async () => {
    await as(
      U.admin,
      async (c) => {
        await c.query(`UPDATE client_assignments SET is_lead = false WHERE client_org_id = $1`, [ACME]);
        await c.query(`UPDATE client_assignments SET is_lead = true WHERE client_org_id = $1 AND user_id = $2`, [ACME, U.obs]);
      },
      true,
    );
    expect(await observing(U.obs, PROJ)).toBe(false);
  });
});

describe("the database matches lib/observers.ts", () => {
  it("OBSERVER_READ_ONLY_TABLES are the tables with the project_observer trigger", async () => {
    const r = await owner.query(
      `SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname = 'project_observer' ORDER BY c.relname`,
    );
    expect(r.rows.map((x) => x.relname)).toEqual([...OBSERVER_READ_ONLY_TABLES].sort());
  });
});
