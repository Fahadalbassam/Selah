// An indicator that moved away (decision 4b, migration 0090) against a real
// Postgres: when a value is saved, by any path, and the indicator's latest
// value is on the other side of the baseline from the client's chosen
// direction, or short of the target once the target date has passed, the
// client's lead and deputy and the client's admins get one
// indicator.moved_away notice, once per indicator and period. Nobody else:
// not a department's manager, an action owner, another client's people or
// other consultants. Muting the indicator keeps the notice off the summary
// mail.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { firmToday } from "@/lib/dates";
import { planValues } from "@/lib/indicator-import";
import { runIndicatorFeeds } from "@/jobs/indicator-feeds";
import { loadPrincipal } from "@/services/principal";
import * as D from "@/services/indicator-data";
import * as I from "@/services/indicators";
import * as N from "@/services/notifications";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

// The app's configuration (the import token is signed with the auth secret).
Object.assign(process.env, {
  APP_URL: "http://selah.test",
  DATABASE_APP_URL: appUrl,
  DATABASE_AUTH_URL: process.env.TEST_DATABASE_AUTH_URL ?? appUrl,
  BETTER_AUTH_SECRET: "a-test-secret-that-is-long-enough-0123456789",
  S3_ENDPOINT: "http://storage.test",
  S3_BUCKET: "test",
  S3_ACCESS_KEY: "test",
  S3_SECRET_KEY: "test",
  AI_SERVICE_URL: "http://ai.test",
  AI_SERVICE_TOKEN: "an-ai-token-that-is-long-enough-0123456789",
});

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-f980-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const P1 = id(5);
const U = {
  admin: id(11), // the firm admin, not on Acme's team
  lead: id(12), // Acme's lead consultant
  deputy: id(13), // Acme's deputy consultant
  cons: id(14), // on Acme's team and staffed, neither lead nor deputy
  betaLead: id(15), // Beta's lead consultant
  observer: id(16), // on Acme's team, observes its project
  cadmin: id(21),
  cadmin2: id(22),
  cmgr: id(23), // manager in Sales
  fin: id(24), // manager in Finance
  owner1: id(25), // owns an action at Acme
  gone: id(26), // a client admin who was switched off
  bAdmin: id(31),
};
const DEPT = { sales: id(41), finance: id(42) };
const K = { complaints: id(51), finance: id(52), target: id(53), future: id(54), beta: id(55) };
/** Who is told about every Acme indicator: the lead, the deputy and the active admins. */
const TOLD = [U.lead, U.deputy, U.cadmin, U.cadmin2].sort();

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
const sqlAs = (userId: string, text: string, params: unknown[] = []) => as(userId, (c) => c.query(text, params));
const svc = <T>(userId: string, fn: (tx: Tx, p: Principal) => Promise<T>) =>
  as(userId, async (c) => {
    const tx = drizzle(c, { schema }) as unknown as Tx;
    return fn(tx, (await loadPrincipal(tx, userId))!).catch((e: Error & { cause?: Error }) => {
      throw new Error(e.cause ? `${e.message} | ${e.cause.message}` : e.message);
    });
  });
const asUser = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => as(userId, (c) => fn(drizzle(c, { schema }) as unknown as Tx));

/** A value typed in on the indicator page (the service the page's route calls). */
const typed = (by: string, kpiId: string, period: string, value: number, supersedesId: string | null = null) =>
  svc(by, (tx, p) => I.addValue(tx, p, kpiId, { period, value, note: supersedesId ? "corrected" : null, supersedesId }));

/** A file batch as the import's confirm step sends it. */
const fileBatch = (by: string, values: { kpiId: string; period: string; value: number }[]) =>
  svc(by, async (tx, p) => {
    const refs = await D.indicatorRefs(tx, ACME);
    const ctx = await D.importContext(tx, p, ACME);
    const map: Record<string, string> = {};
    const plan = planValues(
      values.map((v, i) => {
        map[v.kpiId] = v.kpiId;
        return { line: i + 2, label: v.kpiId, period: v.period, value: v.value, note: null };
      }),
      map,
      refs,
      new Map(ctx.current.map((c) => [c.key, { id: c.id, value: c.value }])),
      { today: firmToday(), corrections: true },
    );
    return D.saveBatch(tx, p, ACME, plan, { channel: "file", fileName: "export.xlsx", sha256: "a".repeat(64) });
  });

