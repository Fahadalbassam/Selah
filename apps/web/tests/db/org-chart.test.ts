// The client's organisation structure (org chart, migration 0100), part 1:
// the data, the rules and the services. Who reads which version and whose
// names, who edits the draft, who publishes, who changes the people in
// positions; no cycles; publishing freezes the structure; the chart never
// grants or limits access to any work. Through the services and straight in
// the database.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { firmToday } from "@/lib/dates";
import { engagementError } from "@/lib/engagement";
import { ORG_CHART_REQUEST_STATUSES, ORG_CHART_STATES, ORG_UNIT_KINDS } from "@/lib/org-chart";
import { getEngagement, setEngagement } from "@/services/engagement";
import * as OC from "@/services/org-chart";
import { loadPrincipal } from "@/services/principal";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-0c0c-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2); // full, departments on: the chart under test
const OTHER = id(3); // another client of the firm, with its own people
const MANAGED = id(4); // consultant-managed with minimal records: titles only
const FAMILY = id(5); // consultant-managed, switched to minimal records later
const P = id(6);
const P_OTHER = id(7);
const P_MANAGED = id(8);
const P_FAMILY = id(9);
const DEPT = { fin: id(10), hr: id(11) };
const U = {
  admin: id(21), // firm admin
  lead: id(22), // the lead of Acme, Managed and Family
  deputy: id(23), // Acme's deputy
  cons: id(24), // staffed on Acme's project
  obs: id(25), // observer on Acme's project
  team: id(26), // on Acme's team, staffed on nothing
  cadmin: id(27),
  mgr: id(28), // Acme manager in Finance; holds the HR director position
  mgr2: id(29), // Acme manager in no department
  owner: id(30), // Acme action owner in Finance; holds the analyst position
  oadmin: id(31),
  omgr: id(32),
  oowner: id(33),
};
const REC = { all: id(41), hr: id(42) };
const ACT = { fin: id(43), hr: id(44), all: id(45) };
const KPI = { all: id(46), hr: id(47) };

const REFUSED = /forbidden|row-level security|insufficient|not allowed|not found|no such/i;
const RLS = /row-level security/;
const PAST = "2025-01-01";

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
/** Tries a statement as the user and rolls it back: the result, or the database's refusal. */
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

/** What a person may read of the client's work, straight from row-level security. */
const readable = async (userId: string) => ({
  actions: (await attempt(userId, `SELECT id FROM actions ORDER BY id`)).rows.map((r) => r.id as string),
  recommendations: (await attempt(userId, `SELECT id FROM recommendations ORDER BY id`)).rows.map((r) => r.id as string),
  indicators: (await attempt(userId, `SELECT id FROM client_kpis ORDER BY id`)).rows.map((r) => r.id as string),
});

const before: Record<string, Awaited<ReturnType<typeof readable>>> = {};
let CHART = "";
let V1 = "";
/** Acme's second version, published at the end of "publishing freezes the snapshot". */
let V2 = "";
/** Acme's positions and units by name, as first published. */
const POS: Record<string, string> = {};
const UNIT: Record<string, string> = {};

const holderNames = (chart: { positions: OC.OrgPosition[] }) =>
  Object.fromEntries(
    chart.positions.filter((p) => p.holders.length).map((p) => [p.titleEn!, p.holders.map((h) => h.name)]),
  ) as Record<string, (string | null)[]>;

