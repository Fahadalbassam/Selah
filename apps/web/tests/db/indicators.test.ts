// Business indicators (KPI layer B; migration: client indicators) against a
// real Postgres: who reads which indicator (the firm, the client's admin,
// managers for the company and their own departments, never action owners
// or another client), who sets them up and enters values, corrections that
// keep every value, the firm's check, links to recommendations, the
// archived-client freeze, the series as of a day, and the monthly reminder.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { firmToday } from "@/lib/dates";
import { loadPrincipal } from "@/services/principal";
import * as I from "@/services/indicators";
import { indicatorRecords, linkedRecords } from "@/services/assistant";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-f960-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const P1 = id(5);
const BETA_P = id(6);
const U = {
  admin: id(11),
  lead: id(12), // Acme's lead consultant
  cons: id(13), // on Acme's team
  outsider: id(14), // a consultant not on Acme
  cadmin: id(15),
  cmgr: id(16), // manager, not in Finance
  fin: id(17), // manager in Finance
  owner1: id(18), // action owner
  bAdmin: id(19),
};
const DEPT_FIN = id(31);
const R = { shared: id(41), firm: id(42), beta: id(43) };
const K = { company: id(51), finance: id(52), beta: id(53) };

async function as<T>(userId: string, fn: (c: PoolClient) => Promise<T>, commit = true): Promise<T> {
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
const sqlAs = (userId: string, text: string, params: unknown[] = []) => as(userId, (c) => c.query(text, params));
const svc = <T>(userId: string, fn: (tx: Tx, p: Principal) => Promise<T>) =>
  as(userId, async (c) => {
    const tx = drizzle(c, { schema }) as unknown as Tx;
    return fn(tx, (await loadPrincipal(tx, userId))!).catch((e: Error & { cause?: Error }) => {
      throw new Error(e.cause ? `${e.message} | ${e.cause.message}` : e.message);
    });
  });

const indicator = (by: string, kid: string, org: string, dept: string | null = null, extra = "") =>
  sqlAs(
    by,
    `INSERT INTO client_kpis (id, org_id, department_id, name_en, name_ar, unit, direction, frequency, baseline, baseline_period, target, target_date, created_by)
     VALUES ($1,$2,$3,'Customer complaints','شكاوى العملاء','complaints','lower_better','monthly',40,'2026-01-01',20,'2026-12-01',$4) ${extra}`,
    [kid, org, dept, by],
  );
const value = (by: string, kid: string, period: string, v: number, supersedes: string | null = null) =>
  sqlAs(by, `INSERT INTO client_kpi_values (kpi_id, org_id, period, value, entered_by, supersedes_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, on_behalf`, [
    kid,
    ACME,
    period,
    v,
    by,
    supersedes,
  ]);
const seen = async (uid: string, table: string) => (await sqlAs(uid, `SELECT * FROM ${table}`)).rowCount;

async function reset() {
  await truncateAuditLog(owner);
  await owner.query(`DELETE FROM client_kpi_links`);
  await owner.query(`DELETE FROM client_kpi_values`);
  await owner.query(`DELETE FROM client_kpis`);
  await owner.query(`DELETE FROM notifications`);
  await owner.query(
    `INSERT INTO client_kpis (id, org_id, department_id, name_en, name_ar, unit, direction, frequency, baseline, baseline_period, target, target_date, created_by) VALUES
      ($1,$4,NULL,'Customer complaints','شكاوى العملاء','complaints','lower_better','monthly',40,'2026-01-01',20,'2026-12-01',$6),
      ($2,$4,$7,'Days to close the books','أيام إقفال الدفاتر','days','lower_better','monthly',15,'2026-01-01',NULL,NULL,$6),
      ($3,$5,NULL,'Beta revenue','إيرادات بيتا','SAR','higher_better','quarterly',100,'2026-01-01',NULL,NULL,$6)`,
    [K.company, K.finance, K.beta, ACME, BETA, U.admin, DEPT_FIN],
  );
}

beforeAll(async () => {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode) VALUES ($1,'firm','Mizan Advisory',NULL), ($2,'client','Acme Holding','full'), ($3,'client','Beta Trading','full')`,
    [FIRM, ACME, BETA],
  );
  await q(`UPDATE organizations SET departments_enabled = true WHERE id = $1`, [ACME]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$10,'firm_admin'), ($2,$10,'consultant'), ($3,$10,'consultant'), ($4,$10,'consultant'),
      ($5,$11,'client_admin'), ($6,$11,'client_manager'), ($7,$11,'client_manager'), ($8,$11,'action_owner'), ($9,$12,'client_admin')`,
    [U.admin, U.lead, U.cons, U.outsider, U.cadmin, U.cmgr, U.fin, U.owner1, U.bAdmin, FIRM, ACME, BETA],
  );
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$2,'المالية','Finance')`, [DEPT_FIN, ACME]);
  await q(`INSERT INTO department_members (department_id, user_id) VALUES ($1,$2)`, [DEPT_FIN, U.fin]);
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$3,$5,'Acme governance','active',$6), ($2,'client',$4,$5,'Beta strategy','active',$6)`,
    [P1, BETA_P, ACME, BETA, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($1,$3,false)`, [ACME, U.lead, U.cons]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4), ($1,$5)`, [P1, U.cons, U.cmgr, U.fin, U.owner1]);
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES
      ($1,$4,$6,'Set up a complaints desk','shared',$7), ($2,$4,$6,'Replace the CFO','firm_private',$7), ($3,$5,$8,'Beta pricing','shared',$7)`,
    [R.shared, R.firm, R.beta, P1, BETA_P, ACME, U.cons, BETA],
  );
  await q(
    `INSERT INTO actions (project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by) VALUES
      ($1,$2,$3,'Open the desk',$4,'verified_complete','2026-06-01',$5), ($1,$2,$3,'Train the staff',$4,'in_progress','2026-12-01',$5)`,
    [P1, ACME, R.shared, U.owner1, U.cons],
  );
});

beforeEach(reset);

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("who reads them", () => {
  it("the firm admin and the client's consultants; not a consultant off the client", async () => {
    expect(await seen(U.admin, "client_kpis")).toBe(3);
    for (const uid of [U.lead, U.cons]) expect(await seen(uid, "client_kpis"), uid).toBe(2);
    expect(await seen(U.outsider, "client_kpis")).toBe(0);
  });

  it("the client's admin reads all of its own; managers the company's and their own departments'; action owners none", async () => {
    await value(U.cadmin, K.company, "2026-02-01", 38);
    await value(U.fin, K.finance, "2026-02-01", 14);
    await owner.query(`INSERT INTO client_kpi_links (kpi_id, recommendation_id, org_id, created_by) VALUES ($1,$2,$3,$4)`, [K.finance, R.shared, ACME, U.cons]);
    expect(await seen(U.cadmin, "client_kpis")).toBe(2);
    expect(await seen(U.fin, "client_kpis")).toBe(2);
    expect((await sqlAs(U.cmgr, `SELECT id FROM client_kpis`)).rows.map((r) => r.id)).toEqual([K.company]);
    // Nor the department's values or links.
    expect(await seen(U.cmgr, "client_kpi_values")).toBe(1);
    expect(await seen(U.cmgr, "client_kpi_links")).toBe(0);
    expect(await seen(U.fin, "client_kpi_links")).toBe(1);
    for (const t of ["client_kpis", "client_kpi_values", "client_kpi_links"]) expect(await seen(U.owner1, t), t).toBe(0);
    // Another client sees only its own.
    expect((await sqlAs(U.bAdmin, `SELECT id FROM client_kpis`)).rows.map((r) => r.id)).toEqual([K.beta]);
    expect(await seen(U.bAdmin, "client_kpi_values")).toBe(0);
  });

  it("the services agree: a manager outside the department gets not found; an action owner gets nothing", async () => {
    await expect(svc(U.cmgr, (tx, p) => I.getIndicator(tx, p, K.finance))).rejects.toThrow(/not found|indicator/);
    await expect(svc(U.bAdmin, (tx, p) => I.getIndicator(tx, p, K.company))).rejects.toThrow();
    await expect(svc(U.owner1, (tx, p) => I.listIndicators(tx, p, ACME))).rejects.toThrow();
    expect(await svc(U.owner1, (tx, p) => I.recommendationIndicators(tx, p, R.shared))).toBeNull();
    const list = await svc(U.cmgr, (tx, p) => I.listIndicators(tx, p, ACME));
    expect(list.indicators.map((i) => i.id)).toEqual([K.company]);
    expect(list.canManage).toBe(false);
    expect(list.canReport).toBe(true);
  });
});

describe("setting them up", () => {
  it("the firm admin, the client's consultants and the client's admin; nobody else", async () => {
    let n = 60;
    for (const uid of [U.admin, U.lead, U.cons, U.cadmin]) await indicator(uid, id(++n), ACME);
    for (const uid of [U.cmgr, U.fin, U.owner1, U.outsider, U.bAdmin]) {
      await expect(indicator(uid, id(++n), ACME), uid).rejects.toThrow(/row-level security/);
    }
    // Through the service the person is recorded as the creator, whatever is sent.
    const made = await svc(U.cadmin, (tx, p) =>
      I.createIndicator(tx, p, ACME, {
        nameAr: "معدل دوران الموظفين",
        nameEn: null,
        definition: null,
        unit: "%",
        direction: "lower_better",
        frequency: "quarterly",
        baseline: 18,
        baselinePeriod: "2026-01-01",
        target: null,
        targetDate: null,
        source: "HR system",
        departmentId: null,
      }),
    );
    expect((await owner.query(`SELECT created_by FROM client_kpis WHERE id = $1`, [made.id])).rows[0].created_by).toBe(U.cadmin);
    const audited = await owner.query(`SELECT 1 FROM audit_log WHERE action = 'indicator.create' AND resource_id = $1`, [made.id]);
    expect(audited.rowCount).toBe(1);
  });

  it("checks its shape: a name, a baseline on the 1st, a target with its date after the baseline, a department of the same client", async () => {
    const base = `INSERT INTO client_kpis (org_id, unit, direction, baseline, baseline_period, target, target_date, name_en, department_id, created_by) VALUES `;
    await expect(sqlAs(U.cons, `${base} ($1,'x','higher_better',1,'2026-01-01',NULL,NULL,NULL,NULL,$2)`, [ACME, U.cons])).rejects.toThrow(/client_kpi_named/);
    await expect(sqlAs(U.cons, `${base} ($1,'x','higher_better',1,'2026-01-15',NULL,NULL,'n',NULL,$2)`, [ACME, U.cons])).rejects.toThrow(/baseline_first/);
    await expect(sqlAs(U.cons, `${base} ($1,'x','higher_better',1,'2026-01-01',5,NULL,'n',NULL,$2)`, [ACME, U.cons])).rejects.toThrow(/target_pair/);
    await expect(sqlAs(U.cons, `${base} ($1,'x','higher_better',1,'2026-01-01',5,'2025-12-01','n',NULL,$2)`, [ACME, U.cons])).rejects.toThrow(/target_after/);
    await expect(sqlAs(U.admin, `${base} ($1,'x','higher_better',1,'2026-01-01',NULL,NULL,'n',$2,$3)`, [BETA, DEPT_FIN, U.admin])).rejects.toThrow(/department_fk/);
    await expect(sqlAs(U.admin, `${base} ($1,'x','higher_better',1,'2026-01-01',NULL,NULL,'n',NULL,$2)`, [FIRM, U.admin])).rejects.toThrow(/belong to a client/);
  });

  it("once it has values, the baseline, frequency and direction stay; it is switched off, not deleted", async () => {
    await sqlAs(U.cadmin, `UPDATE client_kpis SET baseline = 41 WHERE id = $1`, [K.company]);
    await value(U.cmgr, K.company, "2026-02-01", 38);
    await expect(sqlAs(U.cadmin, `UPDATE client_kpis SET baseline = 42 WHERE id = $1`, [K.company])).rejects.toThrow(/start a new indicator/);
    await expect(sqlAs(U.cons, `UPDATE client_kpis SET frequency = 'quarterly' WHERE id = $1`, [K.company])).rejects.toThrow(/start a new indicator/);
    // The rest can change: the name, the target, the department.
    await sqlAs(U.cons, `UPDATE client_kpis SET name_en = 'Complaints received', target = 25 WHERE id = $1`, [K.company]);
    await expect(sqlAs(U.cadmin, `DELETE FROM client_kpis WHERE id = $1`, [K.company])).rejects.toThrow(/switch it off instead/);
    await sqlAs(U.cadmin, `DELETE FROM client_kpis WHERE id = $1`, [K.finance]);
    await svc(U.cadmin, (tx, p) => I.updateIndicator(tx, p, K.company, { active: false }));
    await expect(value(U.cmgr, K.company, "2026-03-01", 37)).rejects.toThrow(/active indicators/);
    expect((await owner.query(`SELECT 1 FROM audit_log WHERE action = 'indicator.archive' AND resource_id = $1`, [K.company])).rowCount).toBe(1);
    // A manager can't change one.
    expect((await sqlAs(U.cmgr, `UPDATE client_kpis SET active = true WHERE id = $1 RETURNING id`, [K.company])).rowCount).toBe(0);
  });
});

describe("values", () => {
  it("managers and admins enter them for what they read, in their own name; action owners and outsiders can't", async () => {
    await value(U.cmgr, K.company, "2026-02-01", 38);
    await value(U.fin, K.finance, "2026-02-01", 14);
    await expect(value(U.cmgr, K.finance, "2026-03-01", 13)).rejects.toThrow(/row-level security/);
    await expect(value(U.owner1, K.company, "2026-03-01", 30)).rejects.toThrow(/row-level security/);
    await expect(value(U.outsider, K.company, "2026-03-01", 30)).rejects.toThrow(/row-level security/);
    await expect(value(U.bAdmin, K.company, "2026-03-01", 30)).rejects.toThrow(/row-level security/);
    // Whoever is named, the value goes under the person who entered it.
    const named = await sqlAs(
      U.cmgr,
      `INSERT INTO client_kpi_values (kpi_id, org_id, period, value, entered_by) VALUES ($1,$2,'2026-03-01',1,$3) RETURNING entered_by`,
      [K.company, ACME, U.cadmin],
    );
    expect(named.rows[0].entered_by).toBe(U.cmgr);
  });

  it("are for one of the indicator's periods after its baseline that has started", async () => {
    await expect(value(U.cmgr, K.company, "2026-01-01", 39)).rejects.toThrow(/one of the indicator's periods/);
    await expect(value(U.cmgr, K.company, "2026-02-15", 39)).rejects.toThrow(/one of the indicator's periods/);
    await expect(value(U.cmgr, K.company, "2099-01-01", 39)).rejects.toThrow(/not started yet/);
    await expect(value(U.bAdmin, K.beta, "2026-02-01", 39)).rejects.toThrow(/one of the indicator's periods/);
    await sqlAs(U.bAdmin, `INSERT INTO client_kpi_values (kpi_id, org_id, period, value, entered_by) VALUES ($1,$2,'2026-04-01',120,$3)`, [K.beta, BETA, U.bAdmin]);
  });

  it("a second value for a period is a correction that replaces it; every value stays and none is changed or deleted", async () => {
    const first = (await value(U.cmgr, K.company, "2026-02-01", 38)).rows[0].id;
    await expect(value(U.cadmin, K.company, "2026-02-01", 36)).rejects.toThrow(/correct it instead/);
    await expect(value(U.cadmin, K.company, "2026-03-01", 36, first)).rejects.toThrow(/no value for that period to correct/);
    const second = (await value(U.cadmin, K.company, "2026-02-01", 36, first)).rows[0].id;
    await expect(value(U.cadmin, K.company, "2026-02-01", 35, first)).rejects.toThrow(/correct it instead|supersede_once/);
    expect((await sqlAs(U.cmgr, `UPDATE client_kpi_values SET value = 1 WHERE id = $1 RETURNING id`, [second])).rowCount).toBe(0);
    await expect(sqlAs(U.cadmin, `DELETE FROM client_kpi_values WHERE id = $1`, [first])).rejects.toThrow(/permission denied/);
    const series = (await sqlAs(U.cmgr, `SELECT period::text AS period, value, status, corrected FROM app_kpi_series($1, $2)`, [K.company, firmToday()])).rows;
    expect(series[0]).toMatchObject({ period: "2026-02-01", value: "36", status: "reported", corrected: true });
    const detail = await svc(U.cmgr, (tx, p) => I.getIndicator(tx, p, K.company));
    expect(detail.history.map((h) => [h.value, h.current])).toEqual([
      [36, true],
      [38, false],
    ]);
  });

  it("the firm enters them for the client: marked on its behalf, logged, and the client's admins are told", async () => {
    const saved = await svc(U.cons, (tx, p) => I.addValue(tx, p, K.company, { period: "2026-02-01", value: 37, note: "From the call centre report" }));
    const row = (await owner.query(`SELECT on_behalf, entered_by FROM client_kpi_values WHERE id = $1`, [saved.id])).rows[0];
    expect(row).toEqual({ on_behalf: true, entered_by: U.cons });
    const told = await owner.query(`SELECT user_id FROM notifications WHERE kind = 'indicator.entered_for_you'`);
    expect(told.rows.map((r) => r.user_id)).toEqual([U.cadmin]);
    expect((await owner.query(`SELECT 1 FROM audit_log WHERE action = 'indicator.value' AND resource_id = $1`, [K.company])).rowCount).toBe(1);
    // The client entering its own is not on its behalf, and tells nobody.
    expect((await value(U.cmgr, K.company, "2026-03-01", 35)).rows[0].on_behalf).toBe(false);
    expect((await owner.query(`SELECT 1 FROM notifications`)).rowCount).toBe(1);
  });

  it("the firm checks a value against the source once, never one it entered, and not a replaced one", async () => {
    const mine = (await value(U.cons, K.company, "2026-02-01", 38)).rows[0].id;
    await expect(svc(U.cons, (tx, p) => I.checkValue(tx, p, mine))).rejects.toThrow(/someone other/);
    const client = (await value(U.cmgr, K.company, "2026-03-01", 36)).rows[0].id;
    await expect(svc(U.cadmin, (tx, p) => I.checkValue(tx, p, client))).rejects.toThrow();
    expect((await sqlAs(U.cadmin, `UPDATE client_kpi_values SET checked_by = $2, checked_at = now() WHERE id = $1 RETURNING id`, [client, U.cadmin])).rowCount).toBe(0);
    await svc(U.lead, (tx, p) => I.checkValue(tx, p, client));
    expect((await owner.query(`SELECT checked_by FROM client_kpi_values WHERE id = $1`, [client])).rows[0].checked_by).toBe(U.lead);
    await expect(svc(U.admin, (tx, p) => I.checkValue(tx, p, client))).rejects.toThrow(/once/);
    await value(U.cmgr, K.company, "2026-02-01", 39, mine);
    await expect(svc(U.lead, (tx, p) => I.checkValue(tx, p, mine))).rejects.toThrow(/was corrected/);
  });
});

describe("the series and the summary", () => {
  it("each period after the baseline is reported, due within the grace days, or missing after them; a later correction does not rewrite an earlier day", async () => {
    const feb = (await value(U.cmgr, K.company, "2026-02-01", 38)).rows[0].id;
    await value(U.cmgr, K.company, "2026-04-01", 30);
    // A correction entered now, read as of a day before it: the first value.
    await owner.query(`BEGIN; ALTER TABLE client_kpi_values DISABLE TRIGGER client_kpi_value_rules;
      UPDATE client_kpi_values SET entered_at = '2026-03-02T09:00:00Z' WHERE id = '${feb}';
      ALTER TABLE client_kpi_values ENABLE TRIGGER client_kpi_value_rules; COMMIT`);
    await value(U.cadmin, K.company, "2026-02-01", 34, feb);
    const at = async (day: string) => (await sqlAs(U.cmgr, `SELECT period::text AS period, value, status FROM app_kpi_series($1, $2)`, [K.company, day])).rows;
    expect(await at("2026-01-20")).toEqual([]);
    // As of 2026-05-05 the corrections and April's value (entered today) are not known yet.
    const may = await at("2026-05-05");
    expect(may).toEqual([
      { period: "2026-02-01", value: "38", status: "reported" },
      { period: "2026-03-01", value: null, status: "missing" },
      { period: "2026-04-01", value: null, status: "due" },
      { period: "2026-05-01", value: null, status: "due" },
    ]);
    const today = await svc(U.cmgr, (tx, p) => I.getIndicator(tx, p, K.company));
    expect(today.indicator.summary.latest).toEqual({ period: "2026-04-01", value: 30 });
    expect(today.indicator.summary.movement).toBe("better");
    expect(today.indicator.summary.towardTarget).toBe(50);
    expect(today.indicator.summary.points).toEqual([40, 34, 30]);
  });

  it("the client's list pools counts, and the snapshot for a project names the recommendations each is meant to move", async () => {
    await value(U.cmgr, K.company, "2026-02-01", 45);
    await svc(U.cons, (tx, p) => I.linkRecommendation(tx, p, K.company, R.shared));
    const list = await svc(U.cadmin, (tx, p) => I.listIndicators(tx, p, ACME));
    expect(list.counts).toMatchObject({ total: 2, worse: 1, better: 0, noValue: 1 });
    const linked = await svc(U.cons, (tx) => I.indicatorSnapshot(tx, { clientOrgId: ACME, projectId: P1, linkedOnly: true }, firmToday()));
    expect(linked.map((s) => [s.id, s.latest?.value, s.recommendations])).toEqual([[K.company, 45, ["Set up a complaints desk"]]]);
    // The reports hold every active indicator of the client, each naming the project's recommendations linked to it.
    const all = await svc(U.cons, (tx) => I.indicatorSnapshot(tx, { clientOrgId: ACME, projectId: P1 }, firmToday()));
    expect(all.map((s) => [s.id, s.recommendations])).toEqual([
      [K.company, ["Set up a complaints desk"]],
      [K.finance, []],
    ]);
    const forRec = await svc(U.cmgr, (tx, p) => I.recommendationIndicators(tx, p, R.shared));
    expect(forRec?.linked.map((k) => k.id)).toEqual([K.company]);
    expect(forRec?.canManage).toBe(false);
  });
});

describe("links to recommendations", () => {
  it("join an indicator and a recommendation of the same client, by those who set indicators up", async () => {
    await svc(U.cadmin, (tx, p) => I.linkRecommendation(tx, p, K.company, R.shared));
    await expect(svc(U.cons, (tx, p) => I.linkRecommendation(tx, p, K.company, R.beta))).rejects.toThrow();
    await expect(
      sqlAs(U.admin, `INSERT INTO client_kpi_links (kpi_id, recommendation_id, org_id, created_by) VALUES ($1,$2,$3,$4)`, [K.company, R.beta, ACME, U.admin]),
    ).rejects.toThrow(/same client/);
    await expect(svc(U.cmgr, (tx, p) => I.linkRecommendation(tx, p, K.company, R.shared))).rejects.toThrow();
    // A client admin can't link what it can't read: the firm's own recommendation.
    await expect(
      sqlAs(U.cadmin, `INSERT INTO client_kpi_links (kpi_id, recommendation_id, org_id, created_by) VALUES ($1,$2,$3,$4)`, [K.company, R.firm, ACME, U.cadmin]),
    ).rejects.toThrow(/row-level security/);
  });

  it("a link to the firm's own recommendation stays with the firm", async () => {
    await svc(U.cons, (tx, p) => I.linkRecommendation(tx, p, K.company, R.firm));
    await svc(U.cons, (tx, p) => I.linkRecommendation(tx, p, K.company, R.shared));
    expect(await seen(U.cons, "client_kpi_links")).toBe(2);
    expect(await seen(U.cadmin, "client_kpi_links")).toBe(1);
    const detail = await svc(U.cadmin, (tx, p) => I.getIndicator(tx, p, K.company));
    expect(detail.links.map((l) => l.title)).toEqual(["Set up a complaints desk"]);
    expect(detail.links[0]).toMatchObject({ verified: 1, applies: 2 });
    const trace = (await sqlAs(U.cadmin, `SELECT node_type, parent_type FROM app_trace($1) WHERE parent_type = 'kpi' OR node_type = 'kpi'`, [P1])).rows;
    expect(trace).toEqual(expect.arrayContaining([{ node_type: "kpi", parent_type: null }, { node_type: "recommendation", parent_type: "kpi" }]));
    expect(trace).toHaveLength(2);
    await svc(U.cons, (tx, p) => I.unlinkRecommendation(tx, p, K.company, R.firm));
    expect(await seen(U.cons, "client_kpi_links")).toBe(1);
  });
});

describe("the assistant", () => {
  it("reads only the indicators the person's own screens show, and says they are the client's figures", async () => {
    await value(U.fin, K.finance, "2026-02-01", 14);
    await svc(U.cons, (tx, p) => I.linkRecommendation(tx, p, K.finance, R.shared));
    await svc(U.cons, (tx, p) => I.linkRecommendation(tx, p, K.company, R.firm));
    const names = (rows: { text: string }[]) => rows.map((r) => r.text.match(/"([^"]+)"/)![1]);
    const read = (uid: string, org = ACME) => svc(uid, (tx) => indicatorRecords(tx, org, P1));
    expect(names(await read(U.cons))).toEqual(["Customer complaints", "Days to close the books"]);
    expect(names(await read(U.fin))).toEqual(["Customer complaints", "Days to close the books"]);
    expect(names(await read(U.cmgr))).toEqual(["Customer complaints"]);
    expect(await read(U.owner1)).toEqual([]);
    expect(await read(U.bAdmin)).toEqual([]);
    const [company, finance] = await read(U.cons);
    expect(finance!.text).toMatch(/Latest value 14 .* better than the baseline/);
    expect(finance!.text).toMatch(/Finance department/);
    expect(finance!.text).toMatch(/not verified impact/);
    // The firm's own recommendation is never named, not even to the firm: the passage can reach a client.
    expect(company!.text).not.toMatch(/Replace the CFO/);
    expect(finance!.text).toMatch(/Set up a complaints desk/);
    // A recommendation's record names its indicators, only those the reader may see.
    const rec = (uid: string) => svc(uid, (tx) => linkedRecords(tx, { type: "recommendation", id: R.shared }, []));
    expect((await rec(U.fin))[0]!.text).toMatch(/indicators linked to it: "Days to close the books"/);
    expect((await rec(U.cmgr))[0]!.text).not.toMatch(/indicators linked/);
  });
});

describe("an archived client", () => {
  it("keeps its indicators to read, and takes no new ones, values or links", async () => {
    await owner.query(`UPDATE organizations SET status = 'archived' WHERE id = $1`, [ACME]);
    try {
      expect(await seen(U.cons, "client_kpis")).toBe(2);
      await expect(value(U.cons, K.company, "2026-02-01", 38)).rejects.toThrow(/archived/);
      await expect(sqlAs(U.cons, `UPDATE client_kpis SET name_en = 'x' WHERE id = $1`, [K.company])).rejects.toThrow(/archived/);
      await expect(indicator(U.admin, id(90), ACME)).rejects.toThrow(/archived/);
    } finally {
      await owner.query(`UPDATE organizations SET status = 'active' WHERE id = $1`, [ACME]);
    }
  });
});

describe("the monthly reminder", () => {
  it("tells a client's admins once when last period ended without a value; only the job sends it", async () => {
    await expect(sqlAs(U.admin, `SELECT app_remind_kpis('2026-03-01')`)).rejects.toThrow(/permission denied/);
    // February ended with no value for either Acme indicator; Beta's quarter (Apr–Jun) has not ended.
    expect((await owner.query(`SELECT app_remind_kpis('2026-03-01') AS n`)).rows[0].n).toBe(1);
    expect((await owner.query(`SELECT app_remind_kpis('2026-03-01') AS n`)).rows[0].n).toBe(0);
    const told = await owner.query(`SELECT user_id, entity_id FROM notifications WHERE kind = 'indicator.due'`);
    expect(told.rows).toEqual([{ user_id: U.cadmin, entity_id: ACME }]);
    await owner.query(`DELETE FROM notifications`);
    // With February's values in, nobody is told.
    await owner.query(
      `INSERT INTO client_kpi_values (kpi_id, org_id, period, value, entered_by) VALUES ($1,$3,'2026-02-01',38,$4), ($2,$3,'2026-02-01',14,$4)`,
      [K.company, K.finance, ACME, U.cmgr],
    );
    expect((await owner.query(`SELECT app_remind_kpis('2026-03-01') AS n`)).rows[0].n).toBe(0);
    // The quarter after Beta's baseline (Apr–Jun) ended on 30 June.
    expect((await owner.query(`SELECT app_remind_kpis('2026-07-01') AS n`)).rows[0].n).toBe(2);
  });
});
