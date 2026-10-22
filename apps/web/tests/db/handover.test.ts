// Handover continuity and deviations (migrations 0014-0015) against a real
// Postgres: the client's sponsor, check-ins after handover, the deviation
// rules, and the AI draft log.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { projectDeviations } from "@/services/insight";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c000-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = {
  admin: id(11),
  lead: id(12), // Acme's lead consultant
  cons: id(13), // staffed on PROJ
  cadmin: id(14), // Acme client admin: the sponsor
  cmgr: id(15),
  cowner: id(16),
  former: id(17), // Acme action owner who left
  betaMgr: id(18),
};
const PROJ = id(21);
const BETA_PROJ = id(22);
const REC = id(31);
let n = 100;
const next = () => id(++n);

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

async function action(fields: { status?: string; due?: string; owner?: string; updatedAt?: string } = {}) {
  const aid = next();
  await owner.query(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by, updated_at)
     VALUES ($1,$2,$3,$4,'Act',$5,$6,$7,$8,COALESCE($9::timestamptz, now()))`,
    [
      aid,
      PROJ,
      ACME,
      REC,
      fields.owner ?? U.cowner,
      fields.status ?? "in_progress",
      fields.due ?? "2099-01-01",
      U.cons,
      fields.updatedAt ?? null,
    ],
  );
  return aid;
}

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [
    FIRM,
    ACME,
    BETA,
  ]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role, active) VALUES
      ($1,$9,'firm_admin',true), ($2,$9,'consultant',true), ($3,$9,'consultant',true), ($4,$10,'client_admin',true),
      ($5,$10,'client_manager',true), ($6,$10,'action_owner',true), ($7,$10,'action_owner',false), ($8,$11,'client_manager',true)`,
    [U.admin, U.lead, U.cons, U.cadmin, U.cmgr, U.cowner, U.former, U.betaMgr, FIRM, ACME, BETA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$3,$5,'Acme governance','active',$6), ($2,'client',$4,$5,'Beta strategy','active',$6)`,
    [PROJ, BETA_PROJ, ACME, BETA, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [ACME, U.lead]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4), ($1,$5), ($6,$7)`, [
    PROJ,
    U.cons,
    U.cmgr,
    U.cowner,
    U.former,
    BETA_PROJ,
    U.betaMgr,
  ]);
  await q(`INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES ($1,$2,$3,'Charter',$4)`, [
    REC,
    PROJ,
    ACME,
    U.cons,
  ]);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("the client's sponsor", () => {
  it("is an active admin or manager of the project's client", async () => {
    const set = (who: string) => run(U.admin, `UPDATE projects SET client_sponsor_user_id = $2 WHERE id = $1`, [PROJ, who]);
    for (const who of [U.cowner, U.betaMgr, U.lead]) {
      await expect(set(who), who).rejects.toThrow(/sponsor must be an active admin or manager/);
    }
    await set(U.cadmin);
  });

  it("is told at the last escalation level", async () => {
    const aid = await action({ due: "2027-03-01" }); // 19 days overdue on 2027-03-20
    const { rows } = await owner.query(`SELECT level, recipients FROM app_follow_ups_due('2027-03-20') WHERE action_id = $1`, [
      aid,
    ]);
    expect(rows[0].level).toBe(3);
    expect(rows[0].recipients).toContain(U.cadmin);
    const early = await owner.query(`SELECT recipients FROM app_follow_ups_due('2027-03-10') WHERE action_id = $1`, [aid]);
    expect(early.rows[0].recipients).not.toContain(U.cadmin); // level 2 on day 9
  });
});

describe("check-ins after handover", () => {
  const checkins = async () =>
    (
      await owner.query(
        `SELECT checkin_day, due_at, assignee_user_id, visibility, status FROM follow_ups WHERE project_id = $1 AND checkin_day IS NOT NULL ORDER BY checkin_day`,
        [PROJ],
      )
    ).rows;

  it("are created at 30, 60 and 90 days, for the client's lead, firm-private", async () => {
    await run(U.admin, `UPDATE projects SET handover_on = '2026-11-01' WHERE id = $1`, [PROJ]);
    const rows = await checkins();
    expect(rows.map((r) => [r.checkin_day, r.due_at.toISOString(), r.assignee_user_id, r.visibility])).toEqual([
      [30, "2026-12-01T06:00:00.000Z", U.lead, "firm_private"], // 09:00 Riyadh
      [60, "2026-12-31T06:00:00.000Z", U.lead, "firm_private"],
      [90, "2027-01-30T06:00:00.000Z", U.lead, "firm_private"],
    ]);
    // The client never sees them.
    expect((await attempt(U.cadmin, `SELECT 1 FROM follow_ups WHERE checkin_day IS NOT NULL`)).rowCount).toBe(0);
  });

  it("move with the handover date, except the ones already done", async () => {
    await owner.query(`UPDATE follow_ups SET status = 'done' WHERE project_id = $1 AND checkin_day = 30`, [PROJ]);
    await run(U.admin, `UPDATE projects SET handover_on = '2026-11-11' WHERE id = $1`, [PROJ]);
    const rows = await checkins();
    expect(rows.map((r) => [r.checkin_day, r.due_at.toISOString().slice(0, 10), r.status])).toEqual([
      [30, "2026-12-01", "done"],
      [60, "2027-01-10", "open"],
      [90, "2027-02-09", "open"],
    ]);
  });
});

