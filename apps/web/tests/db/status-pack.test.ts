// The monthly status pack (F19, 2026-10-24): the job drafts last month's pack
// on every active client project and tells the lead; the firm adds a note and
// issues it, which freezes the numbers and the lists; only then can it be
// shared. It lists only work the client can be shown, and a client reader
// sees only their own departments' items.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { runStatusPacks } from "@/jobs/status-packs";
import { getReport, shareReport } from "@/services/follow-through";
import { loadPrincipal } from "@/services/principal";
import { issueStatusPack, reportPack } from "@/services/status-pack";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c1a1-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = { admin: id(11), lead: id(12), other: id(13), cadmin: id(14), cman: id(15) };
const P = { acme: id(21), beta: id(22) };
const D = { hr: id(25), fin: id(26) };
const R = { hr: id(31), fin: id(32), secret: id(33), beta: id(34) };
const A = { hr: id(41), fin: id(42), secret: id(43), betaDraft: id(44) };

let today = "";
let from = "";
let to = "";

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
const packId = async () =>
  (await owner.query(`SELECT id FROM reports WHERE project_id = $1 AND kind = 'status_pack'`, [P.acme])).rows[0]?.id as string;

async function seed() {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  const d = (await q(`SELECT app_firm_today()::text AS t,
      (date_trunc('month', app_firm_today()) - interval '1 month')::date::text AS f,
      (date_trunc('month', app_firm_today()) - interval '1 day')::date::text AS e`)).rows[0];
  [today, from, to] = [d.t, d.f, d.e];
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode, departments_enabled) VALUES
      ($1,'firm','firm',NULL,false), ($2,'client','Acme','full',true), ($3,'client','Beta','full',false)`,
    [FIRM, ACME, BETA],
  );
  for (const [name, uid] of Object.entries(U))
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$6,'firm_admin'), ($2,$6,'consultant'), ($3,$6,'consultant'), ($4,$7,'client_admin'), ($5,$7,'client_manager')`,
    [U.admin, U.lead, U.other, U.cadmin, U.cman, FIRM, ACME],
  );
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$3,'الموارد','HR'), ($2,$3,'المالية','Finance')`, [D.hr, D.fin, ACME]);
  await q(`INSERT INTO department_members (department_id, user_id) VALUES ($1,$2)`, [D.hr, U.cman]);
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$3,$5,'Acme governance','active',$6), ($2,'client',$4,$5,'Beta plan','active',$6)`,
    [P.acme, P.beta, ACME, BETA, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [ACME, U.lead]);
  await q(`INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,false), ($1,$3,false)`, [P.acme, U.lead, U.cman]);
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, department_id, created_by) VALUES
      ($1,$4,$5,'People plan','shared',$6,$8), ($2,$4,$5,'Budget rules','shared',$7,$8), ($3,$4,$5,'Replace the CFO','firm_private',NULL,$8),
      ($9,$10,$11,'Plan','shared',NULL,$8)`,
    [R.hr, R.fin, R.secret, P.acme, ACME, D.hr, D.fin, U.lead, R.beta, P.beta, BETA],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, department_id, status, created_by, due_date) VALUES
      ($1,$5,$6,$8,'Hire a head of people',$11,'in_progress',$13,$14),
      ($2,$5,$6,$9,'Write the budget policy',$12,'in_progress',$13,$14),
      ($3,$5,$6,$10,'Find candidates',NULL,'in_progress',$13,$14),
      ($4,$7,$15,$16,'Not released yet',NULL,'draft',$13,$14)`,
    [A.hr, A.fin, A.secret, A.betaDraft, P.acme, ACME, P.beta, R.hr, R.fin, R.secret, D.hr, D.fin, U.lead, from, BETA, R.beta],
  );
}

beforeEach(seed);
afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("the monthly job", () => {
  it("drafts last month's pack once per active client project with released work, and tells the lead", async () => {
    expect(await runStatusPacks(owner, today)).toMatchObject({ drafted: 1 });
    const r = (
      await owner.query(
        `SELECT project_id, generated_by, period_start::text AS s, period_end::text AS e, visibility, metrics FROM reports WHERE kind = 'status_pack'`,
      )
    ).rows;
    // Not Beta: nothing released there.
    expect(r).toEqual([{ project_id: P.acme, generated_by: U.lead, s: from, e: to, visibility: "firm_private", metrics: null }]);
    const n = (await owner.query(`SELECT user_id, entity_id FROM notifications WHERE kind = 'report.pack_drafted'`)).rows;
    expect(n).toEqual([{ user_id: U.lead, entity_id: P.acme }]);
    // Safe to run again.
    expect(await runStatusPacks(owner, today)).toMatchObject({ drafted: 0 });
    expect((await owner.query(`SELECT count(*)::int AS n FROM notifications WHERE kind = 'report.pack_drafted'`)).rows[0].n).toBe(1);
  });

  it("is closed to the app, which can't draft a pack itself either", async () => {
    expect(await refused(sql(U.admin, `SELECT app_draft_status_packs($1::date)`, [today]))).toMatch(/permission denied/);
    expect(
      await refused(
        sql(
          U.lead,
          `INSERT INTO reports (project_id, org_id, kind, title, body_md, generated_by, period_start, period_end) VALUES ($1,$2,'status_pack','x','',$3,$4,$5)`,
          [P.acme, ACME, U.lead, from, to],
        ),
      ),
    ).toMatch(/drafted by the monthly job|row-level security/);
  });
});

