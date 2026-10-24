// When people leave or change (migration 0027, wave 1 item 26): the
// departing-person report, handing work over in one step, refusing to switch
// off someone who still holds work, the last firm admin, and every client
// keeping a lead consultant, against a real Postgres.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { handOver, personHoldings, setActive } from "@/services/accounts";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 3 });

const id = (n: number) => `00000000-0000-4000-f901-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const PROJ = id(4); // Acme's project, led by U.lead
const PB = id(5); // Beta's project, U.cons is its only consultant
const REC = id(6);
const RECB = id(7);
const DEPT = id(8);
const U = {
  admin: id(11),
  lead: id(12), // leads Acme and its project
  cons: id(13), // staffed on Acme's project; Beta's lead and the only consultant staffed there
  cons2: id(14), // takes over
  cadmin: id(15),
  cmgr: id(16), // Acme's sponsor, heads a department
  cmgr2: id(17),
  cowner: id(18), // owns open actions
  bowner: id(19), // Beta's action owner
};
const A = { open: id(21), done: id(22), review: id(23) };

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
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>, commit = true) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    commit,
  );
// Drizzle wraps the database's error; the rule's own words are in the cause.
const reason = (p: Promise<unknown>) =>
  p.then(
    () => "",
    (e: Error & { cause?: Error }) => e.cause?.message ?? e.message,
  );
const kinds = async (uid: string) =>
  (await owner.query(`SELECT kind, blocking FROM app_person_holdings_of($1) ORDER BY kind`, [uid])).rows.map(
    (r) => `${r.kind}${r.blocking ? "!" : ""}`,
  );

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name, name_ar) VALUES ($1,'firm','firm',NULL), ($2,'client','Acme','أكمي'), ($3,'client','Beta',NULL)`, [
    FIRM,
    ACME,
    BETA,
  ]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$10,'firm_admin'), ($2,$10,'consultant'), ($3,$10,'consultant'), ($4,$10,'consultant'),
      ($5,$11,'client_admin'), ($6,$11,'client_manager'), ($7,$11,'client_manager'), ($8,$11,'action_owner'),
      ($9,$12,'action_owner')`,
    [U.admin, U.lead, U.cons, U.cons2, U.cadmin, U.cmgr, U.cmgr2, U.cowner, U.bowner, FIRM, ACME, BETA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state) VALUES
      ($1,'client',$2,$3,'Acme governance','active'), ($4,'client',$5,$3,'Beta charter','active')`,
    [PROJ, ACME, FIRM, PB, BETA],
  );
  // U.cons2 is on Beta's team without being staffed, so cannot review there.
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($1,$3,false), ($4,$3,true), ($4,$5,false)`, [
    ACME,
    U.lead,
    U.cons,
    BETA,
    U.cons2,
  ]);
  await q(
    `INSERT INTO project_members (project_id, user_id, is_lead) VALUES
      ($1,$2,true), ($1,$3,false), ($1,$4,false), ($1,$5,false), ($6,$3,false), ($6,$7,false)`,
    [PROJ, U.lead, U.cons, U.cmgr, U.cowner, PB, U.bowner],
  );
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, created_by, visibility) VALUES
      ($1,$2,$3,'Charter',$4,'shared'), ($5,$6,$7,'Charter',$4,'shared')`,
    [REC, PROJ, ACME, U.cons, RECB, PB, BETA],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, created_by) VALUES
      ($1,$4,$5,$6,'Sign the charter',$7,'in_progress',$8),
      ($2,$4,$5,$6,'Old work',$7,'verified_complete',$8),
      ($3,$9,$10,$11,'Board minutes',$12,'awaiting_review',$8)`,
    [A.open, A.done, A.review, PROJ, ACME, REC, U.cowner, U.cons, PB, BETA, RECB, U.bowner],
  );
  await q(`INSERT INTO project_client_roles (project_id, org_id, role, user_id, created_by) VALUES ($1,$2,'sponsor',$3,$4)`, [
    PROJ,
    ACME,
    U.cmgr,
    U.cons,
  ]);
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$2,'المالية','Finance')`, [DEPT, ACME]);
  await q(`INSERT INTO department_members (department_id, user_id, is_head) VALUES ($1,$2,true)`, [DEPT, U.cmgr]);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("the departing-person report", () => {
  it("lists open work, leads and sole reviews as blocking, and client roles and departments as needing an interim", async () => {
    expect(await kinds(U.cowner)).toEqual(["action!"]); // finished work is not listed
    expect(await kinds(U.lead)).toEqual(["client_lead!", "project_lead!"]);
    // Beta's lead, staffed alone there: its lead, and the review nobody else can do.
    expect(await kinds(U.cons)).toEqual(["client_lead!", "review!"]);
    expect(await kinds(U.cmgr)).toEqual(["client_role", "department_head"]);
    expect(await kinds(U.cmgr2)).toEqual([]);
  });

  it("carries the client's and department's names in both languages", async () => {
    const lead = await svc(U.admin, (tx, p) => personHoldings(tx, p, U.lead));
    expect(lead.blocking).toBe(2);
    expect(lead.items.find((i) => i.kind === "client_lead")).toMatchObject({ title: "Acme", detail: "أكمي", entityId: ACME });
    const head = await svc(U.cadmin, (tx, p) => personHoldings(tx, p, U.cmgr));
    expect(head.items.find((i) => i.kind === "department_head")).toMatchObject({ title: "Finance", detail: "المالية" });
    expect(head.items.find((i) => i.kind === "client_role")).toMatchObject({ detail: "sponsor", projectId: PROJ });
  });

  it("is for the admins who manage the person, and no one else", async () => {
    await expect(svc(U.cons, (tx, p) => personHoldings(tx, p, U.lead))).rejects.toThrow();
    await expect(svc(U.cadmin, (tx, p) => personHoldings(tx, p, U.lead))).rejects.toThrow();
    await expect(svc(U.cmgr, (tx, p) => personHoldings(tx, p, U.cowner))).rejects.toThrow();
    // Straight to the database: the gated report is empty, the raw one is not granted.
    expect((await as(U.cons, (c) => c.query(`SELECT * FROM app_person_holdings($1)`, [U.lead]))).rowCount).toBe(0);
    await expect(as(U.admin, (c) => c.query(`SELECT * FROM app_person_holdings_of($1)`, [U.lead]))).rejects.toThrow(/permission denied/);
    await expect(as(U.cons, (c) => c.query(`SELECT app_hand_over($1, $2, '{action}')`, [U.lead, U.cons2]))).rejects.toThrow(
      /not visible/,
    );
  });
});

