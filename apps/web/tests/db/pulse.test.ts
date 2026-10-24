// The closing pulse (F36, migration: Closing pulse) against a real Postgres:
// closing a client project asks its client people (sponsor, coordinator and
// the client's people staffed on it) in Selah and by mail; each answers once
// and may change it for 30 days; a low score tells the client's lead and
// deputy; the answers are the firm's (admin and lead), a client person reads
// only their own, and no other client sees any of it.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { PULSE_LOW, PULSE_OPEN_DAYS } from "@/lib/pulse";
import { loadPrincipal } from "@/services/principal";
import { answerPulse, getPulse } from "@/services/pulse";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c360-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = {
  admin: id(11),
  lead: id(12), // Acme's lead consultant
  deputy: id(13), // Acme's deputy consultant
  cons: id(14), // staffed on PROJ, not the lead
  betaLead: id(15),
  sponsor: id(21), // Acme manager, the sponsor, staffed
  coord: id(22), // Acme admin, the coordinator, not staffed
  cmgr: id(23), // Acme manager, staffed
  cadmin: id(24), // Acme admin, neither staffed nor a role holder
  cowner: id(25), // Acme action owner, staffed
  idle: id(26), // Acme manager on no project
  betaMgr: id(27),
};
const PROJ = id(31);
const BETA_PROJ = id(32);
const INTERNAL = id(33);

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
const run = (userId: string, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params), true);
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    true,
  );
const answer = (who: string, pid: string, s: [number, number, number], comment: string | null = null) =>
  svc(who, (tx, p) => answerPulse(tx, p, pid, { metAgreement: s[0], responsive: s[1], selfReliant: s[2], comment }));
const visible = async (who: string, pid: string) =>
  (await as(who, (c) => c.query(`SELECT user_id FROM pulse_answers WHERE project_id = $1 ORDER BY user_id`, [pid]))).rows.map((r) => r.user_id);
const notified = async (kind: string) =>
  (await owner.query(`SELECT user_id FROM notifications WHERE kind = $1 ORDER BY user_id`, [kind])).rows.map((r) => r.user_id);

async function close(pid: string) {
  await run(U.admin, `SELECT app_start_closing($1)`, [pid]);
  await run(U.admin, `SELECT app_write_lessons($1, 'Clear scope', 'Earlier reviews', null)`, [pid]);
  await run(U.admin, `SELECT app_close_project($1)`, [pid]);
}

