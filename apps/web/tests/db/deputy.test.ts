// The deputy consultant (F18, 2026-10-24): one per client, named by the firm
// admin and logged. A full backup for the lead: the deputy can do what the
// lead can and gets the lead's alerts, while the lead stays the accountable
// name and only the admin names or removes either.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { loadPrincipal } from "@/services/principal";
import { addConsultant, getClientTeam, removeConsultant, setDeputy, setLead } from "@/services/staffing";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c1a2-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = { admin: id(11), lead: id(12), dep: id(13), other: id(14), fresh: id(15), betaLead: id(16), cadmin: id(17) };
const P = { acme: id(21), beta: id(22) };

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
const roles = async () =>
  (
    await owner.query(
      `SELECT user_id, is_lead, is_deputy FROM client_assignments WHERE client_org_id = $1 AND (is_lead OR is_deputy) ORDER BY is_lead DESC`,
      [ACME],
    )
  ).rows.map((r) => [r.user_id, r.is_lead ? "lead" : "deputy"]);

async function seed() {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode) VALUES ($1,'firm','firm',NULL), ($2,'client','Acme','full'), ($3,'client','Beta','full')`,
    [FIRM, ACME, BETA],
  );
  for (const [name, uid] of Object.entries(U))
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$8,'firm_admin'), ($2,$8,'consultant'), ($3,$8,'consultant'), ($4,$8,'consultant'), ($5,$8,'consultant'), ($6,$8,'consultant'), ($7,$9,'client_admin')`,
    [U.admin, U.lead, U.dep, U.other, U.fresh, U.betaLead, U.cadmin, FIRM, ACME],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$3,$5,'Acme governance','active',$6), ($2,'client',$4,$5,'Beta plan','active',$6)`,
    [P.acme, P.beta, ACME, BETA, FIRM, U.admin],
  );
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$3,true), ($1,$4,false), ($1,$5,false), ($2,$6,true)`,
    [ACME, BETA, U.lead, U.dep, U.other, U.betaLead],
  );
}

