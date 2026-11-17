// An observer is read-only on the client's business indicators too (page
// audit N4, decision D4; migration observer_indicators). Indicators belong to
// the client, not to a project, so the observer rule never reached them. A
// consultant changes them only when staffed, not as an observer, on one of
// the client's projects that is not closed, or as its lead or deputy; every
// other consultant who works with the client reads (migrations 0073, 0075). Through the services and straight in the
// database.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authorize, type Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { firmToday } from "@/lib/dates";
import * as I from "@/services/indicators";
import { chooseDataMode, dataSettings, proposeDataMode } from "@/services/indicator-data";
import { getMeeting } from "@/services/meetings";
import { loadPrincipal } from "@/services/principal";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-d4d4-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const MANAGED = id(3); // no accounts: the firm records its figures and its data mode
const P = id(5);
const P_MANAGED = id(6);
const U = {
  admin: id(11), // firm admin
  lead: id(12), // Acme's and Managed's lead
  deputy: id(13), // Acme's deputy
  cons: id(14), // staffed on both projects
  obs: id(15), // observer on both projects, nothing else
  team: id(16), // on both clients' teams, staffed on no project
  cadmin: id(17),
  cmgr: id(18),
};
const REC = id(21);
const K = { acme: id(31), managed: id(32) };
const MEETING = id(41);

const CHANGERS = [U.admin, U.lead, U.deputy, U.cons];
const READERS = [U.obs, U.team];

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
/** Tries a statement as the user and rolls it back: the row count, or the database's refusal. */
const attempt = (userId: string, text: string, params: unknown[] = []) => as(userId, (c) => c.query(text, params));
const svc = <T>(userId: string, fn: (tx: Tx, p: Principal) => Promise<T>, commit = false) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!).catch((e: Error & { cause?: Error }) => {
        throw new Error(e.cause ? `${e.message} | ${e.cause.message}` : e.message);
      });
    },
    commit,
  );
const month = () => `${firmToday().slice(0, 7)}-01`;
const INPUT = {
  nameAr: null,
  nameEn: "New indicator",
  definition: null,
  unit: "%",
  direction: "higher_better" as const,
  frequency: "monthly" as const,
  baseline: 10,
  baselinePeriod: "2020-01-01",
  target: null,
  targetDate: null,
  source: null,
  departmentId: null,
};
const REFUSED = /forbidden|row-level security|insufficient|not allowed|no such client|not found/i;