async function reset(pid: string) {
  await owner.query(`DELETE FROM pulse_answers WHERE project_id = $1`, [pid]);
  await owner.query(`DELETE FROM project_closures WHERE project_id = $1`, [pid]);
  await owner.query(`UPDATE projects SET state = 'active' WHERE id = $1`, [pid]);
}

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await truncateAuditLog(owner);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [FIRM, ACME, BETA]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  const roles: [string, string, string][] = [
    [U.admin, FIRM, "firm_admin"],
    [U.lead, FIRM, "consultant"],
    [U.deputy, FIRM, "consultant"],
    [U.cons, FIRM, "consultant"],
    [U.betaLead, FIRM, "consultant"],
    [U.sponsor, ACME, "client_manager"],
    [U.coord, ACME, "client_admin"],
    [U.cmgr, ACME, "client_manager"],
    [U.cadmin, ACME, "client_admin"],
    [U.cowner, ACME, "action_owner"],
    [U.idle, ACME, "client_manager"],
    [U.betaMgr, BETA, "client_manager"],
  ];
  for (const [u, o, r] of roles) await q(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,$3)`, [u, o, r]);
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$4,$6,'Acme governance','active',$7), ($2,'client',$5,$6,'Beta strategy','active',$7), ($3,'internal',$6,$6,'Handbook','active',$7)`,
    [PROJ, BETA_PROJ, INTERNAL, ACME, BETA, FIRM, U.admin],
  );
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES
      ($1,$2,true,false), ($1,$3,false,true), ($1,$4,false,false), ($5,$6,true,false)`,
    [ACME, U.lead, U.deputy, U.cons, BETA, U.betaLead],
  );
  for (const u of [U.cons, U.sponsor, U.cmgr, U.cowner]) await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [PROJ, u]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [BETA_PROJ, U.betaMgr]);
  await q(`INSERT INTO project_members (project_id, user_id, is_lead) VALUES ($1,$2,true)`, [INTERNAL, U.cons]);
  await q(`INSERT INTO project_client_roles (project_id, org_id, role, user_id) VALUES ($1,$2,'sponsor',$3), ($1,$2,'coordinator',$4)`, [
    PROJ,
    ACME,
    U.sponsor,
    U.coord,
  ]);
});

beforeEach(async () => {
  for (const pid of [PROJ, BETA_PROJ, INTERNAL]) await reset(pid);
  await owner.query(`DELETE FROM notifications`);
  await owner.query(`DELETE FROM outbound_emails`);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("asking", () => {
  it("the database holds the same window and low mark as lib/pulse.ts", async () => {
    const r = await owner.query(`SELECT app_pulse_days() AS days, app_pulse_low() AS low`);
    expect(r.rows[0]).toEqual({ days: PULSE_OPEN_DAYS, low: PULSE_LOW });
  });

  it("closing a client project asks its sponsor, coordinator and staffed client people, in Selah and by mail", async () => {
    await close(PROJ);
    const asked = [U.sponsor, U.coord, U.cmgr].sort();
    expect(await notified("pulse.requested")).toEqual(asked);
    const mails = await owner.query(`SELECT to_email, link FROM outbound_emails WHERE kind = 'pulse.requested' ORDER BY to_email`);
    expect(mails.rows).toEqual(
      ["cmgr", "coord", "sponsor"].map((n) => ({ to_email: `${n}@example.test`, link: `/projects/${PROJ}?tab=closing` })),
    );
  });

  it("an internal project has no pulse, and nothing is asked before closing", async () => {
    await expect(run(U.sponsor, `SELECT app_answer_pulse($1, 4, 4, 4, null)`, [PROJ])).rejects.toThrow(/not open/);
    // While the project is still closing, nobody sees a pulse, the firm included.
    await run(U.admin, `SELECT app_start_closing($1)`, [PROJ]);
    for (const who of [U.admin, U.lead, U.sponsor]) expect(await svc(who, (tx, p) => getPulse(tx, p, PROJ)), who).toBeNull();
    await close(INTERNAL);
    expect(await notified("pulse.requested")).toEqual([]);
    expect(await svc(U.cons, (tx, p) => getPulse(tx, p, INTERNAL))).toBeNull();
  });
});

describe("answering", () => {
  it("one answer per person, changeable while open, audited without its content", async () => {
    await close(PROJ);
    const first = await answer(U.sponsor, PROJ, [4, 5, 3], "Good team");
    expect(first!.can.answer).toBe(true);
    expect(first!.mine).toMatchObject({ metAgreement: 4, responsive: 5, selfReliant: 3, comment: "Good team" });
    expect(first!.results).toBeNull();
    const again = await answer(U.sponsor, PROJ, [5, 5, 4]);
    expect(again!.mine).toMatchObject({ metAgreement: 5, selfReliant: 4, comment: null });
    expect((await owner.query(`SELECT count(*)::int AS n FROM pulse_answers WHERE project_id = $1`, [PROJ])).rows[0].n).toBe(1);
    const log = await owner.query(`SELECT meta FROM audit_log WHERE action = 'pulse.answer' AND actor_id = $1 ORDER BY created_at`, [U.sponsor]);
    expect(log.rows.map((r) => r.meta)).toEqual([{ changed: false }, { changed: true }]);
  });

  it("only the people asked answer: not the client's other admin or owners, another client, or the firm", async () => {
    await close(PROJ);
    for (const who of [U.cadmin, U.cowner, U.idle, U.betaMgr, U.admin, U.lead]) {
      await expect(run(who, `SELECT app_answer_pulse($1, 4, 4, 4, null)`, [PROJ]), who).rejects.toThrow();
      await expect(answer(who, PROJ, [4, 4, 4]), who).rejects.toThrow();
    }
    await expect(run(U.sponsor, `SELECT app_answer_pulse($1, 6, 4, 4, null)`, [PROJ])).rejects.toThrow(/1 to 5/);
    // Nobody writes the table directly.
    await expect(
      run(U.sponsor, `INSERT INTO pulse_answers (project_id, org_id, user_id, met_agreement, responsive, self_reliant) VALUES ($1,$2,$3,5,5,5)`, [
        PROJ,
        ACME,
        U.sponsor,
      ]),
    ).rejects.toThrow(/permission denied/);
  });

  it("locks 30 days after closing; the answer stays", async () => {
    await close(PROJ);
    await answer(U.sponsor, PROJ, [4, 4, 4]);
    await owner.query(`UPDATE project_closures SET closed_at = now() - interval '31 days' WHERE project_id = $1`, [PROJ]);
    await expect(answer(U.sponsor, PROJ, [5, 5, 5])).rejects.toThrow();
    await expect(answer(U.cmgr, PROJ, [5, 5, 5])).rejects.toThrow();
    const view = await svc(U.sponsor, (tx, p) => getPulse(tx, p, PROJ));
    expect(view!.can.answer).toBe(false);
    expect(view!.mine).toMatchObject({ metAgreement: 4 });
    // Someone who never answered sees nothing once it is locked.
    expect(await svc(U.cmgr, (tx, p) => getPulse(tx, p, PROJ))).toBeNull();
  });

  it("reopening keeps the answers and stops the pulse", async () => {
    await close(PROJ);
    await answer(U.sponsor, PROJ, [4, 4, 4]);
    await run(U.admin, `SELECT app_reopen_project($1, 'One more phase')`, [PROJ]);
    await expect(answer(U.sponsor, PROJ, [5, 5, 5])).rejects.toThrow();
    const view = await svc(U.admin, (tx, p) => getPulse(tx, p, PROJ));
    expect(view!.openUntil).toBeNull();
    expect(view!.results!.answers).toHaveLength(1);
  });
});

describe("low scores", () => {
  it("a score of 2 or less tells the client's lead and deputy, once until the answer recovers", async () => {
    await close(PROJ);
    await answer(U.sponsor, PROJ, [4, 4, 4]);
    expect(await notified("pulse.low_score")).toEqual([]);
    await answer(U.coord, PROJ, [3, 2, 4]);
    expect(await notified("pulse.low_score")).toEqual([U.lead, U.deputy].sort());
    await answer(U.coord, PROJ, [1, 2, 4]);
    expect(await notified("pulse.low_score")).toHaveLength(2);
    await answer(U.sponsor, PROJ, [4, 1, 4]);
    expect(await notified("pulse.low_score")).toHaveLength(4);
    // Nobody outside the lead and deputy hears it.
    const others = await owner.query(`SELECT count(*)::int AS n FROM notifications WHERE kind = 'pulse.low_score' AND user_id NOT IN ($1,$2)`, [
      U.lead,
      U.deputy,
    ]);
    expect(others.rows[0].n).toBe(0);
  });
});

describe("who reads the answers", () => {
  it("the firm admin, the client's lead and deputy read every answer; others only their own or none", async () => {
    await close(PROJ);
    await answer(U.sponsor, PROJ, [4, 5, 3], "Good team");
    await answer(U.cmgr, PROJ, [2, 4, 5]);
    const all = [U.sponsor, U.cmgr].sort();
    for (const who of [U.admin, U.lead, U.deputy]) expect(await visible(who, PROJ), who).toEqual(all);
    expect(await visible(U.sponsor, PROJ)).toEqual([U.sponsor]);
    expect(await visible(U.cmgr, PROJ)).toEqual([U.cmgr]);
    for (const who of [U.coord, U.cadmin, U.cowner, U.cons, U.betaLead, U.betaMgr]) expect(await visible(who, PROJ), who).toEqual([]);

    const view = await svc(U.lead, (tx, p) => getPulse(tx, p, PROJ));
    expect(view!.results).toMatchObject({ invited: 3, averages: { metAgreement: 3, responsive: 4.5, selfReliant: 4 } });
    expect(view!.results!.answers.map((a) => a.name).sort()).toEqual(["cmgr", "sponsor"]);
    // A staffed consultant who isn't the lead, and the client's admin, get no pulse at all.
    expect(await svc(U.cons, (tx, p) => getPulse(tx, p, PROJ))).toBeNull();
    expect(await svc(U.cadmin, (tx, p) => getPulse(tx, p, PROJ))).toBeNull();
    // A client person never sees the others' answers through the service either.
    const mine = await svc(U.sponsor, (tx, p) => getPulse(tx, p, PROJ));
    expect(mine!.results).toBeNull();
    expect((await as(U.sponsor, (c) => c.query(`SELECT app_pulse_invited($1) AS n`, [PROJ]))).rows[0].n).toBeNull();
  });

  it("another client's pulse stays with that client's firm admin and lead", async () => {
    await close(BETA_PROJ);
    await answer(U.betaMgr, BETA_PROJ, [5, 5, 5]);
    expect(await visible(U.betaLead, BETA_PROJ)).toEqual([U.betaMgr]);
    expect(await visible(U.admin, BETA_PROJ)).toEqual([U.betaMgr]);
    for (const who of [U.lead, U.deputy, U.sponsor, U.cadmin, U.cmgr]) expect(await visible(who, BETA_PROJ), who).toEqual([]);
    await expect(svc(U.sponsor, (tx, p) => getPulse(tx, p, BETA_PROJ))).rejects.toThrow();
  });
});