beforeEach(seed);
afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("naming the deputy", () => {
  it("is the admin's call, logged, and tells the deputy", async () => {
    await svc(U.admin, (tx, p) => setDeputy(tx, p, ACME, U.dep));
    expect(await roles()).toEqual([
      [U.lead, "lead"],
      [U.dep, "deputy"],
    ]);
    const log = (await owner.query(`SELECT meta FROM audit_log WHERE action = 'client_assignment.set_deputy' AND resource_id = $1`, [ACME])).rows;
    expect(log.map((r) => r.meta.userId)).toEqual([U.dep]);
    expect((await owner.query(`SELECT user_id FROM notifications WHERE kind = 'client.deputy'`)).rows).toEqual([{ user_id: U.dep }]);
    const team = await svc(U.admin, (tx, p) => getClientTeam(tx, p, ACME));
    expect(team.can.setDeputy).toBe(true);
    expect(team.team.map((m) => [m.userId, m.isLead, m.isDeputy]).slice(0, 2)).toEqual([
      [U.lead, true, false],
      [U.dep, false, true],
    ]);
    // The lead can't name one; nor can the deputy name another.
    expect(await refused(svc(U.lead, (tx, p) => setDeputy(tx, p, ACME, U.other)))).toMatch(/not allowed|forbidden|not found/i);
    expect(await refused(svc(U.dep, (tx, p) => setDeputy(tx, p, ACME, U.other)))).toMatch(/not allowed|forbidden|not found/i);
    // Straight to the database, too.
    expect((await sql(U.lead, `UPDATE client_assignments SET is_deputy = true WHERE client_org_id = $1 AND user_id = $2`, [ACME, U.other])).rowCount).toBe(0);
  });

  it("is one per client, never the lead, and adds them to the team if needed", async () => {
    await svc(U.admin, (tx, p) => setDeputy(tx, p, ACME, U.dep));
    await svc(U.admin, (tx, p) => setDeputy(tx, p, ACME, U.fresh));
    expect(await roles()).toEqual([
      [U.lead, "lead"],
      [U.fresh, "deputy"],
    ]);
    expect(await refused(svc(U.admin, (tx, p) => setDeputy(tx, p, ACME, U.lead)))).toMatch(/lead cannot also be the deputy/);
    expect(await refused(owner.query(`UPDATE client_assignments SET is_deputy = true WHERE user_id = $1 AND client_org_id = $2`, [U.dep, ACME]))).toMatch(
      /client_assignments_one_deputy/,
    );
    expect(await refused(owner.query(`UPDATE client_assignments SET is_deputy = true WHERE user_id = $1 AND client_org_id = $2`, [U.lead, ACME]))).toMatch(
      /client_assignment_lead_or_deputy/,
    );
    await svc(U.admin, (tx, p) => setDeputy(tx, p, ACME, null));
    expect(await roles()).toEqual([[U.lead, "lead"]]);
    // Removing the deputy keeps them on the team.
    expect((await owner.query(`SELECT 1 FROM client_assignments WHERE client_org_id = $1 AND user_id = $2`, [ACME, U.fresh])).rowCount).toBe(1);
    expect((await owner.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'client_assignment.clear_deputy'`)).rows[0].n).toBe(1);
  });

  it("stops when the deputy becomes the lead", async () => {
    await svc(U.admin, (tx, p) => setDeputy(tx, p, ACME, U.dep));
    await svc(U.admin, (tx, p) => setLead(tx, p, ACME, U.dep));
    expect(await roles()).toEqual([[U.dep, "lead"]]);
  });
});

describe("the deputy", () => {
  beforeEach(async () => {
    await svc(U.admin, (tx, p) => setDeputy(tx, p, ACME, U.dep));
  });

  it("can do what the lead can: staff the team and its projects", async () => {
    await svc(U.dep, (tx, p) => addConsultant(tx, p, ACME, U.fresh));
    await sql(U.dep, `INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [P.acme, U.other]);
    await svc(U.dep, (tx, p) => removeConsultant(tx, p, ACME, U.fresh));
    // A consultant who is neither can't.
    expect(await refused(sql(U.other, `INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [P.acme, U.fresh]))).toMatch(/row-level security/);
    // Only on their own client.
    expect(await refused(svc(U.dep, (tx, p) => addConsultant(tx, p, BETA, U.fresh)))).toMatch(/not allowed|forbidden|not found/i);
    expect(await refused(sql(U.dep, `INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [P.beta, U.betaLead]))).toMatch(/row-level security/);
  });

  it("can't remove the lead, and the lead can't remove the deputy; only the admin can", async () => {
    expect(await refused(svc(U.dep, (tx, p) => removeConsultant(tx, p, ACME, U.lead)))).toMatch(/not allowed|forbidden|not found/i);
    expect(await refused(svc(U.lead, (tx, p) => removeConsultant(tx, p, ACME, U.dep)))).toMatch(/not allowed|forbidden|not found/i);
    expect((await sql(U.lead, `DELETE FROM client_assignments WHERE client_org_id = $1 AND user_id = $2`, [ACME, U.dep])).rowCount).toBe(0);
    await svc(U.admin, (tx, p) => removeConsultant(tx, p, ACME, U.dep));
    expect(await roles()).toEqual([[U.lead, "lead"]]);
  });

  it("works on the client's projects, never as an observer", async () => {
    expect(
      await refused(owner.query(`INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,true)`, [P.acme, U.dep])),
    ).toMatch(/lead or deputy consultant works on its projects/);
    await owner.query(`INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,true)`, [P.acme, U.fresh]);
    await owner.query(`INSERT INTO client_assignments (client_org_id, user_id) VALUES ($1,$2)`, [ACME, U.fresh]);
    await svc(U.admin, (tx, p) => setDeputy(tx, p, ACME, U.fresh));
    expect((await owner.query(`SELECT observer FROM project_members WHERE project_id = $1 AND user_id = $2`, [P.acme, U.fresh])).rows[0].observer).toBe(false);
  });

  it("gets the lead's alerts, once, and not the lead's other notifications", async () => {
    const tell = (user: string, kind: string, type: string, entity: string) =>
      owner.query(`INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,$2,$3,$4)`, [user, kind, type, entity]);
    await tell(U.lead, "project.client_quiet", "project", P.acme);
    await tell(U.lead, "report.pack_drafted", "project", P.acme);
    await tell(U.lead, "action.comment", "project", P.acme); // not a lead alert
    await tell(U.other, "project.client_quiet", "project", P.acme); // not the lead
    await tell(U.betaLead, "project.client_quiet", "project", P.beta); // another client
    const got = (await owner.query(`SELECT kind FROM notifications WHERE user_id = $1 AND kind <> 'client.deputy' ORDER BY kind`, [U.dep])).rows;
    expect(got.map((r) => r.kind)).toEqual(["project.client_quiet", "report.pack_drafted"]);
    // Sent to both in one go, the deputy still gets it once.
    await owner.query(
      `INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,'info_request.overdue','project',$3), ($2,'info_request.overdue','project',$3)`,
      [U.lead, U.dep, P.acme],
    );
    expect((await owner.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND kind = 'info_request.overdue'`, [U.dep])).rows[0].n).toBe(1);
    // A deputy who has left gets nothing.
    await owner.query(`UPDATE org_memberships SET active = false WHERE user_id = $1`, [U.dep]);
    await tell(U.lead, "follow_up.overdue", "project", P.acme);
    expect((await owner.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND kind = 'follow_up.overdue'`, [U.dep])).rows[0].n).toBe(0);
  });
});