beforeAll(async () => {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await truncateAuditLog(owner);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode) VALUES ($1,'firm','firm',NULL), ($2,'client','Acme','full'), ($3,'client','Family office','consultant_managed')`,
    [FIRM, ACME, MANAGED],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$9,'firm_admin'), ($2,$9,'consultant'), ($3,$9,'consultant'), ($4,$9,'consultant'), ($5,$9,'consultant'), ($6,$9,'consultant'),
      ($7,$10,'client_admin'), ($8,$10,'client_manager')`,
    [U.admin, U.lead, U.deputy, U.cons, U.obs, U.team, U.cadmin, U.cmgr, FIRM, ACME],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$2,$5,'Acme governance','active',$6), ($3,'client',$4,$5,'Family charter','active',$6)`,
    [P, ACME, P_MANAGED, MANAGED, FIRM, U.admin],
  );
  for (const org of [ACME, MANAGED]) {
    await q(
      `INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES ($1,$2,true,false), ($1,$3,false,$7), ($1,$4,false,false), ($1,$5,false,false), ($1,$6,false,false)`,
      [org, U.lead, U.deputy, U.cons, U.obs, U.team, org === ACME],
    );
  }
  await q(`INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$3,false), ($1,$4,true), ($2,$3,false), ($2,$4,true), ($1,$5,false)`, [
    P,
    P_MANAGED,
    U.cons,
    U.obs,
    U.cmgr,
  ]);
  await q(`INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES ($1,$2,$3,'Set up a complaints desk','shared',$4)`, [
    REC,
    P,
    ACME,
    U.lead,
  ]);
  await q(
    `INSERT INTO meetings (id, project_id, org_id, kind, title, starts_at, ends_at, location, organizer_id, ics_uid)
     VALUES ($1,$2,$3,'status','Status', now() + interval '1 day', now() + interval '25 hours', 'in_person', $4, 'x')`,
    [MEETING, P, ACME, U.lead],
  );
  await q(`INSERT INTO meeting_attendees (meeting_id, user_id, role) VALUES ($1,$2,'organizer'), ($1,$3,'required'), ($1,$4,'required')`, [
    MEETING,
    U.lead,
    U.obs,
    U.cons,
  ]);
});

beforeEach(async () => {
  await owner.query(`DELETE FROM client_kpi_links`);
  await owner.query(`DELETE FROM client_kpi_values`);
  await owner.query(`DELETE FROM client_kpis`);
  await owner.query(`DELETE FROM client_indicator_settings`);
  await owner.query(
    `INSERT INTO client_kpis (id, org_id, name_en, unit, direction, frequency, baseline, baseline_period, created_by) VALUES
      ($1,$3,'Customer complaints','complaints','lower_better','monthly',40,'2020-01-01',$5),
      ($2,$4,'Family meetings held','meetings','higher_better','monthly',1,'2020-01-01',$5)`,
    [K.acme, K.managed, ACME, MANAGED, U.admin],
  );
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("who changes a client's indicators", () => {
  it("the permission check: the admin, the lead, the deputy and a staffed consultant; not an observer or a team-only consultant", async () => {
    const res = { type: "indicator" as const, orgId: ACME, firmOrgId: FIRM, projectId: null };
    for (const permission of ["indicator.report", "indicator.manage", "indicator.link", "indicator.check", "indicator.data"] as const) {
      for (const who of CHANGERS) expect(authorize(await svc(who, async (_tx, p) => p), permission, res).allowed).toBe(true);
      for (const who of READERS) expect(authorize(await svc(who, async (_tx, p) => p), permission, res).allowed).toBe(false);
    }
    // Reading is unchanged for everyone who works with the client.
    for (const who of [...CHANGERS, ...READERS]) expect(authorize(await svc(who, async (_tx, p) => p), "indicator.read", res).allowed).toBe(true);
    // The deputy is Acme's only: on the other client they are a team member staffed on nothing.
    expect(authorize(await svc(U.deputy, async (_tx, p) => p), "indicator.manage", { ...res, orgId: MANAGED }).allowed).toBe(false);
  });

  it("through the services: an observer and a team-only consultant read, and every change is refused", async () => {
    for (const who of READERS) {
      const list = await svc(who, (tx, p) => I.listIndicators(tx, p, ACME));
      expect(list.indicators.map((k) => k.nameEn)).toEqual(["Customer complaints"]);
      expect([list.canManage, list.canReport, list.canImport]).toEqual([false, false, false]);
      const detail = await svc(who, (tx, p) => I.getIndicator(tx, p, K.acme));
      expect([detail.canManage, detail.canReport, detail.canCheck, detail.canDelete]).toEqual([false, false, false, false]);
      expect(detail.linkable).toEqual([]);
      // The recommendation page's link and unlink (the observer opens the project; the team-only consultant does not).
      if (who === U.obs) expect((await svc(who, (tx, p) => I.recommendationIndicators(tx, p, REC)))?.canLink).toBe(false);
      const data = await svc(who, (tx, p) => dataSettings(tx, p, MANAGED));
      expect([data.canChoose, data.canPropose, data.canConnect, data.canManage]).toEqual([false, false, false, false]);

      await expect(svc(who, (tx, p) => I.createIndicator(tx, p, ACME, INPUT))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => I.updateIndicator(tx, p, K.acme, { nameEn: "Renamed" }))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => I.updateIndicator(tx, p, K.acme, { active: false }))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => I.deleteIndicator(tx, p, K.acme))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => I.addValue(tx, p, K.acme, { period: month(), value: 30, note: null }))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => I.linkRecommendation(tx, p, K.acme, REC))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => proposeDataMode(tx, p, ACME, "files"))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => chooseDataMode(tx, p, MANAGED, "files"))).rejects.toThrow(REFUSED);
    }
    // A value the client entered, and a link, for the last two changes.
    const { id: valueId } = await svc(U.cadmin, (tx, p) => I.addValue(tx, p, K.acme, { period: month(), value: 30, note: null }), true);
    await svc(U.lead, (tx, p) => I.linkRecommendation(tx, p, K.acme, REC), true);
    for (const who of READERS) {
      await expect(svc(who, (tx, p) => I.checkValue(tx, p, valueId))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => I.addValue(tx, p, K.acme, { period: month(), value: 31, note: null, supersedesId: valueId }))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => I.unlinkRecommendation(tx, p, K.acme, REC))).rejects.toThrow(REFUSED);
    }
  });

  it("through the services: a staffed consultant, the lead, the deputy and the firm admin still do all of it", async () => {
    for (const who of CHANGERS) {
      const list = await svc(who, (tx, p) => I.listIndicators(tx, p, ACME));
      expect([list.canManage, list.canReport]).toEqual([true, true]);
      const made = await svc(who, (tx, p) => I.createIndicator(tx, p, ACME, INPUT), true);
      await svc(who, (tx, p) => I.updateIndicator(tx, p, made.id, { nameEn: "Renamed" }), true);
      await svc(who, (tx, p) => I.linkRecommendation(tx, p, made.id, REC), true);
      await svc(who, (tx, p) => I.unlinkRecommendation(tx, p, made.id, REC), true);
      const { id: mine } = await svc(who, (tx, p) => I.addValue(tx, p, made.id, { period: month(), value: 12, note: null }), true);
      await svc(who, (tx, p) => I.addValue(tx, p, made.id, { period: month(), value: 13, note: null, supersedesId: mine }), true);
      await svc(who, (tx, p) => I.updateIndicator(tx, p, made.id, { active: false }), true);
    }
    // The firm checks what the client entered.
    const { id: valueId } = await svc(U.cadmin, (tx, p) => I.addValue(tx, p, K.acme, { period: month(), value: 30, note: null }), true);
    await svc(U.cons, (tx, p) => I.checkValue(tx, p, valueId), true);
    await svc(U.cons, (tx, p) => proposeDataMode(tx, p, ACME, "files"), true);
    // For a client with no accounts the firm records the choice itself: the staffed consultant and the lead, not the deputy of another client.
    await svc(U.cons, (tx, p) => chooseDataMode(tx, p, MANAGED, "files"), true);
    await svc(U.lead, (tx, p) => chooseDataMode(tx, p, MANAGED, "typed"), true);
    await expect(svc(U.deputy, (tx, p) => chooseDataMode(tx, p, MANAGED, "files"))).rejects.toThrow(REFUSED);
  });

  it("the client's own roles are unchanged", async () => {
    await svc(U.cadmin, (tx, p) => I.createIndicator(tx, p, ACME, INPUT), true);
    await svc(U.cmgr, (tx, p) => I.addValue(tx, p, K.acme, { period: month(), value: 30, note: null }), true);
    await expect(svc(U.cmgr, (tx, p) => I.createIndicator(tx, p, ACME, INPUT))).rejects.toThrow(REFUSED);
  });

  it("straight in the database: an observer and a team-only consultant write nothing", async () => {
    const value = (await owner.query(
      `INSERT INTO client_kpi_values (kpi_id, org_id, period, value, entered_by) VALUES ($1,$2,date_trunc('month', app_firm_today())::date,30,$3) RETURNING id`,
      [K.acme, ACME, U.cadmin],
    )).rows[0].id as string;
    await owner.query(`INSERT INTO client_kpi_links (kpi_id, org_id, recommendation_id, created_by) VALUES ($1,$2,$3,$4)`, [K.acme, ACME, REC, U.lead]);
    const RLS = /row-level security/;
    for (const who of READERS) {
      // They still read.
      expect((await attempt(who, `SELECT 1 FROM client_kpis WHERE org_id = $1`, [ACME])).rowCount).toBe(1);
      expect((await attempt(who, `SELECT 1 FROM client_kpi_values`)).rowCount).toBe(1);
      // A link shows to whoever reads both ends: the observer opens the project, the team-only consultant does not.
      expect((await attempt(who, `SELECT 1 FROM client_kpi_links`)).rowCount).toBe(who === U.obs ? 1 : 0);
      await expect(
        attempt(
          who,
          `INSERT INTO client_kpis (org_id, name_en, unit, direction, frequency, baseline, baseline_period, created_by) VALUES ($1,'x','%','higher_better','monthly',1,'2020-01-01',$2)`,
          [ACME, who],
        ),
      ).rejects.toThrow(RLS);
      expect((await attempt(who, `UPDATE client_kpis SET name_en = 'Renamed' WHERE id = $1`, [K.acme])).rowCount).toBe(0);
      expect((await attempt(who, `UPDATE client_kpis SET active = false WHERE id = $1`, [K.acme])).rowCount).toBe(0);
      expect((await attempt(who, `DELETE FROM client_kpis WHERE id = $1`, [K.managed])).rowCount).toBe(0);
      await expect(
        attempt(who, `INSERT INTO client_kpi_values (kpi_id, org_id, period, value, entered_by, supersedes_id) VALUES ($1,$2,date_trunc('month', app_firm_today())::date,31,$3,$4)`, [
          K.acme,
          ACME,
          who,
          value,
        ]),
      ).rejects.toThrow(RLS);
      await expect(
        attempt(who, `INSERT INTO client_kpi_values (kpi_id, org_id, period, value, entered_by) VALUES ($1,$2,date_trunc('month', app_firm_today())::date,1,$3)`, [
          K.managed,
          MANAGED,
          who,
        ]),
      ).rejects.toThrow(RLS);
      expect((await attempt(who, `UPDATE client_kpi_values SET checked_by = $1, checked_at = now() WHERE id = $2`, [who, value])).rowCount).toBe(0);
      expect((await attempt(who, `DELETE FROM client_kpi_links WHERE kpi_id = $1`, [K.acme])).rowCount).toBe(0);
      await owner.query(`DELETE FROM client_kpi_links`);
      await expect(
        attempt(who, `INSERT INTO client_kpi_links (kpi_id, org_id, recommendation_id, created_by) VALUES ($1,$2,$3,$4)`, [K.acme, ACME, REC, who]),
      ).rejects.toThrow(RLS);
      await owner.query(`INSERT INTO client_kpi_links (kpi_id, org_id, recommendation_id, created_by) VALUES ($1,$2,$3,$4)`, [K.acme, ACME, REC, U.lead]);
      await expect(attempt(who, `SELECT app_propose_kpi_data_mode($1, 'files')`, [ACME])).rejects.toThrow(/no such client/);
      await expect(attempt(who, `INSERT INTO client_indicator_settings (org_id, data_mode) VALUES ($1, 'files')`, [MANAGED])).rejects.toThrow(RLS);
      expect((await attempt(who, `SELECT app_firm_changes_kpis($1) AS ok`, [ACME])).rows[0].ok).toBe(false);
    }
  });

  it("straight in the database: a staffed consultant, the lead, the deputy and the firm admin still write", async () => {
    const value = (await owner.query(
      `INSERT INTO client_kpi_values (kpi_id, org_id, period, value, entered_by) VALUES ($1,$2,date_trunc('month', app_firm_today())::date,30,$3) RETURNING id`,
      [K.acme, ACME, U.cadmin],
    )).rows[0].id as string;
    for (const who of CHANGERS) {
      expect((await attempt(who, `SELECT app_firm_changes_kpis($1) AS ok`, [ACME])).rows[0].ok).toBe(true);
      expect(
        (
          await attempt(
            who,
            `INSERT INTO client_kpis (org_id, name_en, unit, direction, frequency, baseline, baseline_period, created_by) VALUES ($1,'x','%','higher_better','monthly',1,'2020-01-01',$2)`,
            [ACME, who],
          )
        ).rowCount,
      ).toBe(1);
      expect((await attempt(who, `UPDATE client_kpis SET active = false WHERE id = $1`, [K.acme])).rowCount).toBe(1);
      expect((await attempt(who, `UPDATE client_kpi_values SET checked_by = $1, checked_at = now() WHERE id = $2`, [who, value])).rowCount).toBe(1);
      expect(
        (
          await attempt(who, `INSERT INTO client_kpi_values (kpi_id, org_id, period, value, entered_by, supersedes_id) VALUES ($1,$2,date_trunc('month', app_firm_today())::date,31,$3,$4)`, [
            K.acme,
            ACME,
            who,
            value,
          ])
        ).rowCount,
      ).toBe(1);
      expect(
        (await attempt(who, `INSERT INTO client_kpi_links (kpi_id, org_id, recommendation_id, created_by) VALUES ($1,$2,$3,$4)`, [K.acme, ACME, REC, who])).rowCount,
      ).toBe(1);
      await attempt(who, `SELECT app_propose_kpi_data_mode($1, 'files')`, [ACME]);
    }
    // Another firm's reach is unchanged: nobody from outside the client's team.
    expect((await attempt(U.deputy, `SELECT app_firm_changes_kpis($1) AS ok`, [MANAGED])).rows[0].ok).toBe(false);
    for (const who of [U.cadmin, U.cmgr]) expect((await attempt(who, `SELECT app_firm_changes_kpis($1) AS ok`, [ACME])).rows[0].ok).toBe(false);
  });
});

// Decision 1c (product owner, 17 Nov 2026; migration 0083_indicator_links_firm): only
// firm staff link an indicator to a recommendation. The link is the consultant's
// statement that the recommendation should move the number; the client reads the
// links it may see, and still sets up and changes its own indicators. This block
// failed before 0083 and the policy.ts change (the client admin could link and unlink).
describe("linking an indicator to a recommendation is the firm's", () => {
  it("a client admin's link and unlink are refused (Not found) through the API, and the page offers neither", async () => {
    await expect(svc(U.cadmin, (tx, p) => I.linkRecommendation(tx, p, K.acme, REC))).rejects.toThrow(/forbidden/);
    await svc(U.lead, (tx, p) => I.linkRecommendation(tx, p, K.acme, REC), true);
    await expect(svc(U.cadmin, (tx, p) => I.unlinkRecommendation(tx, p, K.acme, REC))).rejects.toThrow(/forbidden/);
    const res = { type: "indicator" as const, orgId: ACME, firmOrgId: FIRM, projectId: null };
    for (const who of [U.cadmin, U.cmgr]) expect(authorize(await svc(who, async (_tx, p) => p), "indicator.link", res).allowed).toBe(false);
    // She still reads the link, sets up and changes her indicators, and enters values.
    const detail = await svc(U.cadmin, (tx, p) => I.getIndicator(tx, p, K.acme));
    expect(detail.links.map((l) => l.id)).toEqual([REC]);
    expect([detail.canManage, detail.canLink, detail.linkable]).toEqual([true, false, []]);
    expect(await svc(U.cadmin, (tx, p) => I.recommendationIndicators(tx, p, REC))).toMatchObject({ canLink: false, others: [] });
    const mine = await svc(U.cadmin, (tx, p) => I.createIndicator(tx, p, ACME, INPUT), true);
    await svc(U.cadmin, (tx, p) => I.updateIndicator(tx, p, mine.id, { nameEn: "Renamed" }), true);
  });

  it("refused straight in the database too, while the link still shows to her", async () => {
    await owner.query(`INSERT INTO client_kpi_links (kpi_id, org_id, recommendation_id, created_by) VALUES ($1,$2,$3,$4)`, [K.acme, ACME, REC, U.lead]);
    expect((await attempt(U.cadmin, `SELECT 1 FROM client_kpi_links`)).rowCount).toBe(1);
    expect((await attempt(U.cadmin, `DELETE FROM client_kpi_links WHERE kpi_id = $1`, [K.acme])).rowCount).toBe(0);
    await owner.query(`DELETE FROM client_kpi_links`);
    await expect(
      attempt(U.cadmin, `INSERT INTO client_kpi_links (kpi_id, org_id, recommendation_id, created_by) VALUES ($1,$2,$3,$4)`, [K.acme, ACME, REC, U.cadmin]),
    ).rejects.toThrow(/row-level security/);
  });

  it("the lead and a staffed consultant link and unlink; an observer cannot (D4)", async () => {
    for (const who of [U.lead, U.cons]) {
      await svc(who, (tx, p) => I.linkRecommendation(tx, p, K.acme, REC), true);
      expect((await svc(who, (tx, p) => I.getIndicator(tx, p, K.acme))).canLink).toBe(true);
      await svc(who, (tx, p) => I.unlinkRecommendation(tx, p, K.acme, REC), true);
    }
    await expect(svc(U.obs, (tx, p) => I.linkRecommendation(tx, p, K.acme, REC))).rejects.toThrow(REFUSED);
    await expect(
      attempt(U.obs, `INSERT INTO client_kpi_links (kpi_id, org_id, recommendation_id, created_by) VALUES ($1,$2,$3,$4)`, [K.acme, ACME, REC, U.obs]),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("who changes a client's indicators, across several of its projects", () => {
  const P2 = id(7); // another active Acme project
  const P_CLOSED = id(8); // a closed Acme project
  const res = { type: "indicator" as const, orgId: ACME, firmOrgId: FIRM, projectId: null };
  /** The app's answer and the database's, then a value actually entered in the database. */
  const changes = async (who: string) => {
    const inApp = authorize(await svc(who, async (_tx, p) => p), "indicator.report", res).allowed;
    const db = (await attempt(who, `SELECT app_firm_changes_kpis($1) AS ok`, [ACME])).rows[0].ok as boolean;
    const wrote = await attempt(
      who,
      `INSERT INTO client_kpi_values (kpi_id, org_id, period, value, entered_by) VALUES ($1,$2,date_trunc('month', app_firm_today())::date,7,$3)`,
      [K.acme, ACME, who],
    ).then(
      () => true,
      (e: Error) => (/row-level security/.test(e.message) ? false : Promise.reject(e)),
    );
    return { app: inApp, db, wrote };
  };
  const YES = { app: true, db: true, wrote: true };
  const NO = { app: false, db: false, wrote: false };

  beforeAll(async () => {
    await owner.query(
      `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
        ($1,'client',$3,$4,'Acme strategy','active',$5), ($2,'client',$3,$4,'Acme old review','closed',$5)`,
      [P2, P_CLOSED, ACME, FIRM, U.admin],
    );
  });
  afterAll(async () => {
    await owner.query(`DELETE FROM project_members WHERE project_id = ANY($1)`, [[P2, P_CLOSED]]);
    await owner.query(`DELETE FROM projects WHERE id = ANY($1)`, [[P2, P_CLOSED]]);
  });

  it("a consultant who observes one project and is staffed on another of the client's writes", async () => {
    expect(await changes(U.obs)).toEqual(NO);
    await owner.query(`INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,false)`, [P2, U.obs]);
    try {
      expect(await changes(U.obs)).toEqual(YES);
      // The service too: the value goes in.
      await svc(U.obs, (tx, p) => I.addValue(tx, p, K.acme, { period: month(), value: 8, note: null }));
    } finally {
      await owner.query(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [P2, U.obs]);
    }
  });

  it("the client's lead or deputy writes; they never observe one of its projects", async () => {
    for (const who of [U.lead, U.deputy]) {
      expect(await changes(who)).toEqual(YES);
      // The database keeps a lead or deputy from observing the client's projects (migration 0051)...
      await expect(owner.query(`INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,true)`, [P, who])).rejects.toThrow(
        /works on its projects, not as an observer/,
      );
    }
    // ...and naming an observer the deputy ends their observing there: they write as the deputy.
    await owner.query(`UPDATE client_assignments SET is_deputy = false WHERE client_org_id = $1 AND user_id = $2`, [ACME, U.deputy]);
    await owner.query(`UPDATE client_assignments SET is_deputy = true WHERE client_org_id = $1 AND user_id = $2`, [ACME, U.obs]);
    try {
      expect((await owner.query(`SELECT observer FROM project_members WHERE project_id = $1 AND user_id = $2`, [P, U.obs])).rows).toEqual([{ observer: false }]);
      expect(await changes(U.obs)).toEqual(YES);
      await svc(U.obs, (tx, p) => I.addValue(tx, p, K.acme, { period: month(), value: 9, note: null }));
    } finally {
      await owner.query(`UPDATE client_assignments SET is_deputy = false WHERE client_org_id = $1 AND user_id = $2`, [ACME, U.obs]);
      await owner.query(`UPDATE client_assignments SET is_deputy = true WHERE client_org_id = $1 AND user_id = $2`, [ACME, U.deputy]);
      await owner.query(`UPDATE project_members SET observer = true WHERE project_id = $1 AND user_id = $2`, [P, U.obs]);
    }
    expect(await changes(U.obs)).toEqual(NO);
  });

  it("a consultant staffed only on a closed project does not write: a closed project is read-only", async () => {
    await owner.query(`INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,false)`, [P_CLOSED, U.team]);
    try {
      expect(await changes(U.team)).toEqual(NO);
      await expect(svc(U.team, (tx, p) => I.addValue(tx, p, K.acme, { period: month(), value: 10, note: null }))).rejects.toThrow(REFUSED);
      // They still read.
      expect((await svc(U.team, (tx, p) => I.listIndicators(tx, p, ACME))).indicators.map((k) => k.nameEn)).toEqual(["Customer complaints"]);
      // Staffed on an open project of the client as well: they write again.
      await owner.query(`INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,false)`, [P2, U.team]);
      expect(await changes(U.team)).toEqual(YES);
    } finally {
      await owner.query(`DELETE FROM project_members WHERE project_id = ANY($1) AND user_id = $2`, [[P_CLOSED, P2], U.team]);
    }
  });
});

describe("an observer on a meeting", () => {
  it("is offered no control the database refuses, while a staffed consultant keeps them", async () => {
    const observer = await svc(U.obs, (tx, p) => getMeeting(tx, p, MEETING));
    expect([observer.canRun, observer.canFollowUp, observer.canRespond]).toEqual([false, false, false]);
    const staffed = await svc(U.cons, (tx, p) => getMeeting(tx, p, MEETING));
    expect([staffed.canRun, staffed.canFollowUp, staffed.canRespond]).toEqual([true, true, true]);
    // What the page no longer offers the observer is what the database refuses.
    await expect(attempt(U.obs, `UPDATE meetings SET title = 'x' WHERE id = $1`, [MEETING])).rejects.toThrow(/you observe this project/);
    await expect(attempt(U.obs, `UPDATE meeting_attendees SET response = 'accepted' WHERE meeting_id = $1 AND user_id = $2`, [MEETING, U.obs])).rejects.toThrow(
      /you observe this project/,
    );
  });
});