/** Every moved-away notice: who, about which value, its period and how the value arrived. */
const told = async (kpiId?: string) =>
  (
    await owner.query(
      `SELECT n.user_id, n.entity_id, n.entity_type, v.period::text AS period, v.channel::text AS channel
       FROM notifications n JOIN client_kpi_values v ON v.id = n.entity_id
       WHERE n.kind = 'indicator.moved_away' AND ($1::uuid IS NULL OR v.kpi_id = $1) ORDER BY v.period, n.user_id`,
      [kpiId ?? null],
    )
  ).rows as { user_id: string; entity_id: string; entity_type: string; period: string; channel: string }[];
const whoFor = async (period: string, kpiId?: string) => (await told(kpiId)).filter((r) => r.period === period).map((r) => r.user_id).sort();

async function reset() {
  await truncateAuditLog(owner);
  await owner.query(`DELETE FROM mail_kpi_mutes`);
  await owner.query(`DELETE FROM kpi_moved_away_log`);
  await owner.query(`DELETE FROM client_kpi_values`);
  await owner.query(`DELETE FROM indicator_imports`);
  await owner.query(`DELETE FROM indicator_feeds`);
  await owner.query(`DELETE FROM client_indicator_settings`);
  await owner.query(`DELETE FROM client_kpis`);
  await owner.query(`DELETE FROM notifications`);
  await owner.query(`TRUNCATE outbound_emails`);
  await owner.query(`UPDATE org_memberships SET active = true WHERE user_id <> $1`, [U.gone]);
  await owner.query(
    `INSERT INTO client_kpis (id, org_id, department_id, name_en, name_ar, code, unit, direction, frequency, baseline, baseline_period, target, target_date, created_by) VALUES
      ($1,$6,NULL,'Complaints','الشكاوى','complaints','complaints','lower_better','monthly',30,'2026-01-01',NULL,NULL,$8),
      ($2,$6,$9,'Invoices paid on time','الفواتير المسددة في موعدها',NULL,'%','higher_better','monthly',80,'2026-01-01',NULL,NULL,$8),
      ($3,$6,NULL,'Days to close the books','أيام إقفال الدفاتر',NULL,'days','lower_better','monthly',40,'2026-01-01',20,'2026-06-30',$8),
      ($4,$6,NULL,'Days to hire','أيام التوظيف',NULL,'days','lower_better','monthly',40,'2026-01-01',20,'2099-12-01',$8),
      ($5,$7,NULL,'Beta complaints','شكاوى بيتا',NULL,'complaints','lower_better','monthly',30,'2026-01-01',NULL,NULL,$8)`,
    [K.complaints, K.finance, K.target, K.future, K.beta, ACME, BETA, U.admin, DEPT.finance],
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
    `INSERT INTO org_memberships (user_id, org_id, role, active) VALUES
      ($1,$13,'firm_admin',true), ($2,$13,'consultant',true), ($3,$13,'consultant',true), ($4,$13,'consultant',true), ($5,$13,'consultant',true),
      ($6,$14,'client_admin',true), ($7,$14,'client_admin',true), ($8,$14,'client_manager',true), ($9,$14,'client_manager',true),
      ($10,$14,'action_owner',true), ($11,$14,'client_admin',false), ($12,$15,'client_admin',true)`,
    [U.admin, U.lead, U.deputy, U.cons, U.betaLead, U.cadmin, U.cadmin2, U.cmgr, U.fin, U.owner1, U.gone, U.bAdmin, FIRM, ACME, BETA],
  );
  await q(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,'consultant')`, [U.observer, FIRM]);
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$3,'المبيعات','Sales'), ($2,$3,'المالية','Finance')`, [DEPT.sales, DEPT.finance, ACME]);
  await q(`INSERT INTO department_members (department_id, user_id) VALUES ($1,$2), ($3,$4)`, [DEPT.sales, U.cmgr, DEPT.finance, U.fin]);
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES
      ($1,$2,true,false), ($1,$3,false,true), ($1,$4,false,false), ($5,$6,true,false), ($1,$7,false,false)`,
    [ACME, U.lead, U.deputy, U.cons, BETA, U.betaLead, U.observer],
  );
  await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Acme governance','active',$4)`, [P1, ACME, FIRM, U.admin]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4), ($1,$5)`, [P1, U.cons, U.cmgr, U.fin, U.owner1]);
  await q(`INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,true)`, [P1, U.observer]);
  await q(`INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES ($1,$2,$3,'Set up a complaints desk','shared',$4)`, [
    id(61),
    P1,
    ACME,
    U.cons,
  ]);
  await q(
    `INSERT INTO actions (project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
     VALUES ($1,$2,$3,'Open the desk',$4,'in_progress','2099-12-01',$5)`,
    [P1, ACME, id(61), U.owner1, U.cons],
  );
});

beforeEach(reset);

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("one notice for a value on the other side of the baseline", () => {
  it("tells the lead, the deputy and the client's admins once each, about the value, and each of them can open it", async () => {
    const v = await typed(U.cmgr, K.complaints, "2026-02-01", 42);
    const rows = await told();
    expect(rows.map((r) => r.user_id).sort()).toEqual(TOLD);
    expect(rows.every((r) => r.entity_type === "kpi_value" && r.entity_id === v.id)).toBe(true);
    // Not the firm admin who is not on the team, another consultant, a switched-off admin.
    for (const who of [U.admin, U.cons, U.gone]) expect(rows.map((r) => r.user_id)).not.toContain(who);
    // Nobody is told about an indicator they cannot open.
    for (const who of TOLD) expect((await sqlAs(who, `SELECT id FROM client_kpis WHERE id = $1`, [K.complaints])).rowCount, who).toBe(1);
    // The line states the figures, and leads to the indicator.
    const list = await svc(U.lead, (tx, p) => N.listNotifications(tx, p));
    const item = list.items.find((i) => i.kind === "indicator.moved_away")!;
    expect([item.title, item.titleAr, item.href]).toEqual(["Complaints", "الشكاوى", `/indicators/${K.complaints}`]);
    expect(item.facts).toMatchObject({ value: 42, period: "2026-02-01", baseline: 30, direction: "lower_better", unit: "complaints", targetPassed: false });
    // The firm reads "reported by the client"; the client's admin is spoken to about their company.
    expect(item.facts?.reader).toBe("firm");
    const theirs = (await svc(U.cadmin2, (tx, p) => N.listNotifications(tx, p))).items.find((i) => i.kind === "indicator.moved_away")!;
    expect(theirs.facts?.reader).toBe("client");
  });

  it("tells no one about a value on the right side, or on the baseline itself; the next one past it does", async () => {
    await typed(U.cmgr, K.complaints, "2026-02-01", 25);
    await typed(U.cmgr, K.complaints, "2026-03-01", 30);
    await typed(U.cadmin, K.finance, "2026-02-01", 91); // higher is better
    expect(await told()).toEqual([]);
    expect((await owner.query(`SELECT count(*)::int AS n FROM kpi_moved_away_log`)).rows[0].n).toBe(0);
    // The same indicator, the next period, past the baseline: now they are told.
    await typed(U.cmgr, K.complaints, "2026-04-01", 31);
    expect(await whoFor("2026-04-01")).toEqual(TOLD);
  });

  it("tells them at most once per indicator and period, whatever the corrections; a new period can tell again", async () => {
    const first = await typed(U.cmgr, K.complaints, "2026-02-01", 42);
    const second = await typed(U.cmgr, K.complaints, "2026-02-01", 45, first.id);
    const fixed = await typed(U.cmgr, K.complaints, "2026-02-01", 28, second.id);
    await typed(U.cmgr, K.complaints, "2026-02-01", 50, fixed.id);
    expect(await whoFor("2026-02-01")).toEqual(TOLD);
    expect((await told()).every((r) => r.entity_id === first.id)).toBe(true);
    await typed(U.cmgr, K.complaints, "2026-03-01", 44);
    expect(await whoFor("2026-03-01")).toEqual(TOLD);
    expect(await told()).toHaveLength(2 * TOLD.length);
  });

  it("tells no one after a correction that brings the value back to the right side", async () => {
    const wrong = await typed(U.cmgr, K.complaints, "2026-02-01", 42);
    expect(await told()).toHaveLength(TOLD.length);
    await typed(U.cmgr, K.complaints, "2026-02-01", 28, wrong.id);
    const rows = await told();
    expect(rows).toHaveLength(TOLD.length);
    expect(rows.every((r) => r.entity_id === wrong.id)).toBe(true);
  });

  it("only the indicator's latest value counts: an earlier period filled in or corrected later tells no one", async () => {
    await typed(U.cmgr, K.complaints, "2026-03-01", 25);
    await typed(U.cmgr, K.complaints, "2026-02-01", 42);
    expect(await told()).toEqual([]);
    await typed(U.cmgr, K.complaints, "2026-04-01", 33);
    expect(await whoFor("2026-04-01")).toEqual(TOLD);
  });

  it("the person who typed the value has just seen it and is not told; the others are", async () => {
    await typed(U.cadmin, K.complaints, "2026-02-01", 42);
    expect(await whoFor("2026-02-01")).toEqual(TOLD.filter((u) => u !== U.cadmin));
    await typed(U.lead, K.complaints, "2026-03-01", 43);
    expect(await whoFor("2026-03-01")).toEqual(TOLD.filter((u) => u !== U.lead));
  });
});

describe("only an ended period is judged", () => {
  // The running month (firm time), and the 1st of the next, when it has ended.
  const thisMonth = `${firmToday().slice(0, 7)}-01`;
  const nextMonth = (() => {
    const [y, m] = thisMonth.split("-").map(Number) as [number, number];
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  })();
  const lastMonth = (() => {
    const [y, m] = thisMonth.split("-").map(Number) as [number, number];
    return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  })();
  const judge = async (today: string) => (await owner.query(`SELECT app_judge_kpi_periods($1::date) AS n`, [today])).rows[0].n as number;

  it("a month-to-date value tells no one while the month runs; the monthly job judges the month once it has ended, on its latest value, once", async () => {
    const first = await typed(U.cmgr, K.complaints, thisMonth, 42);
    await typed(U.cmgr, K.complaints, thisMonth, 45, first.id);
    expect(await told()).toEqual([]);
    // The app cannot run the job.
    await expect(sqlAs(U.cadmin, `SELECT app_judge_kpi_periods($1::date)`, [nextMonth])).rejects.toThrow(/permission denied/);
    expect(await judge(nextMonth)).toBe(1);
    const rows = await told();
    expect(rows.map((r) => r.user_id).sort()).toEqual(TOLD);
    // About the month's latest value, 45, not the first 42.
    const current = (await owner.query(`SELECT id FROM client_kpi_values WHERE period = $1 AND value = 45`, [thisMonth])).rows[0].id;
    expect(rows.every((r) => r.entity_id === current)).toBe(true);
    expect(await judge(nextMonth)).toBe(0);
    expect(await told()).toHaveLength(TOLD.length);
  });

  it("a running month that ends on the right side tells no one", async () => {
    const first = await typed(U.cmgr, K.complaints, thisMonth, 42);
    await typed(U.cmgr, K.complaints, thisMonth, 25, first.id);
    expect(await judge(nextMonth)).toBe(0);
    expect(await told()).toEqual([]);
  });

  it("a late figure for a month that has ended is judged when saved, even when the running month has a value", async () => {
    await typed(U.cmgr, K.complaints, thisMonth, 25);
    await typed(U.cmgr, K.complaints, lastMonth, 42);
    expect(await whoFor(lastMonth)).toEqual(TOLD);
  });
});

describe("the target date", () => {
  it("once it has passed, a latest value that has not reached the target tells them, even on the right side of the baseline", async () => {
    // Baseline 40, target 20 by 30 June 2026, lower is better: 35 is better than the baseline, short of the target.
    await typed(U.cmgr, K.target, "2026-07-01", 35);
    expect(await whoFor("2026-07-01", K.target)).toEqual(TOLD);
    const item = (await svc(U.cadmin, (tx, p) => N.listNotifications(tx, p))).items.find((i) => i.kind === "indicator.moved_away")!;
    expect(item.facts).toMatchObject({ value: 35, baseline: 40, target: 20, targetDate: "2026-06-30", targetPassed: true });
    // A value that reached the target tells no one.
    await typed(U.cmgr, K.target, "2026-08-01", 20);
    expect(await whoFor("2026-08-01", K.target)).toEqual([]);
  });

  it("before it, the same value tells no one", async () => {
    await typed(U.cmgr, K.future, "2026-07-01", 35);
    expect(await told(K.future)).toEqual([]);
    // Past the baseline it still does.
    await typed(U.cmgr, K.future, "2026-08-01", 41);
    expect(await whoFor("2026-08-01", K.future)).toEqual(TOLD);
  });
});

describe("every way a value arrives", () => {
  it("typed, a file import, a sheet read and a system push each tell them; a sheet or a system tells the person who connected it too", async () => {
    await svc(U.cadmin, (tx, p) => D.chooseDataMode(tx, p, ACME, "connected"));
    await svc(U.cadmin, (tx, p) => D.setIndicatorSource(tx, p, K.complaints, { feedOn: true }));
    // A file the Sales manager brings in (she is not among the people told).
    await fileBatch(U.cmgr, [{ kpiId: K.complaints, period: "2026-02-01", value: 42 }]);
    // The sheet the client's admin connected, read by the daily job.
    await svc(U.cadmin, (tx, p) =>
      D.connectSheet(tx, p, ACME, { label: "Monthly KPIs", url: "https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml?gid=0&single=true" }),
    );
    expect(await runIndicatorFeeds(owner, asUser, async () => "Month,complaints\n2026-03,44\n")).toEqual({ read: 1, failed: 0, added: 1 });
    // The client's system, with the key the client's admin made.
    const { token } = await svc(U.cadmin, (tx, p) => D.createFeedKey(tx, p, ACME, { label: "ERP" }));
    const feed = (await asUser(U.cadmin, (tx) => D.feedByKey(tx, token)))!;
    const pushed = await svc(feed.runAs, (tx, p) => D.pushValues(tx, p, feed, [{ indicator: "complaints", period: "2026-04", value: 46 }]));
    expect(pushed?.added).toBe(1);
    // And typed in.
    await typed(U.cmgr, K.complaints, "2026-05-01", 48);
    const rows = await told();
    const by = (channel: string) => rows.filter((r) => r.channel === channel).map((r) => r.user_id).sort();
    expect(by("file")).toEqual(TOLD);
    expect(by("sheet")).toEqual(TOLD);
    expect(by("api")).toEqual(TOLD);
    expect(by("typed")).toEqual(TOLD);
  });

  it("a file that fills in several periods tells them about the latest one only, and not the admin who brought it in", async () => {
    await svc(U.cadmin, (tx, p) => D.chooseDataMode(tx, p, ACME, "files"));
    await fileBatch(U.cadmin, [
      { kpiId: K.complaints, period: "2026-02-01", value: 41 },
      { kpiId: K.complaints, period: "2026-03-01", value: 42 },
      { kpiId: K.complaints, period: "2026-04-01", value: 43 },
    ]);
    const others = TOLD.filter((u) => u !== U.cadmin);
    expect((await told()).map((r) => r.period)).toEqual(Array(others.length).fill("2026-04-01"));
    expect(await whoFor("2026-04-01")).toEqual(others);
  });
});

describe("nobody else is told", () => {
  it("a lead or deputy whose firm account is switched off is not told; the other is", async () => {
    await owner.query(`UPDATE org_memberships SET active = false WHERE user_id = $1`, [U.deputy]);
    await typed(U.cmgr, K.complaints, "2026-02-01", 42);
    expect(await whoFor("2026-02-01")).toEqual(TOLD.filter((u) => u !== U.deputy));
    await owner.query(`UPDATE org_memberships SET active = true WHERE user_id = $1`, [U.deputy]);
    await owner.query(`UPDATE org_memberships SET active = false WHERE user_id = $1`, [U.lead]);
    await typed(U.cmgr, K.complaints, "2026-03-01", 43);
    expect(await whoFor("2026-03-01")).toEqual(TOLD.filter((u) => u !== U.lead));
  });

  it("an observer on the client's project reads the indicator but is never told, and is offered no mute", async () => {
    await typed(U.cmgr, K.complaints, "2026-02-01", 42);
    await typed(U.cadmin, K.finance, "2026-02-01", 70);
    const who = (await told()).map((r) => r.user_id);
    expect(who).toContain(U.lead);
    expect(who).not.toContain(U.observer);
    expect((await sqlAs(U.observer, `SELECT id FROM client_kpis WHERE id = $1`, [K.complaints])).rowCount).toBe(1);
    expect(await svc(U.observer, (tx, p) => N.indicatorMail(tx, p, K.complaints))).toEqual({ told: false, muted: false });
  });

  it("a manager limited to a department hears nothing about another department's indicator (managers are never told); the lead does", async () => {
    await typed(U.cadmin, K.finance, "2026-02-01", 70); // Finance's, higher is better, baseline 80
    const who = await whoFor("2026-02-01", K.finance);
    expect(who).toEqual(TOLD.filter((u) => u !== U.cadmin));
    expect(who).not.toContain(U.cmgr);
    expect(who).not.toContain(U.fin);
    // She cannot open it, and the page offers her nothing about it.
    expect((await sqlAs(U.cmgr, `SELECT id FROM client_kpis WHERE id = $1`, [K.finance])).rowCount).toBe(0);
    expect(await svc(U.cmgr, (tx, p) => N.indicatorMail(tx, p, K.finance))).toEqual({ told: false, muted: false });
    expect(await svc(U.lead, (tx, p) => N.indicatorMail(tx, p, K.finance))).toEqual({ told: true, muted: false });
  });

  it("an action owner is never told, and cannot mute an indicator he cannot read", async () => {
    await typed(U.cmgr, K.complaints, "2026-02-01", 42);
    await typed(U.cadmin, K.finance, "2026-02-01", 70);
    const who = (await told()).map((r) => r.user_id);
    expect(who).toContain(U.lead);
    expect(who).not.toContain(U.owner1);
    expect(await svc(U.owner1, (tx, p) => N.indicatorMail(tx, p, K.complaints))).toEqual({ told: false, muted: false });
    await expect(svc(U.owner1, (tx, p) => N.setIndicatorMuted(tx, p, K.complaints, true))).rejects.toThrow(/not found/i);
    await expect(sqlAs(U.owner1, `INSERT INTO mail_kpi_mutes (user_id, kpi_id) VALUES ($1,$2)`, [U.owner1, K.complaints])).rejects.toThrow(/row-level security/);
  });

  it("another client's people are never told about Acme's indicator, nor Acme's about theirs", async () => {
    await typed(U.cmgr, K.complaints, "2026-02-01", 42);
    let who = (await told()).map((r) => r.user_id);
    expect(who.sort()).toEqual(TOLD);
    expect(who).not.toContain(U.bAdmin);
    expect(who).not.toContain(U.betaLead);
    await typed(U.betaLead, K.beta, "2026-02-01", 42);
    expect(await whoFor("2026-02-01", K.beta)).toEqual([U.bAdmin]);
    who = (await told(K.beta)).map((r) => r.user_id);
    for (const acme of TOLD) expect(who).not.toContain(acme);
  });
});

describe("mail", () => {
  const digest = async () => (await owner.query(`SELECT app_queue_digests($1::date) AS n`, [firmToday()])).rows[0].n as number;
  const mailedTo = async () => (await owner.query(`SELECT to_email FROM outbound_emails WHERE kind = 'follow_up.digest'`)).rows.map((r) => r.to_email as string).sort();

  it("goes in the summary with the reminders; a person who muted the indicator still sees the notice but gets no mail about it", async () => {
    await svc(U.cadmin, (tx, p) => N.setIndicatorMuted(tx, p, K.complaints, true));
    expect(await svc(U.cadmin, (tx, p) => N.indicatorMail(tx, p, K.complaints))).toEqual({ told: true, muted: true });
    await typed(U.cmgr, K.complaints, "2026-02-01", 42);
    // In-app, everyone is told.
    expect((await told()).map((r) => r.user_id).sort()).toEqual(TOLD);
    expect(await digest()).toBe(3);
    expect(await mailedTo()).toEqual(["cadmin2@example.test", "deputy@example.test", "lead@example.test"]);
    const unmailed = await owner.query(`SELECT user_id FROM notifications WHERE kind = 'indicator.moved_away' AND mailed_at IS NULL`);
    expect(unmailed.rows.map((r) => r.user_id)).toEqual([U.cadmin]);
    // Mutes are each person's own, and listed with their muted actions.
    expect((await sqlAs(U.cadmin2, `SELECT * FROM mail_kpi_mutes`)).rowCount).toBe(0);
    const prefs = await svc(U.cadmin, (tx, p) => N.getMailPreferences(tx, p));
    expect(prefs.mutedIndicators.map((m) => [m.kpiId, m.nameEn])).toEqual([[K.complaints, "Complaints"]]);
    // Unmuted, the next period's notice reaches her mail again.
    await svc(U.cadmin, (tx, p) => N.setIndicatorMuted(tx, p, K.complaints, false));
    await owner.query(`TRUNCATE outbound_emails`);
    await typed(U.cmgr, K.complaints, "2026-03-01", 43);
    await digest();
    expect(await mailedTo()).toContain("cadmin@example.test");
  });

  it("a notice whose figure a correction brought back is hidden from the people told and never mailed; it is kept", async () => {
    const wrong = await typed(U.cmgr, K.complaints, "2026-02-01", 42);
    await typed(U.cmgr, K.complaints, "2026-02-01", 28, wrong.id);
    // Kept: the rows are still there.
    expect((await told()).map((r) => r.user_id).sort()).toEqual(TOLD);
    for (const who of TOLD) {
      const list = await svc(who, (tx, p) => N.listNotifications(tx, p));
      expect(list.items.filter((i) => i.kind === "indicator.moved_away"), who).toEqual([]);
      expect(list.unread, who).toBe(0);
      expect((await sqlAs(who, `SELECT id FROM notifications WHERE kind = 'indicator.moved_away'`)).rowCount, who).toBe(0);
    }
    expect(await digest()).toBe(0);
    expect(await mailedTo()).toEqual([]);
  });

  it("after a correction that stays on the other side, the line states the period's current figure", async () => {
    const wrong = await typed(U.cmgr, K.complaints, "2026-02-01", 42);
    await typed(U.cmgr, K.complaints, "2026-02-01", 45, wrong.id);
    const item = (await svc(U.lead, (tx, p) => N.listNotifications(tx, p))).items.find((i) => i.kind === "indicator.moved_away")!;
    expect(item.facts).toMatchObject({ value: 45, period: "2026-02-01" });
    expect(await digest()).toBe(TOLD.length);
  });

  it("a person no longer among those told gets no mail about it", async () => {
    await typed(U.cmgr, K.complaints, "2026-02-01", 42);
    // The deputy steps down before the summary runs.
    await owner.query(`UPDATE client_assignments SET is_deputy = false WHERE user_id = $1`, [U.deputy]);
    try {
      await digest();
      expect(await mailedTo()).toEqual(["cadmin2@example.test", "cadmin@example.test", "lead@example.test"]);
    } finally {
      await owner.query(`UPDATE client_assignments SET is_deputy = true WHERE user_id = $1`, [U.deputy]);
    }
  });
});