describe("deviations", () => {
  const rules = async (uid: string, entity: string) =>
    (await attempt(uid, `SELECT rule FROM v_deviations WHERE entity_id = $1 ORDER BY rule`, [entity])).rows.map((r) => r.rule);

  it("flag overdue, stale, slipped, churned and orphaned actions by fixed rules", async () => {
    const overdue = await action({ due: "2020-01-01" });
    const stale = await action({ updatedAt: "2020-01-01" });
    const orphan = await action({ owner: U.former });
    const slipped = await action();
    for (let i = 0; i < 2; i++) {
      await owner.query(
        `INSERT INTO deadline_change_requests (project_id, org_id, action_id, requested_by, proposed_due_date, reason, status)
         VALUES ($1,$2,$3,$4,'2099-06-01','again','approved')`,
        [PROJ, ACME, slipped, U.cowner],
      );
    }
    const churn = await action();
    for (let i = 0; i < 2; i++) {
      await owner.query(
        `INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'revise')`,
        [PROJ, ACME, churn, U.cons],
      );
    }
    const fine = await action();
    expect(await rules(U.cons, overdue)).toEqual(["overdue"]);
    expect(await rules(U.cons, stale)).toEqual(["stale"]);
    expect(await rules(U.cons, orphan)).toEqual(["orphaned"]);
    expect(await rules(U.cons, slipped)).toEqual(["slipped"]);
    expect(await rules(U.cons, churn)).toEqual(["churn"]);
    expect(await rules(U.cons, fine)).toEqual([]);
    // Finished work is not a deviation.
    const done = await action({ status: "verified_complete", due: "2020-01-01" });
    expect(await rules(U.cons, done)).toEqual([]);
  });

  it("follow the firm's stale_days and never leak across clients", async () => {
    const quiet = await action({ updatedAt: new Date(Date.now() - 5 * 86_400_000).toISOString() });
    expect(await rules(U.cons, quiet)).toEqual([]);
    await owner.query(
      `INSERT INTO firm_settings (org_id, stale_days) VALUES ($1, 3) ON CONFLICT (org_id) DO UPDATE SET stale_days = 3`,
      [FIRM],
    );
    expect(await rules(U.cons, quiet)).toEqual(["stale"]);
    expect((await attempt(U.betaMgr, `SELECT * FROM v_deviations`)).rowCount).toBe(0);
    expect((await attempt(U.cmgr, `SELECT DISTINCT project_id FROM v_deviations`)).rows).toEqual([{ project_id: PROJ }]);
  });

  it("are listed for the firm on the project page, most pressing first", async () => {
    const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
      as(userId, async (c) => {
        const tx = drizzle(c, { schema }) as unknown as Tx;
        return fn(tx, (await loadPrincipal(tx, userId))!);
      });
    const late = await action({ due: "2020-01-01", updatedAt: "2020-01-01" });
    const rows = await svc(U.cons, (tx, p) => projectDeviations(tx, p, PROJ));
    const mine = rows.filter((r) => r.entityId === late);
    expect(mine.map((r) => r.rule)).toEqual(["overdue", "stale"]);
    expect(mine[0]).toMatchObject({ entityType: "action", title: "Act", dueDate: "2020-01-01" });
    expect(mine[0]!.detail.days).toBeGreaterThan(365);
    expect(rows.findIndex((r) => r.rule === "stale")).toBeGreaterThan(rows.findIndex((r) => r.rule === "overdue"));
    await expect(svc(U.cmgr, (tx, p) => projectDeviations(tx, p, PROJ))).rejects.toThrow();
  });
});

describe("AI draft outcomes", () => {
  const record = (uid: string, by = uid) =>
    run(
      uid,
      `INSERT INTO ai_drafts (project_id, org_id, kind, target_type, outcome, edit_distance, created_by) VALUES ($1,$2,'summary','meeting','edited',12,$3)`,
      [PROJ, ACME, by],
    );

  it("are recorded by whoever saw the draft, read by the firm, and never changed", async () => {
    await record(U.cmgr);
    await expect(record(U.cmgr, U.cons)).rejects.toThrow(/row-level security/);
    await expect(record(U.betaMgr)).rejects.toThrow(/row-level security/);
    expect((await attempt(U.cons, `SELECT * FROM ai_drafts`)).rowCount).toBe(1);
    expect((await attempt(U.cmgr, `SELECT * FROM ai_drafts`)).rowCount).toBe(0);
    await expect(attempt(U.cons, `UPDATE ai_drafts SET outcome = 'accepted_unchanged'`)).rejects.toThrow(/permission denied/);
  });
});
