// Several projects per client and the client's own people on them (wave 1,
// items 1 and 2) against a real Postgres: who may create a client project,
// the "follows" chain, who may put client people on a project, what that
// opens, and that nobody comes off while they own open actions.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { loadPrincipal } from "@/services/principal";
import {
  addProjectPerson,
  createClientProject,
  getClientTeam,
  getProjectPeople,
  removeProjectPerson,
  updateProject,
} from "@/services/staffing";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c100-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const MANAGED = id(4); // consultant-managed
const U = {
  admin: id(11),
  lead: id(12), // Acme's lead
  cons: id(13), // on Acme's team, staffed on PROJ
  betaLead: id(14),
  cadmin: id(15),
  cmgr: id(16),
  cowner: id(17),
  cowner2: id(18),
  betaAdmin: id(19),
  betaMgr: id(20),
};
const PROJ = id(31);
const BETA_PROJ = id(32);
const MANAGED_PROJ = id(33);
const REC = id(41);

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
const attempt = (userId: string, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params));
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>, commit = true) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    commit,
  );
const canSee = async (userId: string, projectId: string) =>
  (await attempt(userId, `SELECT 1 FROM projects WHERE id = $1`, [projectId])).rowCount === 1;

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode) VALUES ($1,'firm','firm',NULL), ($2,'client','Acme','full'),
      ($3,'client','Beta','full'), ($4,'client','Managed','consultant_managed')`,
    [FIRM, ACME, BETA, MANAGED],
  );
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  const member = (uid: string, org: string, role: string) =>
    q(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,$3)`, [uid, org, role]);
  await member(U.admin, FIRM, "firm_admin");
  for (const c of [U.lead, U.cons, U.betaLead]) await member(c, FIRM, "consultant");
  await member(U.cadmin, ACME, "client_admin");
  await member(U.cmgr, ACME, "client_manager");
  await member(U.cowner, ACME, "action_owner");
  await member(U.cowner2, ACME, "action_owner");
  await member(U.betaAdmin, BETA, "client_admin");
  await member(U.betaMgr, BETA, "client_manager");
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, sequence, created_by) VALUES
      ($1,'client',$4,$7,'Diagnosis','active',1,$8), ($2,'client',$5,$7,'Beta strategy','active',NULL,$8),
      ($3,'client',$6,$7,'Managed plan','active',NULL,$8)`,
    [PROJ, BETA_PROJ, MANAGED_PROJ, ACME, BETA, MANAGED, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($1,$3,false), ($4,$5,true), ($6,$2,true)`, [
    ACME,
    U.lead,
    U.cons,
    BETA,
    U.betaLead,
    MANAGED,
  ]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [PROJ, U.cons]);
  await q(`INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES ($1,$2,$3,'Charter',$4)`, [REC, PROJ, ACME, U.cons]);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("a client with several projects", () => {
  let phase2: string;

  it("the client's lead creates the next phase, which follows the first", async () => {
    const r = await svc(U.lead, (tx, p) =>
      createClientProject(tx, p, ACME, { title: "Phase 2: framework", sequence: 2, plannedWorkingDays: 20, followsProjectId: PROJ }),
    );
    phase2 = r.id;
    const { rows } = await owner.query(`SELECT kind, state, org_id, sequence, planned_working_days, follows_project_id, created_by FROM projects WHERE id = $1`, [phase2]);
    // No engagement covers it yet, so it is a draft (0008).
    expect(rows[0]).toMatchObject({ kind: "client", state: "draft", org_id: ACME, sequence: 2, planned_working_days: 20, follows_project_id: PROJ, created_by: U.lead });
    expect(await canSee(U.lead, phase2)).toBe(true);
    // A consultant on the team but not staffed doesn't see the new project.
    expect(await canSee(U.cons, phase2)).toBe(false);
  });

  it("lists the client's projects in phase order", async () => {
    const team = await svc(U.admin, (tx, p) => getClientTeam(tx, p, ACME));
    expect(team.projects.map((p) => p.title)).toEqual(["Diagnosis", "Phase 2: framework"]);
    expect(team.can.createProject).toBe(true);
    const asCons = await svc(U.cons, (tx, p) => getClientTeam(tx, p, ACME));
    expect(asCons.can.createProject).toBe(false);
  });

  it("is refused to consultants who don't lead the client, and to another client's lead", async () => {
    await expect(svc(U.cons, (tx, p) => createClientProject(tx, p, ACME, { title: "Side scope" }))).rejects.toThrow(/forbidden/);
    await expect(svc(U.betaLead, (tx, p) => createClientProject(tx, p, ACME, { title: "Side scope" }))).rejects.toThrow(/forbidden/);
    // The database refuses it too, whatever the app does.
    await expect(
      attempt(U.cons, `INSERT INTO projects (kind, org_id, firm_org_id, title, created_by) VALUES ('client',$1,$2,'x',$3)`, [ACME, FIRM, U.cons]),
    ).rejects.toThrow(/row-level security/);
    await expect(
      attempt(U.betaLead, `INSERT INTO projects (kind, org_id, firm_org_id, title, created_by) VALUES ('client',$1,$2,'x',$3)`, [ACME, FIRM, U.betaLead]),
    ).rejects.toThrow(/row-level security/);
  });

  it("follows only a project of the same client, and never loops", async () => {
    await expect(svc(U.admin, (tx, p) => createClientProject(tx, p, ACME, { title: "Odd", followsProjectId: BETA_PROJ }))).rejects.toThrow(
      /same client/,
    );
    await expect(owner.query(`UPDATE projects SET follows_project_id = $2 WHERE id = $1`, [PROJ, BETA_PROJ])).rejects.toThrow(/same client/);
    // The service lets this one through; the database's chain check refuses it.
    await expect(svc(U.admin, (tx, p) => updateProject(tx, p, PROJ, { followsProjectId: phase2 }))).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/follows it/) },
    });
    await expect(svc(U.admin, (tx, p) => updateProject(tx, p, PROJ, { followsProjectId: PROJ }))).rejects.toThrow(/same client/);
  });

  it("keeps the phase number and planned days in range", async () => {
    await expect(owner.query(`UPDATE projects SET sequence = 0 WHERE id = $1`, [PROJ])).rejects.toThrow(/projects_sequence_range/);
    await expect(owner.query(`UPDATE projects SET planned_working_days = 1001 WHERE id = $1`, [PROJ])).rejects.toThrow(/projects_planned_days_range/);
  });

  it("only the firm admin corrects a project", async () => {
    await svc(U.admin, (tx, p) => updateProject(tx, p, phase2, { plannedWorkingDays: 25, startDate: "2026-12-01", endDate: "2027-01-15" }));
    expect((await owner.query(`SELECT planned_working_days FROM projects WHERE id = $1`, [phase2])).rows[0].planned_working_days).toBe(25);
    await expect(svc(U.lead, (tx, p) => updateProject(tx, p, phase2, { title: "Renamed" }))).rejects.toThrow(/forbidden/);
    await expect(svc(U.admin, (tx, p) => updateProject(tx, p, phase2, { endDate: "2026-11-01" }))).rejects.toThrow(/before the start/);
  });
});