describe("a draft", () => {
  beforeEach(async () => {
    await runStatusPacks(owner, today);
  });

  it("is the firm's only, lists what the client can be shown, and can't be shared", async () => {
    const rid = await packId();
    const p = await svc(U.lead, (tx, pr) => reportPack(tx, pr, rid));
    expect(p!.draft).toBe(true);
    expect(p!.live).not.toBeNull();
    // The action under the firm-only recommendation is left out.
    expect(p!.pack.overdue.map((o) => o.id).sort()).toEqual([A.hr, A.fin].sort());
    expect(p!.pack.overdue[0]!.days).toBeGreaterThan(0);
    // Both shared recommendations wait on the client's answer, each with a date.
    expect(p!.pack.decisions.map((x) => [x.kind, x.id]).sort()).toEqual([["response", R.fin], ["response", R.hr]].sort());
    expect(p!.pack.decisions.every((x) => !!x.since)).toBe(true);
    const { can } = await svc(U.lead, (tx, pr) => getReport(tx, pr, rid));
    expect(can).toEqual({ share: false, issue: true });
    expect(await refused(svc(U.lead, (tx, pr) => shareReport(tx, pr, rid)))).toMatch(/issue the status pack/);
    // Straight to the database, too.
    expect(await refused(owner.query(`UPDATE reports SET visibility = 'shared' WHERE id = $1`, [rid]))).toMatch(/changes only its note|reports_pack_issued_before_shared/);
    // The client sees nothing of it.
    expect(await refused(svc(U.cadmin, (tx, pr) => getReport(tx, pr, rid)))).toMatch(/not found/i);
    expect((await sql(U.cadmin, `SELECT id FROM reports WHERE id = $1`, [rid])).rows).toEqual([]);
  });

  it("changes only its note until issued, and keeps its kind", async () => {
    const rid = await packId();
    expect(await refused(sql(U.lead, `UPDATE reports SET title = 'Other' WHERE id = $1`, [rid]))).toMatch(/changes only its note/);
    expect(await refused(sql(U.lead, `UPDATE reports SET kind = 'report' WHERE id = $1`, [rid]))).toMatch(/keeps its kind/);
    expect(
      await refused(sql(U.lead, `UPDATE reports SET metrics = '{}'::jsonb WHERE id = $1`, [rid])),
    ).toMatch(/keeps its lists/);
  });
});

describe("issuing", () => {
  beforeEach(async () => {
    await runStatusPacks(owner, today);
  });

  it("freezes the numbers and the lists, and then it can be shared", async () => {
    const rid = await packId();
    expect(await refused(svc(U.other, (tx, pr) => issueStatusPack(tx, pr, rid, { bodyMd: "x" })))).toMatch(/not found/i);
    await svc(U.lead, (tx, pr) => issueStatusPack(tx, pr, rid, { bodyMd: "  A good month.  " }));
    const row = (await owner.query(`SELECT body_md, metrics, pack FROM reports WHERE id = $1`, [rid])).rows[0];
    expect(row.body_md).toBe("A good month.");
    expect(row.metrics).not.toBeNull();
    expect(row.pack.overdue).toHaveLength(2);
    expect(
      (await owner.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'report.issue_pack' AND resource_id = $1`, [rid])).rows[0].n,
    ).toBe(1);
    // Later work doesn't change it.
    await owner.query(`UPDATE actions SET due_date = $2 WHERE id = $1`, [A.fin, today]);
    const p = await svc(U.lead, (tx, pr) => reportPack(tx, pr, rid));
    expect(p!.draft).toBe(false);
    expect(p!.pack.overdue).toHaveLength(2);
    expect(await refused(svc(U.lead, (tx, pr) => issueStatusPack(tx, pr, rid, { bodyMd: "" })))).toMatch(/already issued/);
    const { can } = await svc(U.lead, (tx, pr) => getReport(tx, pr, rid));
    expect(can).toEqual({ share: true, issue: false });
    await svc(U.lead, (tx, pr) => shareReport(tx, pr, rid));
  });

  it("shows a client reader only their departments' items, and the admin all of them", async () => {
    const rid = await packId();
    await svc(U.lead, (tx, pr) => issueStatusPack(tx, pr, rid, { bodyMd: "" }));
    await svc(U.lead, (tx, pr) => shareReport(tx, pr, rid));
    const forManager = await svc(U.cman, (tx, pr) => reportPack(tx, pr, rid));
    expect(forManager!.pack.overdue.map((o) => o.id)).toEqual([A.hr]);
    const forAdmin = await svc(U.cadmin, (tx, pr) => reportPack(tx, pr, rid));
    expect(forAdmin!.pack.overdue.map((o) => o.id).sort()).toEqual([A.hr, A.fin].sort());
    // Nothing of the firm-only recommendation's work reaches either.
    expect(JSON.stringify(forAdmin!.pack)).not.toContain(A.secret);
  });
});