beforeAll(async () => {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await truncateAuditLog(owner);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode, departments_enabled, minimal_records, display_alias) VALUES
      ($1,'firm','firm',NULL,false,false,NULL), ($2,'client','Acme','full',true,false,NULL), ($3,'client','Other','full',false,false,NULL),
      ($4,'client','Managed','consultant_managed',false,true,'Family office A'), ($5,'client','Family','consultant_managed',false,false,NULL)`,
    [FIRM, ACME, OTHER, MANAGED, FAMILY],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, `${name} person`, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$14,'firm_admin'), ($2,$14,'consultant'), ($3,$14,'consultant'), ($4,$14,'consultant'), ($5,$14,'consultant'), ($6,$14,'consultant'),
      ($7,$15,'client_admin'), ($8,$15,'client_manager'), ($9,$15,'client_manager'), ($10,$15,'action_owner'),
      ($11,$16,'client_admin'), ($12,$16,'client_manager'), ($13,$16,'action_owner')`,
    [U.admin, U.lead, U.deputy, U.cons, U.obs, U.team, U.cadmin, U.mgr, U.mgr2, U.owner, U.oadmin, U.omgr, U.oowner, FIRM, ACME, OTHER],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$2,$9,'Acme governance','active',$10), ($3,'client',$4,$9,'Other governance','active',$10),
      ($5,'client',$6,$9,'Managed charter','active',$10), ($7,'client',$8,$9,'Family charter','active',$10)`,
    [P, ACME, P_OTHER, OTHER, P_MANAGED, MANAGED, P_FAMILY, FAMILY, FIRM, U.admin],
  );
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES
      ($1,$2,true,false), ($1,$3,false,true), ($1,$4,false,false), ($1,$5,false,false), ($1,$6,false,false),
      ($7,$2,true,false), ($8,$2,true,false)`,
    [ACME, U.lead, U.deputy, U.cons, U.obs, U.team, MANAGED, FAMILY],
  );
  await q(
    `INSERT INTO project_members (project_id, user_id, observer) VALUES
      ($1,$3,false), ($1,$4,true), ($1,$5,false), ($1,$6,false), ($1,$7,false), ($2,$8,false), ($2,$9,false)`,
    [P, P_OTHER, U.cons, U.obs, U.mgr, U.mgr2, U.owner, U.omgr, U.oowner],
  );
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$3,'المالية','Finance'), ($2,$3,'الموارد البشرية','Human resources')`, [
    DEPT.fin,
    DEPT.hr,
    ACME,
  ]);
  await q(`INSERT INTO department_members (department_id, user_id) VALUES ($1,$2), ($1,$3)`, [DEPT.fin, U.mgr, U.owner]);
  // Work the chart must not change anyone's view of: company-wide, Finance's and HR's.
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, department_id, created_by) VALUES
      ($1,$3,$4,'Form the audit committee','shared',NULL,$6), ($2,$3,$4,'Review HR policies','shared',$5,$6)`,
    [REC.all, REC.hr, P, ACME, DEPT.hr, U.lead],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, department_id, created_by) VALUES
      ($1,$4,$5,$6,'Finance canary',$8,'in_progress',app_firm_today() + 30,$10,$11),
      ($2,$4,$5,$7,'HR canary',$9,'in_progress',app_firm_today() + 30,$12,$11),
      ($3,$4,$5,$6,'Company canary',$8,'in_progress',app_firm_today() + 30,NULL,$11)`,
    [ACT.fin, ACT.hr, ACT.all, P, ACME, REC.all, REC.hr, U.owner, U.mgr2, DEPT.fin, U.lead, DEPT.hr],
  );
  await q(
    `INSERT INTO client_kpis (id, org_id, department_id, name_en, unit, direction, frequency, baseline, baseline_period, created_by) VALUES
      ($1,$3,NULL,'Complaints','complaints','lower_better','monthly',40,'2020-01-01',$5),
      ($2,$3,$4,'Staff turnover','%','lower_better','monthly',12,'2020-01-01',$5)`,
    [KPI.all, KPI.hr, ACME, DEPT.hr, U.admin],
  );
  // What each client person reads before Acme has any structure.
  for (const who of [U.cadmin, U.mgr, U.mgr2, U.owner]) before[who] = await readable(who);

  // Acme's structure, as the lead builds it, then published.
  CHART = (await svc(U.lead, (tx, p) => OC.startChart(tx, p, ACME), true)).id;
  const unit = async (key: string, input: OC.UnitInput, parent?: string) => {
    UNIT[key] = (await svc(U.lead, (tx, p) => OC.addUnit(tx, p, ACME, { ...input, parentId: parent ? UNIT[parent] : null }), true)).id;
  };
  await unit("board", { kind: "board", nameAr: "مجلس الإدارة", nameEn: "Board" });
  await unit("ceo", { kind: "executive", nameAr: "الرئيس التنفيذي", nameEn: "Chief executive" }, "board");
  await unit("audit", { kind: "unit", nameAr: "المراجعة الداخلية", nameEn: "Internal audit", advisory: true }, "ceo");
  await unit("fin", { kind: "department", nameAr: "الإدارة المالية", nameEn: "Finance", departmentId: DEPT.fin }, "ceo");
  await unit("ap", { kind: "section", nameAr: "قسم الدائنين", nameEn: "Payables" }, "fin");
  await unit("hr", { kind: "department", nameAr: "الموارد البشرية", nameEn: "Human resources", departmentId: DEPT.hr }, "ceo");
  const position = async (key: string, unitKey: string, input: OC.PositionInput) => {
    POS[key] = (await svc(U.lead, (tx, p) => OC.addPosition(tx, p, UNIT[unitKey]!, input), true)).id;
  };
  await position("chair", "board", { titleAr: "رئيس المجلس", titleEn: "Chair", isHead: true });
  await position("ceo", "ceo", { titleAr: "الرئيس التنفيذي", titleEn: "CEO", isHead: true, reportsToId: POS.chair });
  await position("auditor", "audit", { titleAr: "المراجع الداخلي", titleEn: "Internal auditor", reportsToId: POS.chair });
  await position("cfo", "fin", { titleAr: "المدير المالي", titleEn: "Chief Financial Officer", isHead: true, reportsToId: POS.ceo });
  await position("analyst", "fin", { titleAr: "محلل مالي", titleEn: "Analyst", reportsToId: POS.cfo, specialties: [" budgets ", "reporting", "budgets"] });
  await position("ap", "ap", { titleAr: "رئيس قسم الدائنين", titleEn: "Payables lead", isHead: true, reportsToId: POS.cfo });
  await position("clerk", "ap", { titleAr: "محاسب", titleEn: "Clerk", reportsToId: POS.ap, plannedCount: 3 });
  await position("hrd", "hr", { titleAr: "مدير الموارد البشرية", titleEn: "HR director", isHead: true, reportsToId: POS.ceo });
  await position("hro", "hr", { titleAr: "أخصائي موارد بشرية", titleEn: "HR officer", reportsToId: POS.hrd });
  V1 = (await svc(U.lead, (tx, p) => OC.publish(tx, p, ACME, { effectiveOn: firmToday() }), true)).versionId;
  // The client's admin puts the people in (HR officer stays vacant).
  const hold = (key: string, start: OC.HolderChange["start"]) => svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, POS[key]!, { start }), true);
  await hold("chair", { name: "Hessa Chair", from: PAST });
  await hold("ceo", { name: "Nasser Ceo", from: PAST });
  await hold("auditor", { name: "Auditor Person", from: PAST });
  await hold("cfo", { name: "Cfo Person", from: PAST });
  await hold("analyst", { userId: U.owner, from: PAST });
  await hold("ap", { name: "Payables Lead", from: PAST });
  await hold("clerk", { name: "Clerk One", from: PAST });
  await hold("hrd", { userId: U.mgr, from: PAST });
});

beforeEach(async () => {
  await owner.query(`UPDATE org_chart_versions SET show_names = false WHERE id = $1`, [V1]);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("the shape", () => {
  it("one chart per client; one draft and one current version; the published version keeps its rows and a snapshot without names", async () => {
    const versions = (await owner.query(`SELECT state, number, effective_on IS NOT NULL AS dated, published_by FROM org_chart_versions WHERE chart_id = $1 ORDER BY number NULLS LAST`, [CHART]))
      .rows;
    expect(versions).toEqual([
      { state: "published", number: 1, dated: true, published_by: U.lead },
      { state: "draft", number: null, dated: false, published_by: null },
    ]);
    const snap = (await owner.query(`SELECT published_snapshot AS s FROM org_chart_versions WHERE id = $1`, [V1])).rows[0].s;
    expect(snap.units).toHaveLength(6);
    expect(snap.positions).toHaveLength(9);
    expect(JSON.stringify(snap)).not.toMatch(/Hessa|Cfo Person|owner person/);
    // The draft is a copy: same codes, same lineages, new rows.
    const draft = await svc(U.lead, (tx, p) => OC.getDraft(tx, p, ACME));
    expect(draft.positions.map((p) => p.lineageId).sort()).toEqual(Object.values(POS).sort());
    expect(draft.positions.some((p) => Object.values(POS).includes(p.id))).toBe(false);
    // Codes come from the tree; specialties are kept trimmed, once each.
    const analyst = draft.positions.find((p) => p.titleEn === "Analyst")!;
    expect([analyst.code, analyst.specialties]).toEqual(["1.1.2.2", ["budgets", "reporting"]]);
    // The holders follow the position into the draft.
    expect(holderNames(draft)["Chief Financial Officer"]).toEqual(["Cfo Person"]);
    await expect(owner.query(`INSERT INTO org_charts (org_id, created_by) VALUES ($1,$2)`, [ACME, U.lead])).rejects.toThrow(/unique/);
  });

  it("the lists match the database (parity)", async () => {
    const values = async (type: string) => (await owner.query(`SELECT unnest(enum_range(NULL::${type}))::text AS v`)).rows.map((r) => r.v);
    expect(await values("org_unit_kind")).toEqual([...ORG_UNIT_KINDS]);
    expect(await values("org_chart_state")).toEqual([...ORG_CHART_STATES]);
    expect(await values("org_chart_request_status")).toEqual([...ORG_CHART_REQUEST_STATUSES]);
    const draft = (await owner.query(`SELECT id FROM org_chart_versions WHERE chart_id = $1 AND state = 'draft'`, [CHART])).rows[0].id;
    const unitIn = (await owner.query(`SELECT id FROM org_units WHERE version_id = $1 LIMIT 1`, [draft])).rows[0].id;
    const tryPosition = (cols: string) =>
      attempt(U.lead, `INSERT INTO positions (version_id, org_id, unit_id, code, title_en, ${cols.split("=")[0]}) VALUES ($1,$2,$3,'9.9','x',${cols.split("=")[1]})`, [
        draft,
        ACME,
        unitIn,
      ]);
    await expect(tryPosition("planned_count=1000")).rejects.toThrow(/position_planned/);
    await expect(tryPosition("planned_count=999")).resolves.toBeTruthy();
    await expect(tryPosition(`specialties=ARRAY(SELECT 's' || g FROM generate_series(1, 31) g)`)).rejects.toThrow(/position_specialties/);
    await expect(tryPosition(`specialties=ARRAY(SELECT 's' || g FROM generate_series(1, 30) g)`)).resolves.toBeTruthy();
    await expect(attempt(U.lead, `INSERT INTO org_units (version_id, org_id, kind, code, name_en, level) VALUES ($1,$2,'unit','9 9','x',1)`, [draft, ACME])).rejects.toThrow(
      /org_unit_code/,
    );
    await expect(attempt(U.lead, `INSERT INTO org_units (version_id, org_id, kind, code, name_en, level) VALUES ($1,$2,'unit','99','x',13)`, [draft, ACME])).rejects.toThrow(
      /org_unit_level/,
    );
  });
});

describe("another client's chart", () => {
  it("is 404 for every account of another client, through every service", async () => {
    for (const who of [U.oadmin, U.omgr, U.oowner]) {
      await expect(svc(who, (tx, p) => OC.getPublishedChart(tx, p, ACME))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => OC.getDraft(tx, p, ACME))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => OC.listVersions(tx, p, ACME))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => OC.getVersion(tx, p, V1))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => OC.listVacancies(tx, p, ACME))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => OC.listChangeRequests(tx, p, ACME))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => OC.suggestChange(tx, p, ACME, { what: "Merge finance" }))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => OC.changeHolder(tx, p, POS.hro!, { start: { name: "Someone Else", from: PAST } }))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => OC.setShowNames(tx, p, V1, true))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => OC.addUnit(tx, p, ACME, { kind: "unit", nameEn: "x" }))).rejects.toThrow(REFUSED);
      expect(await svc(who, (tx, p) => OC.myManager(tx, p))).toEqual([]);
    }
  });

  it("is invisible in the database to every account of another client", async () => {
    for (const who of [U.oadmin, U.omgr, U.oowner]) {
      for (const table of ["org_charts", "org_chart_versions", "org_units", "positions", "position_holders", "org_chart_change_requests"]) {
        expect((await attempt(who, `SELECT 1 FROM ${table}`)).rowCount, `${who} ${table}`).toBe(0);
      }
      expect((await attempt(who, `SELECT * FROM app_org_chart_holders($1, app_firm_today())`, [V1])).rowCount).toBe(0);
      expect((await attempt(who, `SELECT * FROM app_org_chart_named_positions($1)`, [V1])).rowCount).toBe(0);
      await expect(attempt(who, `SELECT app_set_org_chart_show_names($1, true)`, [V1])).rejects.toThrow(/no such version/);
      await expect(attempt(who, `SELECT app_publish_org_chart($1, app_firm_today(), NULL)`, [CHART])).rejects.toThrow(/no such structure/);
    }
  });

  it("is 404 for a consultant on the client's team who is staffed on none of its projects", async () => {
    await expect(svc(U.team, (tx, p) => OC.getPublishedChart(tx, p, ACME))).rejects.toThrow(REFUSED);
    await expect(svc(U.team, (tx, p) => OC.getDraft(tx, p, ACME))).rejects.toThrow(REFUSED);
    expect((await attempt(U.team, `SELECT 1 FROM positions`)).rowCount).toBe(0);
    expect((await attempt(U.team, `SELECT 1 FROM position_holders`)).rowCount).toBe(0);
  });
});

describe("an action owner", () => {
  it("gets no chart: every read is 404 and the database gives no row", async () => {
    await expect(svc(U.owner, (tx, p) => OC.getPublishedChart(tx, p, ACME))).rejects.toThrow(REFUSED);
    await expect(svc(U.owner, (tx, p) => OC.getVersion(tx, p, V1))).rejects.toThrow(REFUSED);
    await expect(svc(U.owner, (tx, p) => OC.listVacancies(tx, p, ACME))).rejects.toThrow(REFUSED);
    await expect(svc(U.owner, (tx, p) => OC.listVersions(tx, p, ACME))).rejects.toThrow(REFUSED);
    for (const table of ["org_charts", "org_chart_versions", "org_units", "positions", "position_holders", "org_chart_change_requests"]) {
      expect((await attempt(U.owner, `SELECT 1 FROM ${table}`)).rowCount, table).toBe(0);
    }
    expect((await attempt(U.owner, `SELECT * FROM app_org_chart_holders($1, app_firm_today())`, [V1])).rowCount).toBe(0);
  });

  it("reads only their own manager, and the name only while the version shows names", async () => {
    const mine = await svc(U.owner, (tx, p) => OC.myManager(tx, p));
    expect(mine.map((m) => [m.titleEn, m.name, m.vacant])).toEqual([["Chief Financial Officer", null, false]]);
    await svc(U.cadmin, (tx, p) => OC.setShowNames(tx, p, V1, true), true);
    expect((await svc(U.owner, (tx, p) => OC.myManager(tx, p))).map((m) => [m.titleEn, m.name])).toEqual([["Chief Financial Officer", "Cfo Person"]]);
    // A manager's own manager, and nobody's for someone who holds no position.
    expect((await svc(U.mgr, (tx, p) => OC.myManager(tx, p))).map((m) => [m.titleEn, m.name])).toEqual([["CEO", "Nasser Ceo"]]);
    expect(await svc(U.cadmin, (tx, p) => OC.myManager(tx, p))).toEqual([]);
    expect(await svc(U.lead, (tx, p) => OC.myManager(tx, p))).toEqual([]);
  });
});

describe("whose names a reader sees", () => {
  it("the firm's readers and the client's admin see every name; a manager none while show_names is off", async () => {
    for (const who of [U.admin, U.lead, U.deputy, U.cons, U.obs, U.cadmin]) {
      const chart = await svc(who, (tx, p) => OC.getPublishedChart(tx, p, ACME));
      expect(chart.names, who).toBe("all");
      expect(holderNames(chart)["Chief Financial Officer"], who).toEqual(["Cfo Person"]);
      expect(holderNames(chart)["HR director"], who).toEqual(["mgr person"]);
    }
    const chart = await svc(U.mgr, (tx, p) => OC.getPublishedChart(tx, p, ACME));
    expect(chart.names).toBe("none");
    // Every title, which positions are filled, and no name, person, date or id.
    expect(chart.positions).toHaveLength(9);
    expect(chart.positions.flatMap((p) => p.holders).every((h) => !h.named && h.name === null && h.userId === null && h.from === null && h.id === null)).toBe(true);
    expect(chart.positions.filter((p) => p.vacant).map((p) => p.titleEn)).toEqual(["HR officer"]);
  });

  it("a manager sees names only in her department's branch and the chain above it", async () => {
    await svc(U.cadmin, (tx, p) => OC.setShowNames(tx, p, V1, true), true);
    const chart = await svc(U.mgr, (tx, p) => OC.getPublishedChart(tx, p, ACME));
    expect(chart.names).toBe("branch");
    expect(holderNames(chart)).toEqual({
      // Finance and its section...
      "Chief Financial Officer": ["Cfo Person"],
      Analyst: ["owner person"],
      "Payables lead": ["Payables Lead"],
      Clerk: ["Clerk One"],
      // ...and the chain above it.
      CEO: ["Nasser Ceo"],
      Chair: ["Hessa Chair"],
      // Not beside it, nor in another department (even her own position there).
      "Internal auditor": [null],
      "HR director": [null],
    });
    // Straight in the database: the raw holdings are not hers to read; the function gives the same.
    expect((await attempt(U.mgr, `SELECT 1 FROM position_holders`)).rowCount).toBe(0);
    const viaDb = (await attempt(U.mgr, `SELECT name FROM app_org_chart_holders($1, app_firm_today()) WHERE position_id = $2`, [V1, POS.auditor])).rows;
    expect(viaDb).toEqual([{ name: null }]);
    // A manager in no department has no branch: no names.
    const none = await svc(U.mgr2, (tx, p) => OC.getPublishedChart(tx, p, ACME));
    expect(none.names).toBe("none");
    expect(none.positions.flatMap((p) => p.holders).some((h) => h.name !== null)).toBe(false);
  });

  it("only the client's admin moves the names switch", async () => {
    for (const who of [U.mgr, U.owner, U.lead, U.admin]) {
      await expect(svc(who, (tx, p) => OC.setShowNames(tx, p, V1, true))).rejects.toThrow(REFUSED);
      await expect(attempt(who, `SELECT app_set_org_chart_show_names($1, true)`, [V1])).rejects.toThrow(/no such version/);
    }
    const draft = (await owner.query(`SELECT id FROM org_chart_versions WHERE chart_id = $1 AND state = 'draft'`, [CHART])).rows[0].id;
    await expect(attempt(U.cadmin, `SELECT app_set_org_chart_show_names($1, true)`, [draft])).rejects.toThrow(/no such version/);
    await expect(attempt(U.cadmin, `UPDATE org_chart_versions SET show_names = true WHERE id = $1`, [V1])).rejects.toThrow(/permission denied/);
  });

  it("the client's admin sees no draft", async () => {
    await expect(svc(U.cadmin, (tx, p) => OC.getDraft(tx, p, ACME))).rejects.toThrow(REFUSED);
    expect((await svc(U.cadmin, (tx, p) => OC.listVersions(tx, p, ACME))).map((v) => v.state)).toEqual(["published"]);
    expect((await svc(U.lead, (tx, p) => OC.listVersions(tx, p, ACME))).map((v) => v.state)).toEqual(["draft", "published"]);
    expect((await attempt(U.cadmin, `SELECT DISTINCT version_id FROM positions`)).rows).toEqual([{ version_id: V1 }]);
  });

  it("vacancies: positions nobody holds today", async () => {
    expect((await svc(U.cadmin, (tx, p) => OC.listVacancies(tx, p, ACME))).map((v) => [v.titleEn, v.unitNameEn])).toEqual([["HR officer", "Human resources"]]);
  });
});

describe("the chart never grants or limits access", () => {
  it("leaves what every client person reads exactly as it was before a chart with linked units was published", async () => {
    for (const who of [U.cadmin, U.mgr, U.mgr2, U.owner]) expect(await readable(who), who).toEqual(before[who]);
    // The manager holds the head position of the unit linked to HR, a department she is not in: still no HR work.
    expect(before[U.mgr]!.actions).not.toContain(ACT.hr);
    expect(before[U.mgr]!.recommendations).not.toContain(REC.hr);
    expect(before[U.mgr]!.indicators).toEqual([KPI.all]);
    expect((await attempt(U.mgr, `SELECT app_dept_ok($1, $2) AS ok`, [DEPT.hr, ACME])).rows[0].ok).toBe(false);
  });
});

describe("a minimal-records client", () => {
  it("stores no names: its structure has titles only", async () => {
    await svc(U.lead, (tx, p) => OC.startChart(tx, p, MANAGED), true);
    const u = await svc(U.lead, (tx, p) => OC.addUnit(tx, p, MANAGED, { kind: "board", nameEn: "Family council" }), true);
    const pos = await svc(U.lead, (tx, p) => OC.addPosition(tx, p, u.id, { titleEn: "Council head", isHead: true }), true);
    await svc(U.lead, (tx, p) => OC.publish(tx, p, MANAGED, { effectiveOn: firmToday() }), true);
    await expect(svc(U.lead, (tx, p) => OC.changeHolder(tx, p, pos.id, { start: { name: "Family Elder", from: PAST } }))).rejects.toThrow(/minimal_records/);
    const chart = (await owner.query(`SELECT id FROM org_charts WHERE org_id = $1`, [MANAGED])).rows[0].id;
    await expect(
      attempt(U.lead, `INSERT INTO position_holders (position_lineage_id, chart_id, org_id, name, from_date, created_by) VALUES ($1,$2,$3,'Family Elder',$4,$5)`, [
        pos.id,
        chart,
        MANAGED,
        PAST,
        U.lead,
      ]),
    ).rejects.toThrow(/minimal records/);
    const read = await svc(U.lead, (tx, p) => OC.getPublishedChart(tx, p, MANAGED));
    expect([read.names, read.canChangeHolders, read.positions.map((p) => [p.titleEn, p.vacant, p.holders])]).toEqual(["none", false, [["Council head", null, []]]]);
    expect(await svc(U.lead, (tx, p) => OC.listVacancies(tx, p, MANAGED))).toEqual([]);
    expect((await owner.query(`SELECT count(*)::int AS n FROM position_holders WHERE org_id = $1`, [MANAGED])).rows[0].n).toBe(0);
  });

  it("cannot be switched on while the client's structure holds a name, current or past; nothing is deleted", async () => {
    await svc(U.lead, (tx, p) => OC.startChart(tx, p, FAMILY), true);
    const u = await svc(U.lead, (tx, p) => OC.addUnit(tx, p, FAMILY, { kind: "board", nameEn: "Family council" }), true);
    const pos = await svc(U.lead, (tx, p) => OC.addPosition(tx, p, u.id, { titleEn: "Council head", isHead: true }), true);
    await svc(U.lead, (tx, p) => OC.publish(tx, p, FAMILY, { effectiveOn: firmToday() }), true);
    const { started } = await svc(U.lead, (tx, p) => OC.changeHolder(tx, p, pos.id, { start: { name: "Family Elder", from: PAST } }), true);
    // A holding that has ended still holds a name.
    await svc(U.lead, (tx, p) => OC.changeHolder(tx, p, pos.id, { end: { holderId: started!, on: firmToday() } }), true);
    const holders = async () => (await owner.query(`SELECT count(*)::int AS n FROM position_holders WHERE org_id = $1`, [FAMILY])).rows[0].n;
    const minimal = async () => (await owner.query(`SELECT minimal_records AS on FROM organizations WHERE id = $1`, [FAMILY])).rows[0].on;
    const switchOn = () => svc(U.admin, (tx, p) => setEngagement(tx, p, FAMILY, { minimalRecords: true, displayAlias: "Family office B" }), true);
    // The firm admin's mode screen says why before trying...
    expect((await svc(U.admin, (tx, p) => getEngagement(tx, p, FAMILY))).fit).toMatchObject({ hasContactsOrFiles: false, hasStructureNames: true });
    expect(engagementError("remove the names of people from the client's structure before switching to minimal records")).toBe("structureNames");
    // ...and the switch is refused, by the service and straight in the database, with nothing deleted.
    await expect(switchOn()).rejects.toThrow(/remove the names of people from the client's structure/);
    await expect(owner.query(`UPDATE organizations SET minimal_records = true, display_alias = 'Family office B' WHERE id = $1`, [FAMILY])).rejects.toThrow(
      /remove the names of people from the client's structure/,
    );
    expect([await holders(), await minimal()]).toEqual([1, false]);
    // Once no name is left in the structure, it is allowed.
    await owner.query(`DELETE FROM position_holders WHERE org_id = $1`, [FAMILY]);
    expect((await svc(U.admin, (tx, p) => getEngagement(tx, p, FAMILY))).fit).toMatchObject({ hasStructureNames: false });
    await switchOn();
    expect(await minimal()).toBe(true);
    // From then on, no names (as for any minimal-records client).
    await expect(svc(U.lead, (tx, p) => OC.changeHolder(tx, p, pos.id, { start: { name: "Family Elder", from: PAST } }))).rejects.toThrow(/minimal_records/);
  });
});

describe("no cycles", () => {
  const draftIds = async () => {
    const d = await svc(U.lead, (tx, p) => OC.getDraft(tx, p, ACME));
    return {
      pos: Object.fromEntries(d.positions.map((p) => [p.titleEn!, p.id])) as Record<string, string>,
      unit: Object.fromEntries(d.units.map((u) => [u.nameEn!, u.id])) as Record<string, string>,
    };
  };

  it("the service refuses a reporting line or a move that would make a loop", async () => {
    const { pos, unit } = await draftIds();
    await expect(svc(U.lead, (tx, p) => OC.setReportsTo(tx, p, pos.Chair!, pos.Clerk!))).rejects.toThrow(/cycle/);
    await expect(svc(U.lead, (tx, p) => OC.setReportsTo(tx, p, pos.CEO!, pos.CEO!))).rejects.toThrow(/cycle/);
    await expect(svc(U.lead, (tx, p) => OC.moveUnit(tx, p, unit.Board!, { parentId: unit.Payables! }))).rejects.toThrow(/cycle/);
    await expect(svc(U.lead, (tx, p) => OC.moveUnit(tx, p, unit.Finance!, { parentId: unit.Finance! }))).rejects.toThrow(/cycle/);
  });

  it("the database refuses them too, however they are written", async () => {
    const { pos, unit } = await draftIds();
    await expect(attempt(U.lead, `UPDATE positions SET reports_to_id = $1 WHERE id = $2`, [pos.Clerk, pos.Chair])).rejects.toThrow(/cannot report to itself/);
    await expect(attempt(U.lead, `UPDATE positions SET reports_to_id = id WHERE id = $1`, [pos.CEO])).rejects.toThrow(/cannot report to itself|position_not_own_manager/);
    await expect(attempt(U.lead, `UPDATE org_units SET parent_id = $1 WHERE id = $2`, [unit.Payables, unit.Board])).rejects.toThrow(/cannot sit under itself/);
    // Even for the schema owner (a seed, an import job).
    await expect(owner.query(`UPDATE positions SET reports_to_id = $1 WHERE id = $2`, [pos.Clerk, pos.Chair])).rejects.toThrow(/cannot report to itself/);
    // And across versions: a line or a parent from another version.
    await expect(attempt(U.lead, `UPDATE positions SET reports_to_id = $1 WHERE id = $2`, [POS.cfo, pos.Analyst])).rejects.toThrow(/same structure/);
    await expect(attempt(U.lead, `UPDATE org_units SET parent_id = $1 WHERE id = $2`, [UNIT.ceo, unit.Finance])).rejects.toThrow(/same structure/);
  });
});

describe("a client admin and the structure", () => {
  it("cannot change units or positions: 404 at the service", async () => {
    const { draft } = await svc(U.lead, (tx, p) => OC.getDraft(tx, p, ACME));
    expect(draft).not.toBeNull();
    const draftUnit = (await owner.query(`SELECT id FROM org_units WHERE version_id = $1 LIMIT 1`, [draft!.id])).rows[0].id;
    const draftPos = (await owner.query(`SELECT id FROM positions WHERE version_id = $1 LIMIT 1`, [draft!.id])).rows[0].id;
    const writes: ((tx: Tx, p: Principal) => Promise<unknown>)[] = [
      (tx: Tx, p: Principal) => OC.startChart(tx, p, ACME),
      (tx: Tx, p: Principal) => OC.addUnit(tx, p, ACME, { kind: "unit", nameEn: "Projects office" }),
      (tx: Tx, p: Principal) => OC.updateUnit(tx, p, UNIT.fin!, { nameEn: "Money" }),
      (tx: Tx, p: Principal) => OC.updateUnit(tx, p, draftUnit, { nameEn: "Money" }),
      (tx: Tx, p: Principal) => OC.moveUnit(tx, p, draftUnit, { parentId: null }),
      (tx: Tx, p: Principal) => OC.deleteUnit(tx, p, draftUnit),
      (tx: Tx, p: Principal) => OC.addPosition(tx, p, draftUnit, { titleEn: "x" }),
      (tx: Tx, p: Principal) => OC.updatePosition(tx, p, POS.cfo!, { titleEn: "x" }),
      (tx: Tx, p: Principal) => OC.setReportsTo(tx, p, draftPos, null),
      (tx: Tx, p: Principal) => OC.setHead(tx, p, draftPos, true),
      (tx: Tx, p: Principal) => OC.setSpecialties(tx, p, draftPos, ["x"]),
      (tx: Tx, p: Principal) => OC.movePosition(tx, p, draftPos, { unitId: draftUnit }),
      (tx: Tx, p: Principal) => OC.deletePosition(tx, p, POS.hro!),
      (tx: Tx, p: Principal) => OC.publish(tx, p, ACME, { effectiveOn: firmToday() }),
    ];
    for (const fn of writes) {
      await expect(svc(U.cadmin, fn)).rejects.toThrow(REFUSED);
    }
  });

  it("cannot change them in the database either", async () => {
    const draft = (await owner.query(`SELECT id FROM org_chart_versions WHERE chart_id = $1 AND state = 'draft'`, [CHART])).rows[0].id;
    // Into the draft: row-level security. Into the published version the trigger refuses first (it runs before the policy).
    await expect(attempt(U.cadmin, `INSERT INTO org_units (version_id, org_id, kind, code, name_en) VALUES ($1,$2,'unit','9','x')`, [draft, ACME])).rejects.toThrow(RLS);
    await expect(attempt(U.cadmin, `INSERT INTO org_units (version_id, org_id, kind, code, name_en) VALUES ($1,$2,'unit','9','x')`, [V1, ACME])).rejects.toThrow(
      /row-level security|published structure never changes/,
    );
    const draftUnit = (await owner.query(`SELECT id FROM org_units WHERE version_id = $1 LIMIT 1`, [draft])).rows[0].id;
    await expect(
      attempt(U.cadmin, `INSERT INTO positions (version_id, org_id, unit_id, code, title_en) VALUES ($1,$2,$3,'9','x')`, [draft, ACME, draftUnit]),
    ).rejects.toThrow(RLS);
    expect((await attempt(U.cadmin, `UPDATE org_units SET name_en = 'Money' WHERE org_id = $1`, [ACME])).rowCount).toBe(0);
    expect((await attempt(U.cadmin, `UPDATE positions SET title_en = 'x' WHERE org_id = $1`, [ACME])).rowCount).toBe(0);
    expect((await attempt(U.cadmin, `DELETE FROM positions WHERE org_id = $1`, [ACME])).rowCount).toBe(0);
    expect((await attempt(U.cadmin, `DELETE FROM org_units WHERE org_id = $1`, [ACME])).rowCount).toBe(0);
    await expect(attempt(U.cadmin, `UPDATE org_chart_versions SET published_snapshot = '{}' WHERE id = $1`, [V1])).rejects.toThrow(/permission denied/);
    await expect(attempt(U.cadmin, `SELECT app_publish_org_chart($1, app_firm_today(), NULL)`, [CHART])).rejects.toThrow(/no such structure/);
    await expect(attempt(U.cadmin, `SELECT app_start_org_chart($1)`, [ACME])).rejects.toThrow(/no such client/);
    // A manager no more than the admin.
    await expect(attempt(U.mgr, `INSERT INTO org_units (version_id, org_id, kind, code, name_en) VALUES ($1,$2,'unit','9','x')`, [draft, ACME])).rejects.toThrow(RLS);
  });
});

describe("people in positions", () => {
  beforeEach(async () => {
    await owner.query(`DELETE FROM notifications`);
    await owner.query(`DELETE FROM outbound_emails`);
  });
  const told = async (kind: string) => (await owner.query(`SELECT user_id FROM notifications WHERE kind = $1 ORDER BY user_id`, [kind])).rows.map((r) => r.user_id);
  const mailed = async (kind: string) => (await owner.query(`SELECT to_email FROM outbound_emails WHERE kind = $1 ORDER BY to_email`, [kind])).rows.map((r) => r.to_email);

  it("the client's admin changes a holder on the published chart, it is audited, and the lead and deputy are told", async () => {
    const { started } = await svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, POS.hro!, { start: { name: "New Officer", from: firmToday() } }), true);
    expect(await told("org_chart.holder_changed")).toEqual([U.lead, U.deputy].sort());
    expect(await mailed("org_chart.holder_changed")).toEqual(["deputy@example.test", "lead@example.test"]);
    expect((await owner.query(`SELECT entity_type, entity_id FROM notifications LIMIT 1`)).rows[0]).toEqual({ entity_type: "organization", entity_id: ACME });
    // Who did it, in the audit log.
    const logged = (await owner.query(`SELECT actor_id FROM audit_log WHERE action = 'org_chart.holder_start' AND meta->>'holder' = $1`, [started])).rows;
    expect(logged).toEqual([{ actor_id: U.cadmin }]);
    // The next change while the notice is unread adds no second notice and no second mail that day.
    await svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, POS.hro!, { end: { holderId: started!, on: firmToday() } }), true);
    expect(await told("org_chart.holder_changed")).toEqual([U.lead, U.deputy].sort());
    expect(await mailed("org_chart.holder_changed")).toHaveLength(2);
    expect((await owner.query(`SELECT 1 FROM audit_log WHERE action = 'org_chart.holder_end' AND meta->>'holder' = $1`, [started])).rowCount).toBe(1);
    // Firm staff who may edit change holders too; the person who makes the change is not told.
    await owner.query(`UPDATE notifications SET read_at = now()`);
    const second = await svc(U.lead, (tx, p) => OC.changeHolder(tx, p, POS.hro!, { start: { name: "Second Officer", from: firmToday() } }), true);
    expect((await owner.query(`SELECT user_id FROM notifications WHERE read_at IS NULL`)).rows).toEqual([{ user_id: U.deputy }]);
    expect(await mailed("org_chart.holder_changed")).toHaveLength(2);
    await svc(U.lead, (tx, p) => OC.changeHolder(tx, p, POS.hro!, { end: { holderId: second.started!, on: firmToday() } }), true);
  });

  it("replacing the one person in a position ends their holding the day before", async () => {
    const today = firmToday();
    const { started, ended } = await svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, POS.ceo!, { start: { name: "Lama Ceo", from: today } }));
    expect(started).toBeTruthy();
    expect(ended).toHaveLength(1);
  });

  it("a holding only ends, once; people are one of the client's own or a typed name, and one person holds a position once at a time", async () => {
    const h = (await owner.query(`SELECT id FROM position_holders WHERE position_lineage_id = $1`, [POS.cfo])).rows[0].id;
    await expect(attempt(U.cadmin, `UPDATE position_holders SET name = 'Someone else' WHERE id = $1`, [h])).rejects.toThrow(/only ends/);
    await expect(attempt(U.cadmin, `UPDATE position_holders SET to_date = '2024-01-01' WHERE id = $1`, [h])).rejects.toThrow(/on or after/);
    await expect(attempt(U.cadmin, `DELETE FROM position_holders WHERE id = $1`, [h])).rejects.toThrow(/permission denied/);
    await expect(svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, POS.clerk!, { start: { userId: U.oowner, from: PAST } }))).rejects.toThrow(/own active people/);
    await expect(svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, POS.clerk!, { start: { name: "Clerk One", from: firmToday() } }))).rejects.toThrow(/already holds/);
    // Two clerks are planned: a second one joins without ending the first.
    const two = await svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, POS.clerk!, { start: { name: "Clerk Two", from: firmToday() } }));
    expect(two.ended).toEqual([]);
  });

  it("the client's admin places people only on the published structure, never in the firm's draft", async () => {
    const { draft } = await svc(U.lead, (tx, p) => OC.getDraft(tx, p, ACME));
    const draftUnit = (await owner.query(`SELECT id FROM org_units WHERE version_id = $1 AND code = '1.1.3'`, [draft!.id])).rows[0].id;
    await as(U.lead, async (c) => {
      // Inside one transaction: the lead adds a draft-only position, the client's admin may not fill it.
      await c.query(`INSERT INTO positions (id, lineage_id, version_id, org_id, unit_id, code, title_en) VALUES ($1,$1,$2,$3,$4,'1.1.3.9','Recruiter')`, [
        id(90),
        draft!.id,
        ACME,
        draftUnit,
      ]);
      await c.query(`SELECT set_config('selah.user_id', $1, true)`, [U.cadmin]);
      await expect(
        c.query(`INSERT INTO position_holders (position_lineage_id, chart_id, org_id, name, from_date, created_by) VALUES ($1,$2,$3,'Draft Person',$4,$5)`, [
          id(90),
          CHART,
          ACME,
          PAST,
          U.cadmin,
        ]),
      ).rejects.toThrow(/published structure/);
    });
    // Through the service the draft's position is not even there for the client's admin.
    const draftPos = (await owner.query(`SELECT id FROM positions WHERE version_id = $1 LIMIT 1`, [draft!.id])).rows[0].id;
    await expect(svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, draftPos, { start: { name: "Draft Person", from: PAST } }))).rejects.toThrow(REFUSED);
    // The firm's editors may (the import fills the draft).
    await svc(U.lead, async (tx, p) => {
      const pos = await OC.addPosition(tx, p, draftUnit, { titleEn: "Trainer" });
      return OC.changeHolder(tx, p, pos.id, { start: { name: "Draft Person", from: PAST } });
    });
  });
});

describe("an observer", () => {
  it("reads the structure, the draft and every name, and edits nothing", async () => {
    expect((await svc(U.obs, (tx, p) => OC.getPublishedChart(tx, p, ACME))).names).toBe("all");
    const draft = await svc(U.obs, (tx, p) => OC.getDraft(tx, p, ACME));
    expect([draft.canEditDraft, draft.canPublish, draft.canChangeHolders]).toEqual([false, false, false]);
    const d = draft.positions[0]!;
    const writes: ((tx: Tx, p: Principal) => Promise<unknown>)[] = [
      (tx: Tx, p: Principal) => OC.addUnit(tx, p, ACME, { kind: "unit", nameEn: "x" }),
      (tx: Tx, p: Principal) => OC.updateUnit(tx, p, d.unitId, { nameEn: "x" }),
      (tx: Tx, p: Principal) => OC.updatePosition(tx, p, d.id, { titleEn: "x" }),
      (tx: Tx, p: Principal) => OC.deletePosition(tx, p, d.id),
      (tx: Tx, p: Principal) => OC.publish(tx, p, ACME, { effectiveOn: firmToday() }),
      (tx: Tx, p: Principal) => OC.changeHolder(tx, p, POS.hro!, { start: { name: "Observer Pick", from: PAST } }),
    ];
    for (const fn of writes) {
      await expect(svc(U.obs, fn)).rejects.toThrow(REFUSED);
    }
    await expect(attempt(U.obs, `INSERT INTO org_units (version_id, org_id, kind, code, name_en) VALUES ($1,$2,'unit','9','x')`, [draft.draft!.id, ACME])).rejects.toThrow(RLS);
    expect((await attempt(U.obs, `UPDATE positions SET title_en = 'x' WHERE id = $1`, [d.id])).rowCount).toBe(0);
    await expect(
      attempt(U.obs, `INSERT INTO position_holders (position_lineage_id, chart_id, org_id, name, from_date, created_by) VALUES ($1,$2,$3,'Observer Pick',$4,$5)`, [
        POS.hro,
        CHART,
        ACME,
        PAST,
        U.obs,
      ]),
    ).rejects.toThrow(RLS);
    // A staffed consultant edits the draft but does not publish; the lead, the deputy and the firm admin do.
    const cons = await svc(U.cons, (tx, p) => OC.getDraft(tx, p, ACME));
    expect([cons.canEditDraft, cons.canPublish]).toEqual([true, false]);
    await expect(svc(U.cons, (tx, p) => OC.publish(tx, p, ACME, { effectiveOn: firmToday() }))).rejects.toThrow(REFUSED);
    for (const who of [U.lead, U.deputy, U.admin]) expect((await svc(who, (tx, p) => OC.getDraft(tx, p, ACME))).canPublish, who).toBe(true);
  });
});

describe("suggest a change", () => {
  beforeEach(async () => {
    await owner.query(`DELETE FROM notifications`);
    await owner.query(`DELETE FROM outbound_emails`);
  });

  it("the client's admin suggests a change; it reaches the lead and deputy; the firm answers it once", async () => {
    const { id: rid } = await svc(U.cadmin, (tx, p) => OC.suggestChange(tx, p, ACME, { what: "Split payables in two", where: "Finance", why: "Two sites now" }), true);
    expect((await owner.query(`SELECT user_id FROM notifications WHERE kind = 'org_chart.change_requested' ORDER BY user_id`)).rows.map((r) => r.user_id)).toEqual(
      [U.lead, U.deputy].sort(),
    );
    expect((await owner.query(`SELECT count(*)::int AS n FROM outbound_emails WHERE kind = 'org_chart.change_requested'`)).rows[0].n).toBe(2);
    for (const who of [U.mgr, U.owner, U.lead]) await expect(svc(who, (tx, p) => OC.suggestChange(tx, p, ACME, { what: "Something else" }))).rejects.toThrow(REFUSED);
    await expect(
      attempt(U.mgr, `INSERT INTO org_chart_change_requests (chart_id, org_id, what, created_by) VALUES ($1,$2,'Something else',$3)`, [CHART, ACME, U.mgr]),
    ).rejects.toThrow(/admin suggests changes|row-level security/);
    // The database writes it in the admin's own name, open.
    const forged = await attempt(
      U.cadmin,
      `INSERT INTO org_chart_change_requests (chart_id, org_id, what, created_by, status) VALUES ($1,$2,'Forged',$3,'done') RETURNING created_by, status`,
      [CHART, ACME, U.lead],
    );
    expect(forged.rows).toEqual([{ created_by: U.cadmin, status: "open" }]);
    expect((await svc(U.lead, (tx, p) => OC.listChangeRequests(tx, p, ACME))).items.map((r) => [r.what, r.status, r.byName])).toEqual([
      ["Split payables in two", "open", "cadmin person"],
    ]);
    const forAdmin = await svc(U.cadmin, (tx, p) => OC.listChangeRequests(tx, p, ACME));
    expect([forAdmin.items.length, forAdmin.canClose]).toEqual([1, false]);
    await expect(svc(U.mgr, (tx, p) => OC.listChangeRequests(tx, p, ACME))).rejects.toThrow(REFUSED);
    await expect(svc(U.cadmin, (tx, p) => OC.closeChangeRequest(tx, p, rid, "done"))).rejects.toThrow(REFUSED);
    await expect(svc(U.obs, (tx, p) => OC.closeChangeRequest(tx, p, rid, "done"))).rejects.toThrow(REFUSED);
    await svc(U.lead, (tx, p) => OC.closeChangeRequest(tx, p, rid, "done"), true);
    await expect(svc(U.lead, (tx, p) => OC.closeChangeRequest(tx, p, rid, "declined"))).rejects.toThrow(/answered/);
    await expect(attempt(U.lead, `UPDATE org_chart_change_requests SET status = 'declined' WHERE id = $1`, [rid])).rejects.toThrow(/already answered/);
    expect((await owner.query(`SELECT status, closed_by FROM org_chart_change_requests WHERE id = $1`, [rid])).rows[0]).toEqual({ status: "done", closed_by: U.lead });
  });
});

describe("masking for the assistant", () => {
  it("masks the typed names of people in the client's structure, for a project the caller can see", async () => {
    const terms = async (uid: string) => (await attempt(uid, `SELECT term FROM app_mask_terms($1)`, [P])).rows.map((r) => r.term);
    expect(await terms(U.cons)).toEqual(expect.arrayContaining(["Cfo Person", "Hessa Chair", "Clerk One"]));
    expect(await terms(U.omgr)).toEqual([]);
  });
});

describe("publishing freezes the snapshot", () => {
  it("later draft edits change neither the published version nor its rows; the next publish makes it history", async () => {
    const snapBefore = (await owner.query(`SELECT published_snapshot AS s FROM org_chart_versions WHERE id = $1`, [V1])).rows[0].s;
    // A holding on a position the next version drops.
    const officer = await svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, POS.hro!, { start: { name: "Leaving Officer", from: PAST } }), true);
    const d = await svc(U.lead, (tx, p) => OC.getDraft(tx, p, ACME));
    const pos = Object.fromEntries(d.positions.map((p) => [p.titleEn!, p.id])) as Record<string, string>;
    const unit = Object.fromEntries(d.units.map((u) => [u.nameEn!, u.id])) as Record<string, string>;
    await svc(U.cons, (tx, p) => OC.updatePosition(tx, p, pos["Chief Financial Officer"]!, { titleEn: "Finance director" }), true);
    await svc(U.lead, (tx, p) => OC.deletePosition(tx, p, pos["HR officer"]!), true);
    const office = await svc(U.lead, (tx, p) => OC.addUnit(tx, p, ACME, { kind: "office", nameEn: "Projects office", parentId: unit["Chief executive"]!, advisory: true }), true);
    await svc(U.lead, (tx, p) => OC.moveUnit(tx, p, office.id, { parentId: unit["Chief executive"]!, index: 0 }), true);
    await svc(U.lead, (tx, p) => OC.updateUnit(tx, p, office.id, { nameAr: "مكتب المشاريع" }), true);
    const spare = await svc(U.lead, (tx, p) => OC.addUnit(tx, p, ACME, { kind: "unit", nameEn: "Spare", parentId: unit.Finance! }), true);
    await svc(U.lead, (tx, p) => OC.deleteUnit(tx, p, spare.id), true);
    await svc(U.lead, (tx, p) => OC.setHead(tx, p, pos.Analyst!, true), true);
    expect((await owner.query(`SELECT is_head FROM positions WHERE id = $1`, [pos["Chief Financial Officer"]])).rows[0].is_head).toBe(false);
    await svc(U.lead, (tx, p) => OC.setSpecialties(tx, p, pos.Analyst!, ["forecasting"]), true);
    await svc(U.lead, (tx, p) => OC.movePosition(tx, p, pos.Clerk!, { unitId: unit.Finance! }), true);

    // The client still sees what was published.
    const now = await svc(U.cadmin, (tx, p) => OC.getPublishedChart(tx, p, ACME));
    expect(now.positions.map((p) => p.titleEn)).toEqual(expect.arrayContaining(["Chief Financial Officer", "HR officer"]));
    expect(now.positions.map((p) => p.titleEn)).not.toContain("Finance director");
    expect(now.units.map((u) => u.nameEn)).not.toContain("Projects office");
    expect((await owner.query(`SELECT published_snapshot AS s FROM org_chart_versions WHERE id = $1`, [V1])).rows[0].s).toEqual(snapBefore);
    // The published rows never change, even for the firm's editors.
    await expect(attempt(U.lead, `UPDATE positions SET title_en = 'x' WHERE id = $1`, [POS.cfo])).rejects.toThrow(/published structure never changes/);
    await expect(attempt(U.lead, `UPDATE org_units SET name_en = 'x' WHERE id = $1`, [UNIT.fin])).rejects.toThrow(/published structure never changes/);
    await expect(attempt(U.lead, `DELETE FROM positions WHERE id = $1`, [POS.hro])).rejects.toThrow(/published structure never changes/);
    await expect(svc(U.lead, (tx, p) => OC.updatePosition(tx, p, POS.cfo!, { titleEn: "x" }))).rejects.toThrow(/published/);
    await expect(attempt(U.lead, `UPDATE org_chart_versions SET published_snapshot = '{}' WHERE id = $1`, [V1])).rejects.toThrow(/permission denied/);

    // Publishing again: the deputy publishes, version 1 becomes history.
    const v2 = await svc(U.deputy, (tx, p) => OC.publish(tx, p, ACME, { effectiveOn: firmToday() }), true);
    V2 = v2.versionId;
    expect(v2.number).toBe(2);
    const states = (await owner.query(`SELECT number, state FROM org_chart_versions WHERE chart_id = $1 ORDER BY number NULLS LAST`, [CHART])).rows;
    expect(states).toEqual([
      { number: 1, state: "superseded" },
      { number: 2, state: "published" },
      { number: null, state: "draft" },
    ]);
    const current = await svc(U.cadmin, (tx, p) => OC.getPublishedChart(tx, p, ACME));
    expect(current.positions.map((p) => p.titleEn)).toContain("Finance director");
    // Holdings follow their positions into the new version...
    expect(holderNames(current)["Finance director"]).toEqual(["Cfo Person"]);
    // ...and a holding on a position it dropped ends today.
    expect((await owner.query(`SELECT to_date::text AS d FROM position_holders WHERE id = $1`, [officer.started])).rows[0].d).toBe(firmToday());
    // History reads as published, with who held what then.
    const old = await svc(U.cadmin, (tx, p) => OC.getVersion(tx, p, V1));
    expect(old.version.state).toBe("superseded");
    expect(old.positions.map((p) => p.titleEn)).toContain("Chief Financial Officer");
    expect(old.positions.map((p) => p.titleEn)).not.toContain("Finance director");
    // The names switch carried over from version 1 (off here).
    expect(current.version!.showNames).toBe(false);
    await expect(attempt(U.lead, `UPDATE org_units SET name_en = 'x' WHERE id = $1`, [UNIT.fin])).rejects.toThrow(/published structure never changes/);
  });
});

describe("names follow the current version's switch, as of today", () => {
  const holdersOn = (who: string, version: string, day: string) =>
    attempt(who, `SELECT position_id, name, from_date, to_date FROM app_org_chart_holders($1, $2::date) ORDER BY 1, 2`, [version, day]).then((r) => r.rows);

  it("a manager sees names only on the current version, today, while its switch is on; older versions and other days are titles only", async () => {
    // Version 1 (history) has names on, version 2 (current) has them off.
    await owner.query(`UPDATE org_chart_versions SET show_names = (id = $1) WHERE id IN ($1, $2)`, [V1, V2]);
    const current = await svc(U.mgr, (tx, p) => OC.getPublishedChart(tx, p, ACME));
    expect(current.positions.flatMap((p) => p.holders).some((h) => h.name !== null)).toBe(false);
    // Not through the older version either, today or on its own days.
    for (const asOf of [undefined, firmToday(), PAST]) {
      const old = await svc(U.mgr, (tx, p) => OC.getVersion(tx, p, V1, asOf));
      expect(old.names, String(asOf)).toBe("none");
      expect(old.positions.every((p) => p.holders.length === 0 && p.vacant === null), String(asOf)).toBe(true);
    }
    expect(await holdersOn(U.mgr, V1, firmToday())).toEqual([]);
    expect(await holdersOn(U.mgr, V1, PAST)).toEqual([]);

    // With the current version's switch on: names in her branch, today only. Another day reads as today, never with dates.
    await owner.query(`UPDATE org_chart_versions SET show_names = true WHERE id = $1`, [V2]);
    expect(holderNames(await svc(U.mgr, (tx, p) => OC.getPublishedChart(tx, p, ACME)))["Finance director"]).toEqual(["Cfo Person"]);
    const today = await holdersOn(U.mgr, V2, firmToday());
    expect(today.length).toBeGreaterThan(0);
    expect(today.every((r) => r.from_date === null && r.to_date === null)).toBe(true);
    expect(await holdersOn(U.mgr, V2, "2024-12-31")).toEqual(today);
    const asked = await svc(U.mgr, (tx, p) => OC.getVersion(tx, p, V2, "2024-12-31"));
    expect([asked.asOf, holderNames(asked)["Finance director"]]).toEqual([firmToday(), ["Cfo Person"]]);
    expect(asked.positions.flatMap((p) => p.holders).every((h) => h.from === null && h.to === null)).toBe(true);
    expect((await svc(U.mgr, (tx, p) => OC.getVersion(tx, p, V1))).positions.flatMap((p) => p.holders)).toEqual([]);

    // The firm and the client's admin keep the whole history, on any version and any day.
    for (const who of [U.cadmin, U.lead]) {
      expect((await svc(who, (tx, p) => OC.getVersion(tx, p, V1, "2024-12-31"))).positions.flatMap((p) => p.holders), who).toEqual([]);
      const then = await svc(who, (tx, p) => OC.getVersion(tx, p, V1, PAST));
      expect(holderNames(then)["Chief Financial Officer"], who).toEqual(["Cfo Person"]);
      expect(then.positions.flatMap((p) => p.holders).every((h) => h.from !== null), who).toBe(true);
    }
  });
});

describe("audit", () => {
  it("every kind of write is in the audit log", async () => {
    const actions = (await owner.query(`SELECT DISTINCT action FROM audit_log WHERE action LIKE 'org_chart%' ORDER BY 1`)).rows.map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "org_chart.create",
        "org_chart.unit_add",
        "org_chart.unit_update",
        "org_chart.unit_move",
        "org_chart.unit_delete",
        "org_chart.position_add",
        "org_chart.position_update",
        "org_chart.position_move",
        "org_chart.position_delete",
        "org_chart.publish",
        "org_chart.show_names",
        "org_chart.holder_start",
        "org_chart.holder_end",
        "org_chart_request.create",
        "org_chart_request.close",
      ]),
    );
  });
});