describe("client people on a project", () => {
  it("the client's admin adds a manager, who then sees the project", async () => {
    expect(await canSee(U.cmgr, PROJ)).toBe(false);
    await svc(U.cadmin, (tx, p) => addProjectPerson(tx, p, PROJ, U.cmgr));
    expect(await canSee(U.cmgr, PROJ)).toBe(true);
    const { rows } = await owner.query(`SELECT kind FROM notifications WHERE user_id = $1`, [U.cmgr]);
    expect(rows.map((r) => r.kind)).toContain("project.added");
  });

  it("the client's lead consultant adds an action owner, who can then own an action", async () => {
    await svc(U.lead, (tx, p) => addProjectPerson(tx, p, PROJ, U.cowner));
    expect(await canSee(U.cowner, PROJ)).toBe(true);
    await owner.query(
      `INSERT INTO actions (project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
       VALUES ($1,$2,$3,'Draft the charter',$4,'assigned','2099-01-01',$5)`,
      [PROJ, ACME, REC, U.cowner, U.cons],
    );
  });

  it("shows who is on it, what they own, and whom to add", async () => {
    const asAdmin = await svc(U.cadmin, (tx, p) => getProjectPeople(tx, p, PROJ));
    expect(asAdmin).toMatchObject({ mode: "full", can: { manage: true } });
    expect(asAdmin!.people.map((m) => [m.userId, m.openActions])).toEqual(
      expect.arrayContaining([
        [U.cmgr, 0],
        [U.cowner, 1],
      ]),
    );
    expect(asAdmin!.candidates.map((c) => c.userId).sort()).toEqual([U.cadmin, U.cowner2].sort());
    // Staffed consultants read it; only the lead and the admins change it.
    expect((await svc(U.cons, (tx, p) => getProjectPeople(tx, p, PROJ)))!.can.manage).toBe(false);
    // Managers and owners don't get the card at all.
    expect(await svc(U.cmgr, (tx, p) => getProjectPeople(tx, p, PROJ))).toBeNull();
  });

  it("nobody but the admins and the lead adds people", async () => {
    await expect(svc(U.cons, (tx, p) => addProjectPerson(tx, p, PROJ, U.cowner2))).rejects.toThrow(/forbidden/);
    await expect(svc(U.cmgr, (tx, p) => addProjectPerson(tx, p, PROJ, U.cowner2))).rejects.toThrow(/forbidden/);
    await expect(attempt(U.cmgr, `INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [PROJ, U.cowner2])).rejects.toThrow(
      /row-level security/,
    );
  });

  it("never crosses clients", async () => {
    // Beta's admin can't open Acme's project, so it looks missing.
    await expect(svc(U.betaAdmin, (tx, p) => addProjectPerson(tx, p, PROJ, U.betaMgr))).rejects.toThrow(/not found/);
    await expect(svc(U.betaLead, (tx, p) => addProjectPerson(tx, p, PROJ, U.cowner2))).rejects.toThrow(/not found/);
    // Acme's people can't be put on Beta's project, nor Beta's on Acme's.
    await expect(svc(U.admin, (tx, p) => addProjectPerson(tx, p, BETA_PROJ, U.cowner2))).rejects.toThrow(/own active people/);
    await expect(svc(U.lead, (tx, p) => addProjectPerson(tx, p, PROJ, U.betaMgr))).rejects.toThrow(/own active people/);
    await expect(attempt(U.lead, `INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [PROJ, U.betaMgr])).rejects.toThrow(
      /row-level security/,
    );
    await expect(attempt(U.cadmin, `INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [BETA_PROJ, U.cowner2])).rejects.toThrow(
      /row-level security/,
    );
  });

  it("a consultant-managed client has nobody to add", async () => {
    const people = await svc(U.lead, (tx, p) => getProjectPeople(tx, p, MANAGED_PROJ));
    expect(people).toMatchObject({ mode: "consultant_managed", people: [], candidates: [] });
  });

  it("refuses to take off someone who owns open actions, until they are reassigned", async () => {
    await expect(svc(U.cadmin, (tx, p) => removeProjectPerson(tx, p, PROJ, U.cowner))).rejects.toThrow(/reassign them first/);
    // The database holds the same rule for a direct write.
    await expect(attempt(U.cadmin, `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [PROJ, U.cowner])).rejects.toThrow(
      /reassign them first/,
    );
    await owner.query(`UPDATE actions SET owner_user_id = $2 WHERE project_id = $1 AND owner_user_id = $3`, [PROJ, U.cmgr, U.cowner]);
    await svc(U.cadmin, (tx, p) => removeProjectPerson(tx, p, PROJ, U.cowner));
    expect(await canSee(U.cowner, PROJ)).toBe(false);
  });

  it("the lead takes the client's people off, but not firm staff through this door", async () => {
    await svc(U.lead, (tx, p) => addProjectPerson(tx, p, PROJ, U.cowner2));
    await svc(U.lead, (tx, p) => removeProjectPerson(tx, p, PROJ, U.cowner2));
    await expect(svc(U.cadmin, (tx, p) => removeProjectPerson(tx, p, PROJ, U.cons))).rejects.toThrow(/not found/);
    // RLS: a client admin can't delete a consultant's membership either.
    const r = await attempt(U.cadmin, `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [PROJ, U.cons]);
    expect(r.rowCount).toBe(0);
  });
});