describe("switching an account off", () => {
  it("is refused while the person still holds blocking work, by the service and by the database", async () => {
    await expect(svc(U.cadmin, (tx, p) => setActive(tx, p, U.cowner, { active: false, reason: "left" }))).rejects.toThrow(
      /hand over/,
    );
    await expect(run(U.admin, `UPDATE org_memberships SET active = false, deactivation_reason = 'left' WHERE user_id = $1`, [U.lead])).rejects.toThrow(
      /hand over what this person still holds before switching the account off \(2 items\)/,
    );
  });

  it("goes ahead with only client roles or departments left (those need an interim, not a stop)", async () => {
    const r = await svc(U.cadmin, (tx, p) => setActive(tx, p, U.cmgr, { active: false, reason: "on leave" }), false);
    expect(r.changed).toBe(true); // rolled back
  });

  it("never switches off the firm's last active admin", async () => {
    // Admins can't switch themselves off, so only a path around the app gets here.
    const c = await owner.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('selah.user_id', $1, true)", [U.cons]);
      await expect(c.query(`UPDATE org_memberships SET active = false, deactivation_reason = 'x' WHERE user_id = $1`, [U.admin])).rejects.toThrow(
        /at least one active admin/,
      );
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("does not stop jobs and migrations, which run without a person", async () => {
    const c = await owner.connect();
    try {
      await c.query("BEGIN");
      const r = await c.query(`UPDATE org_memberships SET active = false, deactivation_reason = 'x' WHERE user_id = $1`, [U.lead]);
      expect(r.rowCount).toBe(1);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
});

describe("handing work over", () => {
  it("only to an active colleague in the same organisation", async () => {
    await expect(svc(U.admin, (tx, p) => handOver(tx, p, U.lead, { to: U.lead, kinds: ["client_lead"] }))).rejects.toThrow(
      /someone else/,
    );
    expect(await reason(svc(U.admin, (tx, p) => handOver(tx, p, U.lead, { to: U.cmgr, kinds: ["client_lead"] })))).toMatch(
      /same organisation/,
    );
    await owner.query(`UPDATE org_memberships SET active = false WHERE user_id = $1`, [U.cmgr2]);
    try {
      expect(await reason(svc(U.cadmin, (tx, p) => handOver(tx, p, U.cowner, { to: U.cmgr2, kinds: ["action"] })))).toMatch(
        /same organisation/,
      );
    } finally {
      await owner.query(`UPDATE org_memberships SET active = true WHERE user_id = $1`, [U.cmgr2]);
    }
    await expect(as(U.admin, (c) => c.query(`SELECT app_hand_over($1, $2, '{everything}')`, [U.lead, U.cons2]))).rejects.toThrow(
      /unknown kind/,
    );
  });

  it("moves open actions to the new owner, who joins the team and is told", async () => {
    const r = await svc(U.cadmin, (tx, p) => handOver(tx, p, U.cowner, { to: U.cmgr2, kinds: ["action"] }));
    expect(r).toMatchObject({ moved: 1, blocking: 0, items: [] });
    const owners = (await owner.query(`SELECT id, owner_user_id FROM actions WHERE id IN ($1,$2) ORDER BY id`, [A.open, A.done])).rows;
    expect(owners).toEqual([
      { id: A.open, owner_user_id: U.cmgr2 },
      { id: A.done, owner_user_id: U.cowner }, // finished work keeps its history
    ]);
    const member = await owner.query(`SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2`, [PROJ, U.cmgr2]);
    expect(member.rowCount).toBe(1);
    const told = await owner.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'action.assigned' AND entity_id = $2`, [
      U.cmgr2,
      A.open,
    ]);
    expect(told.rowCount).toBe(1);
    const logged = await owner.query(`SELECT meta FROM audit_log WHERE action = 'membership.hand_over' AND resource_id = $1`, [U.cowner]);
    expect(logged.rows[0].meta).toMatchObject({ action: 1, to: U.cmgr2 });
    // Now nothing blocks: the account can be switched off.
    expect((await svc(U.cadmin, (tx, p) => setActive(tx, p, U.cowner, { active: false, reason: "left" }))).changed).toBe(true);
  });

  it("moves client and project leads in one step, so the client is never without one", async () => {
    const r = await svc(U.admin, (tx, p) => handOver(tx, p, U.lead, { to: U.cons2, kinds: ["client_lead", "project_lead"] }));
    expect(r).toMatchObject({ moved: 2, blocking: 0 });
    const leads = await owner.query(`SELECT user_id FROM client_assignments WHERE client_org_id = $1 AND is_lead`, [ACME]);
    expect(leads.rows).toEqual([{ user_id: U.cons2 }]);
    const pLead = await owner.query(`SELECT user_id FROM project_members WHERE project_id = $1 AND is_lead`, [PROJ]);
    expect(pLead.rows).toEqual([{ user_id: U.cons2 }]);
  });

  it("brings the receiver onto projects with reviews only the leaver could do", async () => {
    const r = await svc(U.admin, (tx, p) => handOver(tx, p, U.cons, { to: U.cons2, kinds: ["review", "client_lead"] }));
    expect(r.blocking).toBe(0);
    const member = await owner.query(`SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2`, [PB, U.cons2]);
    expect(member.rowCount).toBe(1);
    expect(await kinds(U.cons)).toEqual([]);
  });

  it("names the receiver as the interim in client roles", async () => {
    await svc(U.cadmin, (tx, p) => handOver(tx, p, U.cmgr, { to: U.cmgr2, kinds: ["client_role"] }));
    const roles = await owner.query(`SELECT role, user_id FROM project_client_roles WHERE project_id = $1`, [PROJ]);
    expect(roles.rows).toEqual([{ role: "sponsor", user_id: U.cmgr2 }]);
    // The department head is changed on the departments page, not here.
    expect(await kinds(U.cmgr)).toEqual(["department_head"]);
  });
});

describe("every client keeps a lead consultant", () => {
  it("refuses removing or unsetting the only lead, and allows moving it in one go", async () => {
    await expect(run(U.admin, `DELETE FROM client_assignments WHERE client_org_id = $1 AND is_lead`, [ACME])).rejects.toThrow(
      /needs a lead consultant/,
    );
    await expect(run(U.admin, `UPDATE client_assignments SET is_lead = false WHERE client_org_id = $1`, [ACME])).rejects.toThrow(
      /needs a lead consultant/,
    );
    await as(
      U.admin,
      async (c) => {
        await c.query(`UPDATE client_assignments SET is_lead = false WHERE client_org_id = $1 AND user_id = $2`, [ACME, U.cons2]);
        await c.query(`UPDATE client_assignments SET is_lead = true WHERE client_org_id = $1 AND user_id = $2`, [ACME, U.cons]);
      },
      true,
    );
    const leads = await owner.query(`SELECT user_id FROM client_assignments WHERE client_org_id = $1 AND is_lead`, [ACME]);
    expect(leads.rows).toEqual([{ user_id: U.cons }]);
  });

  it("lets the last consultant go together with the lead (no consultants, no lead needed)", async () => {
    const r = await as(U.admin, (c) => c.query(`DELETE FROM client_assignments WHERE client_org_id = $1`, [ACME]));
    expect(r.rowCount).toBeGreaterThan(0); // rolled back
  });
});
