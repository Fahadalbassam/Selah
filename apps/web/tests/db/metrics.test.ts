// Metrics (migrations 0012-0013) against a real Postgres: the agreed
// baseline date, implementation metrics under row-level security, the team
// view without rankings, and the optional client KPIs.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-b000-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = {
  admin: id(11),
  lead: id(12), // Acme's lead consultant
  cons: id(13), // staffed on PROJ
  outsider: id(14), // consultant on nothing
  cmgr: id(15), // Acme client manager, staffed
  cowner: id(16), // Acme action owner, staffed; owns the KPI
  betaMgr: id(17),
};
const PROJ = id(21);
const BETA_PROJ = id(22);
const REC = id(31);
const BETA_REC = id(32);
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

async function action(fields: { status?: string; due?: string | null; project?: string; updatedAt?: string } = {}) {
  const aid = next();
  const beta = fields.project === BETA_PROJ;
  await owner.query(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by, updated_at)
     VALUES ($1,$2,$3,$4,'Act',$5,$6,$7,$8,COALESCE($9::timestamptz, now()))`,
    [
      aid,
      beta ? BETA_PROJ : PROJ,
      beta ? BETA : ACME,
      beta ? BETA_REC : REC,
      beta ? U.betaMgr : U.cowner,
      fields.status ?? "in_progress",
      fields.due === undefined ? "2099-01-01" : fields.due,
      U.cons,
      fields.updatedAt ?? null,
    ],
  );
  return aid;
}
const row = async (aid: string) => (await owner.query(`SELECT * FROM actions WHERE id = $1`, [aid])).rows[0];
const day = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;

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
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$8,'firm_admin'), ($2,$8,'consultant'), ($3,$8,'consultant'), ($4,$8,'consultant'),
      ($5,$9,'client_manager'), ($6,$9,'action_owner'), ($7,$10,'client_manager')`,
    [U.admin, U.lead, U.cons, U.outsider, U.cmgr, U.cowner, U.betaMgr, FIRM, ACME, BETA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state) VALUES
      ($1,'client',$3,$5,'Acme governance','active'), ($2,'client',$4,$5,'Beta strategy','active')`,
    [PROJ, BETA_PROJ, ACME, BETA, FIRM],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [ACME, U.lead]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4), ($5,$6)`, [
    PROJ,
    U.cons,
    U.cmgr,
    U.cowner,
    BETA_PROJ,
    U.betaMgr,
  ]);
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES ($1,$2,$3,'Charter',$4), ($5,$6,$7,'Plan',$4)`,
    [REC, PROJ, ACME, U.cons, BETA_REC, BETA_PROJ, BETA],
  );
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("the agreed date", () => {
  it("is set when the action is released and does not move with later deadline changes", async () => {
    const draft = await action({ status: "draft", due: "2099-05-01" });
    expect((await row(draft)).baseline_due_date).toBeNull();
    await run(U.cons, `UPDATE actions SET due_date = '2099-06-01', status = 'assigned' WHERE id = $1`, [draft]);
    expect(day((await row(draft)).baseline_due_date)).toBe("2099-06-01");
    await run(U.cons, `UPDATE actions SET due_date = '2099-09-01' WHERE id = $1`, [draft]);
    await run(U.cons, `UPDATE actions SET baseline_due_date = '2099-09-01' WHERE id = $1`, [draft]);
    const r = await row(draft);
    expect([day(r.due_date), day(r.baseline_due_date)]).toEqual(["2099-09-01", "2099-06-01"]);
  });

  it("a deadline approval moves the due date but not the baseline", async () => {
    const aid = await action({ due: "2099-01-01" });
    await run(
      U.cowner,
      `INSERT INTO deadline_change_requests (id, project_id, org_id, action_id, requested_by, proposed_due_date, reason) VALUES ($1,$2,$3,$4,$5,'2099-03-01','Board')`,
      [next(), PROJ, ACME, aid, U.cowner],
    );
    await run(U.cons, `UPDATE deadline_change_requests SET status = 'approved' WHERE action_id = $1`, [aid]);
    const r = await row(aid);
    expect([day(r.due_date), day(r.baseline_due_date)]).toEqual(["2099-03-01", "2099-01-01"]);
  });
});

describe("implementation metrics", () => {
  const metrics = async (uid: string, project = PROJ) =>
    (await attempt(uid, `SELECT * FROM v_project_metrics WHERE project_id = $1`, [project])).rows[0];

  it("count the project's work, with on-time measured against the baseline", async () => {
    // Two verified actions: one agreed for far ahead (on time), one agreed for
    // 2020 and later moved to 2099 (late against what was agreed).
    const onTime = await action({ status: "verified_complete", due: "2099-12-31" });
    const late = await action({ status: "verified_complete", due: "2020-01-01" });
    await owner.query(`UPDATE actions SET due_date = '2099-12-31' WHERE id = $1`, [late]);
    for (const aid of [onTime, late]) {
      await owner.query(
        `INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'accept')`,
        [PROJ, ACME, aid, U.cons],
      );
    }
    await owner.query(`INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'revise')`, [
      PROJ,
      ACME,
      late,
      U.cons,
    ]);
    await action({ status: "blocked", due: "2020-02-01" }); // overdue, blocked
    await action({ status: "in_progress", updatedAt: "2020-01-01" }); // stale
    await action({ status: "awaiting_review" });

    const m = await metrics(U.cons);
    expect(Number(m.on_time_rate)).toBe(50);
    expect(Number(m.revision_rate)).toBeCloseTo(33.3, 1);
    expect(m.blocked).toBeGreaterThanOrEqual(1);
    expect(m.overdue).toBeGreaterThanOrEqual(1);
    expect(m.stale_actions).toBe(1);
    expect(m.awaiting_review).toBeGreaterThanOrEqual(1);
    expect(m.deadline_slips).toBe(1); // approved in the test above
    expect(m.median_days_awaiting_review).not.toBeNull();
  });

  it("never leak across projects: each viewer sees only the projects they can open", async () => {
    await action({ project: BETA_PROJ });
    const rows = async (uid: string) => (await attempt(uid, `SELECT project_id, actions_total FROM v_project_metrics`)).rows;
    expect(await rows(U.outsider)).toEqual([]);
    expect((await rows(U.betaMgr)).map((r) => r.project_id)).toEqual([BETA_PROJ]);
    expect((await rows(U.cmgr)).map((r) => r.project_id)).toEqual([PROJ]);
    expect((await rows(U.admin)).length).toBe(2);
    // The Beta manager's count includes none of Acme's actions.
    expect((await rows(U.betaMgr))[0].actions_total).toBe(1);
  });

  it("are copied monthly by the job only, once per day, and read like the project", async () => {
    const first = Number((await owner.query(`SELECT app_snapshot_metrics('2026-10-31') AS n`)).rows[0].n);
    expect(first).toBeGreaterThan(0);
    expect(Number((await owner.query(`SELECT app_snapshot_metrics('2026-10-31') AS n`)).rows[0].n)).toBe(0);
    await expect(attempt(U.admin, `SELECT app_snapshot_metrics('2026-11-30')`)).rejects.toThrow(/permission denied/);
    const seen = async (uid: string) =>
      Number((await attempt(uid, `SELECT count(*) FROM metric_snapshots WHERE as_of = '2026-10-31'`)).rows[0].count);
    expect(await seen(U.outsider)).toBe(0);
    expect(await seen(U.betaMgr)).toBeGreaterThan(0);
    expect(await seen(U.betaMgr)).toBeLessThan(first);
    await expect(attempt(U.admin, `UPDATE metric_snapshots SET value = 100`)).rejects.toThrow(/permission denied/);
    await expect(owner.query(`UPDATE metric_snapshots SET value = 100`)).rejects.toThrow(/append-only/);
  });
});

describe("the team", () => {
  it("the admin sees each colleague's load, sorted by name, with no scores", async () => {
    const { rows, fields } = await attempt(U.admin, `SELECT * FROM app_team_workload()`);
    expect(fields.map((f) => f.name)).toEqual(["user_id", "name", "role", "clients", "projects", "open_reviews"]);
    expect(rows.map((r) => r.name)).toEqual(["admin", "cons", "lead", "outsider"]);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.lead.clients).toBe(1);
    expect(byName.cons.open_reviews).toBeGreaterThanOrEqual(1);
    expect(byName.lead.open_reviews).toBe(byName.cons.open_reviews);
    expect(byName.outsider.open_reviews).toBe(0);
  });

  it("team totals are for the admin only", async () => {
    const { rows } = await attempt(U.admin, `SELECT * FROM app_team_metrics('2020-01-01')`);
    expect(rows[0].reviews).toBeGreaterThanOrEqual(3);
    for (const u of [U.cons, U.lead, U.cmgr]) {
      await expect(attempt(u, `SELECT * FROM app_team_workload()`), u).rejects.toThrow(/only the firm admin/);
      await expect(attempt(u, `SELECT * FROM app_team_metrics('2020-01-01')`), u).rejects.toThrow(/only the firm admin/);
    }
  });
});

describe("client KPIs (optional)", () => {
  const OBJ = id(901);
  const KPI = id(902);
  const objective = `INSERT INTO strategic_objectives (id, project_id, org_id, perspective, title_en, created_by) VALUES ($1,$2,$3,'internal_process','Run the board well',$4)`;
  const kpi = (kid: string, ownerId: string, project = PROJ, obj = OBJ) =>
    run(
      U.cons,
      `INSERT INTO kpis (id, project_id, org_id, objective_id, name_en, unit, direction, baseline, target, start_date, target_date, frequency, owner_user_id, created_by)
       VALUES ($1,$2,$3,$4,'Board meetings held','meetings','higher_better',0,10,'2026-01-01','2026-12-31','quarterly',$5,$6)`,
      [kid, project, project === PROJ ? ACME : BETA, obj, ownerId, U.cons],
    );
  const report = (uid: string, period: string, value: number, extra: { supersedes?: string; status?: string } = {}) =>
    run(
      uid,
      `INSERT INTO kpi_readings (id, project_id, org_id, kpi_id, period_start, value, reported_by, supersedes_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [next(), PROJ, ACME, KPI, period, value, uid, extra.supersedes ?? null, extra.status ?? "reported"],
    );

  it("stay off until the firm admin turns them on", async () => {
    await expect(run(U.cons, objective, [OBJ, PROJ, ACME, U.cons])).rejects.toThrow(/row-level security/);
    await expect(
      run(U.cons, `INSERT INTO firm_settings (org_id, client_kpis_enabled) VALUES ($1, true)`, [FIRM]),
    ).rejects.toThrow(/row-level security/);
    await run(U.admin, `INSERT INTO firm_settings (org_id, client_kpis_enabled) VALUES ($1, true)`, [FIRM]);
    await expect(run(U.cmgr, objective, [OBJ, PROJ, ACME, U.cmgr])).rejects.toThrow(/row-level security/);
    await run(U.cons, objective, [OBJ, PROJ, ACME, U.cons]);
  });

  it("are owned by someone on the client's project team, and linked only within the project", async () => {
    await expect(kpi(next(), U.betaMgr)).rejects.toThrow(/active member of the project team/);
    await kpi(KPI, U.cowner);
    await expect(
      run(
        U.cons,
        `INSERT INTO recommendation_kpis (project_id, org_id, recommendation_id, kpi_id, created_by) VALUES ($1,$2,$3,$4,$5)`,
        [PROJ, ACME, BETA_REC, KPI, U.cons],
      ),
    ).rejects.toThrow(/same project/);
    await run(
      U.cons,
      `INSERT INTO recommendation_kpis (project_id, org_id, recommendation_id, kpi_id, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [PROJ, ACME, REC, KPI, U.cons],
    );
  });

  it("the owner reports; nobody else on the client side does, and no client marks a value verified", async () => {
    await expect(report(U.cmgr, "2026-01-01", 2)).rejects.toThrow(/row-level security/);
    await expect(report(U.cowner, "2026-01-01", 2, { status: "verified" })).rejects.toThrow(/starts as reported/);
    await expect(report(U.cowner, "2026-02-01", 2)).rejects.toThrow(/not one of the KPI's periods/);
    await report(U.cowner, "2026-01-01", 2);
    const reading = await owner.query(`SELECT id FROM kpi_readings WHERE kpi_id = $1`, [KPI]);
    const rid = reading.rows[0].id;
    expect((await attempt(U.cowner, `UPDATE kpi_readings SET status = 'verified' WHERE id = $1`, [rid])).rowCount).toBe(0);
    await run(U.cons, `UPDATE kpi_readings SET status = 'verified' WHERE id = $1`, [rid]);
    const r = (await owner.query(`SELECT status, verified_by FROM kpi_readings WHERE id = $1`, [rid])).rows[0];
    expect(r).toEqual({ status: "verified", verified_by: U.cons });
    await expect(attempt(U.cons, `UPDATE kpi_readings SET status = 'rejected' WHERE id = $1`, [rid])).rejects.toThrow(/once/);
    await expect(attempt(U.cons, `DELETE FROM kpi_readings WHERE id = $1`, [rid])).rejects.toThrow(/permission denied/);
  });

  it("a missing period shows as not reported, never as zero, and a correction replaces a reading", async () => {
    // Q1 verified (2), Q2 reported then corrected, Q3 missing, Q4 still due.
    await report(U.cowner, "2026-04-01", 3);
    const q2 = (await owner.query(`SELECT id FROM kpi_readings WHERE kpi_id = $1 AND period_start = '2026-04-01'`, [KPI])).rows[0]
      .id;
    await report(U.cowner, "2026-04-01", 7, { supersedes: q2 });
    await expect(report(U.cowner, "2026-04-01", 8, { supersedes: q2 })).rejects.toThrow(/kpi_readings_supersede_once/);
    const { rows } = await attempt(U.cmgr, `SELECT * FROM app_kpi_periods($1, '2026-11-15')`, [KPI]);
    expect(rows.map((r) => [day(r.period_start), r.status, r.value === null ? null : Number(r.value), r.rag])).toEqual([
      ["2026-01-01", "verified", 2, "amber"], // 20% done, 24.7% expected by 31 March
      ["2026-04-01", "reported", 7, "green"], // 70% done, 49.6% expected by 30 June
      ["2026-07-01", "not_reported", null, null],
      ["2026-10-01", "due", null, null],
    ]);
  });

  it("are judged against the expected trajectory, not the final target", async () => {
    const monthly = next();
    await run(
      U.cons,
      `INSERT INTO kpis (id, project_id, org_id, objective_id, name_en, unit, direction, baseline, target, start_date, target_date, frequency, owner_user_id, created_by)
       VALUES ($1,$2,$3,$4,'Policies approved','policies','higher_better',0,12,'2026-01-01','2026-12-31','monthly',$5,$6)`,
      [monthly, PROJ, ACME, OBJ, U.cowner, U.cons],
    );
    await run(
      U.cowner,
      `INSERT INTO kpi_readings (project_id, org_id, kpi_id, period_start, value, reported_by) VALUES ($1,$2,$3,'2026-02-01',2,$4)`,
      [PROJ, ACME, monthly, U.cowner],
    );
    const { rows } = await attempt(U.cons, `SELECT * FROM app_kpi_periods($1, '2026-03-05')`, [monthly]);
    const feb = rows.find((r) => day(r.period_start) === "2026-02-01");
    // 2 of 12 (16.7%) by the end of February, when 16.2% of the year has passed: on track.
    expect([Number(feb.progress_pct), Number(feb.expected_pct), feb.rag]).toEqual([16.7, 16.2, "green"]);
  });

  it("nobody verifies their own reading, future periods take none, and periods start on the 1st", async () => {
    await report(U.cons, "2026-07-01", 4);
    const mine = (await owner.query(`SELECT id FROM kpi_readings WHERE kpi_id = $1 AND period_start = '2026-07-01'`, [KPI]))
      .rows[0].id;
    await expect(attempt(U.cons, `UPDATE kpi_readings SET status = 'verified' WHERE id = $1`, [mine])).rejects.toThrow(
      /other than its reporter/,
    );
    await attempt(U.lead, `UPDATE kpi_readings SET status = 'verified' WHERE id = $1`, [mine]);
    const long = next();
    await run(
      U.cons,
      `INSERT INTO kpis (id, project_id, org_id, objective_id, name_en, unit, direction, baseline, target, start_date, target_date, frequency, created_by)
       VALUES ($1,$2,$3,$4,'Long','x','higher_better',0,1,'2026-01-01','2099-12-31','monthly',$5)`,
      [long, PROJ, ACME, OBJ, U.cons],
    );
    await expect(
      run(
        U.cons,
        `INSERT INTO kpi_readings (project_id, org_id, kpi_id, period_start, value, reported_by) VALUES ($1,$2,$3,'2098-01-01',1,$4)`,
        [PROJ, ACME, long, U.cons],
      ),
    ).rejects.toThrow(/not started/);
    await expect(
      run(
        U.cons,
        `INSERT INTO kpis (project_id, org_id, objective_id, name_en, unit, direction, baseline, target, start_date, target_date, frequency, created_by)
         VALUES ($1,$2,$3,'Drifts','x','higher_better',0,1,'2026-01-31','2026-12-31','monthly',$4)`,
        [PROJ, ACME, OBJ, U.cons],
      ),
    ).rejects.toThrow(/kpi_starts_on_first/);
  });

  it("disappear again when the firm turns them off", async () => {
    await run(U.admin, `UPDATE firm_settings SET client_kpis_enabled = false WHERE org_id = $1`, [FIRM]);
    expect((await attempt(U.cons, `SELECT * FROM kpis`)).rowCount).toBe(0);
    expect((await attempt(U.cowner, `SELECT * FROM kpi_readings`)).rowCount).toBe(0);
    await run(U.admin, `UPDATE firm_settings SET client_kpis_enabled = true WHERE org_id = $1`, [FIRM]);
  });
});
