// The organisation structure's Structure tabs and PDF (org chart, part 2):
// every reader sees exactly what getPublishedChart, getDraft and getVersion
// allow them, through getStructure (the tab) and orgChartPdf (the PDF route);
// nothing is decided again in the page. The manager's names rule, "show
// names" off, minimal records, a restricted client, an action owner refused,
// another client's chart 404, and the firm's draft never reaching the client.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { firmToday } from "@/lib/dates";
import { buildTree } from "@/lib/org-chart-tree";
import { canReadDepartments, getEngagement } from "@/services/engagement";
import * as OC from "@/services/org-chart";
import { loadPrincipal } from "@/services/principal";
import { truncateAuditLog } from "./audit-reset";

// The PDF service, faked: it keeps the page and the footer it was sent.
const printed = vi.hoisted(() => [] as { html: string; footer: string; locale: string }[]);
vi.mock("@/services/pdf", () => ({
  renderPdf: async (html: string, options: { locale: string; footer: string }) => {
    printed.push({ html, footer: options.footer, locale: options.locale });
    return new TextEncoder().encode("%PDF-1.7 test");
  },
}));
// The exports translate on the server; outside a request, the real messages through next-intl's own translator.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = { ar: (await import("../../messages/ar.json")).default, en: (await import("../../messages/en.json")).default };
  return {
    getTranslations: async ({ locale, namespace }: { locale: "ar" | "en"; namespace?: string }) =>
      createTranslator({ locale, messages: messages[locale], namespace: namespace as never }),
  };
});
import { orgChartPdf } from "@/services/exports";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-0c0d-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2); // full, departments on: the chart under test
const OTHER = id(3); // another client of the firm, with its own chart
const MANAGED = id(4); // consultant-managed with minimal records: titles only
const RESTR = id(5); // restricted: admins only
const FRESH = id(8); // nothing published yet
const P = id(6);
const P_OTHER = id(7);
const DEPT = { fin: id(10), hr: id(11) };
const U = {
  admin: id(21), // firm admin
  lead: id(22), // the lead of Acme, Managed and Restr
  deputy: id(23), // Acme's deputy
  cons: id(24), // staffed on Acme's project
  obs: id(25), // observer on Acme's project
  team: id(26), // on Acme's team, staffed on nothing
  cadmin: id(27),
  mgr: id(28), // Acme manager in Finance
  mgr2: id(29), // Acme manager in no department
  owner: id(30), // Acme action owner in Finance
  oadmin: id(31),
  omgr: id(32),
  radmin: id(33), // Restr's admin
  fadmin: id(34), // Fresh's admin
};

const REFUSED = /forbidden|row-level security|insufficient|not allowed|not found|no such/i;
const PAST = "2025-01-01";
const NAMES = ["Hessa Chair", "Nasser Ceo", "Auditor Person", "Cfo Person", "mgr person"];
const DRAFT_ONLY = "Restructuring planner";

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

const draftIdOf = async (client: string) =>
  (await owner.query(`SELECT v.id FROM org_chart_versions v JOIN org_charts c ON c.id = v.chart_id WHERE c.org_id = $1 AND v.state = 'draft'`, [client])).rows[0]
    ?.id as string;
const publishAs = async (who: string, client: string) => {
  const draftId = await draftIdOf(client);
  return svc(who, (tx, p) => OC.publish(tx, p, client, { draftId, effectiveOn: firmToday() }), true);
};
/** Build a small structure in a client's draft, as the firm does: units by key, positions by key. */
async function build(who: string, client: string, units: [string, OC.UnitInput, string?][], positions: [string, string, OC.PositionInput & { reportsTo?: string }][]) {
  const U2: Record<string, string> = {};
  const P2: Record<string, string> = {};
  for (const [key, input, parent] of units) U2[key] = (await svc(who, (tx, p) => OC.addUnit(tx, p, client, { ...input, parentId: parent ? U2[parent] : null }), true)).id;
  for (const [key, unitKey, { reportsTo, ...input }] of positions) {
    P2[key] = (await svc(who, (tx, p) => OC.addPosition(tx, p, U2[unitKey]!, { ...input, reportsToId: reportsTo ? P2[reportsTo] : null }), true)).id;
  }
  return { units: U2, positions: P2 };
}

let V1 = "";
let V2 = "";
let OTHER_V = "";
const POS: Record<string, string> = {};

/** Every holder name in what a reader was given. */
const namesIn = (s: { positions: OC.OrgPosition[] }) => s.positions.flatMap((p) => p.holders.map((h) => h.name)).filter((n): n is string => n !== null).sort();
const pdf = async (who: string, client: string, options: Partial<Parameters<typeof orgChartPdf>[3]> = {}, locale: "ar" | "en" = "en") => {
  printed.length = 0;
  const file = await svc(who, (tx, p) => orgChartPdf(tx, p, client, { size: "a3", names: true, ...options }, locale), true);
  return { file, ...printed[0]! };
};

beforeAll(async () => {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await truncateAuditLog(owner);
  await q(
    `INSERT INTO organizations (id, kind, name, name_ar, engagement_mode, departments_enabled, minimal_records, display_alias) VALUES
      ($1,'firm','firm',NULL,NULL,false,false,NULL), ($2,'client','Acme','أكمي','full',true,false,NULL), ($3,'client','Other',NULL,'full',false,false,NULL),
      ($4,'client','Managed',NULL,'consultant_managed',false,true,'Family office A'), ($5,'client','Restr',NULL,'restricted',false,false,NULL),
      ($6,'client','Fresh',NULL,'full',false,false,NULL)`,
    [FIRM, ACME, OTHER, MANAGED, RESTR, FRESH],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, `${name} person`, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$14,'firm_admin'), ($2,$14,'consultant'), ($3,$14,'consultant'), ($4,$14,'consultant'), ($5,$14,'consultant'), ($6,$14,'consultant'),
      ($7,$15,'client_admin'), ($8,$15,'client_manager'), ($9,$15,'client_manager'), ($10,$15,'action_owner'),
      ($11,$16,'client_admin'), ($12,$16,'client_manager'), ($13,$17,'client_admin'), ($18,$19,'client_admin')`,
    [U.admin, U.lead, U.deputy, U.cons, U.obs, U.team, U.cadmin, U.mgr, U.mgr2, U.owner, U.oadmin, U.omgr, U.radmin, FIRM, ACME, OTHER, RESTR, U.fadmin, FRESH],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$2,$5,'Acme governance','active',$6), ($3,'client',$4,$5,'Other governance','active',$6)`,
    [P, ACME, P_OTHER, OTHER, FIRM, U.admin],
  );
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES
      ($1,$2,true,false), ($1,$3,false,true), ($1,$4,false,false), ($1,$5,false,false), ($1,$6,false,false),
      ($7,$2,true,false), ($8,$2,true,false), ($9,$2,true,false)`,
    [ACME, U.lead, U.deputy, U.cons, U.obs, U.team, MANAGED, RESTR, FRESH],
  );
  await q(`INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,false), ($1,$3,true), ($1,$4,false), ($1,$5,false), ($1,$6,false)`, [
    P,
    U.cons,
    U.obs,
    U.mgr,
    U.mgr2,
    U.owner,
  ]);
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$3,'المالية','Finance'), ($2,$3,'الموارد البشرية','Human resources')`, [DEPT.fin, DEPT.hr, ACME]);
  await q(`INSERT INTO department_members (department_id, user_id) VALUES ($1,$2), ($1,$3)`, [DEPT.fin, U.mgr, U.owner]);

  // Acme's structure, as the lead builds it, published as version 1.
  await svc(U.lead, (tx, p) => OC.startChart(tx, p, ACME), true);
  const acme = await build(
    U.lead,
    ACME,
    [
      ["board", { kind: "board", nameAr: "مجلس الإدارة", nameEn: "Board" }],
      ["ceo", { kind: "executive", nameAr: "الرئيس التنفيذي", nameEn: "Chief executive" }, "board"],
      ["audit", { kind: "unit", nameAr: "المراجعة الداخلية", nameEn: "Internal audit", advisory: true }, "ceo"],
      ["fin", { kind: "department", nameAr: "الإدارة المالية", nameEn: "Finance", departmentId: DEPT.fin }, "ceo"],
      ["hr", { kind: "department", nameAr: "الموارد البشرية", nameEn: "Human resources", departmentId: DEPT.hr }, "ceo"],
    ],
    [
      ["chair", "board", { titleAr: "رئيس المجلس", titleEn: "Chair", isHead: true }],
      ["ceo", "ceo", { titleAr: "الرئيس التنفيذي", titleEn: "CEO", isHead: true, reportsTo: "chair" }],
      ["auditor", "audit", { titleAr: "المراجع الداخلي", titleEn: "Internal auditor", isHead: true, reportsTo: "chair" }],
      ["cfo", "fin", { titleAr: "المدير المالي", titleEn: "Chief Financial Officer", isHead: true, reportsTo: "ceo" }],
      ["analyst", "fin", { titleAr: "محلل مالي", titleEn: "Analyst", reportsTo: "cfo" }],
      ["hrd", "hr", { titleAr: "مدير الموارد البشرية", titleEn: "HR director", isHead: true, reportsTo: "ceo" }],
    ],
  );
  Object.assign(POS, acme.positions);
  V1 = (await publishAs(U.lead, ACME)).versionId;
  // The client's admin puts the people in; the analyst stays vacant.
  const hold = (key: string, start: OC.HolderChange["start"]) => svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, POS[key]!, { start }), true);
  await hold("chair", { name: "Hessa Chair", from: PAST });
  await hold("ceo", { name: "Nasser Ceo", from: PAST });
  await hold("auditor", { name: "Auditor Person", from: PAST });
  await hold("cfo", { name: "Cfo Person", from: PAST });
  await hold("hrd", { userId: U.mgr, from: PAST });
  // Version 2 adds a treasury officer; then the draft holds a planner nobody at the client may see.
  const draftFin = (await owner.query(`SELECT u.id FROM org_units u WHERE u.version_id = $1 AND u.name_en = 'Finance'`, [await draftIdOf(ACME)])).rows[0].id;
  await svc(U.lead, (tx, p) => OC.addPosition(tx, p, draftFin, { titleAr: "أخصائي خزينة", titleEn: "Treasury officer" }), true);
  V2 = (await publishAs(U.lead, ACME)).versionId;
  const draftHr = (await owner.query(`SELECT u.id FROM org_units u WHERE u.version_id = $1 AND u.name_en = 'Human resources'`, [await draftIdOf(ACME)])).rows[0].id;
  await svc(U.lead, (tx, p) => OC.addPosition(tx, p, draftHr, { titleAr: "مخطط إعادة الهيكلة", titleEn: DRAFT_ONLY }), true);

  // Another client's chart (the firm admin builds it), a minimal-records client's and a restricted client's.
  await svc(U.admin, (tx, p) => OC.startChart(tx, p, OTHER), true);
  await build(U.admin, OTHER, [["board", { kind: "board", nameEn: "Other board" }]], [["chair", "board", { titleEn: "Other chair", isHead: true }]]);
  OTHER_V = (await publishAs(U.admin, OTHER)).versionId;
  await svc(U.lead, (tx, p) => OC.startChart(tx, p, MANAGED), true);
  await build(U.lead, MANAGED, [["council", { kind: "board", nameEn: "Family council" }]], [["head", "council", { titleEn: "Council head", isHead: true }]]);
  await publishAs(U.lead, MANAGED);
  await svc(U.lead, (tx, p) => OC.startChart(tx, p, RESTR), true);
  const restr = await build(U.lead, RESTR, [["board", { kind: "board", nameEn: "Restr board" }]], [["chair", "board", { titleEn: "Restr chair", isHead: true }]]);
  await publishAs(U.lead, RESTR);
  await svc(U.radmin, (tx, p) => OC.changeHolder(tx, p, restr.positions.chair!, { start: { name: "Restr Chairwoman", from: PAST } }), true);
});

beforeEach(async () => {
  await owner.query(`UPDATE org_chart_versions SET show_names = false WHERE id = $1`, [V2]);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("the Structure tab reads exactly what the services allow", () => {
  it("the firm's readers: the current version with every name, as getPublishedChart gives it", async () => {
    for (const who of [U.admin, U.lead, U.deputy, U.cons, U.obs]) {
      const [view, chart] = await svc(who, async (tx, p) => [await OC.getStructure(tx, p, ACME), await OC.getPublishedChart(tx, p, ACME)] as const);
      expect(OC.canReadStructure((await svc(who, async (_tx, p) => p))!, ACME), who).toBe(true);
      expect(view.shown!.version.id, who).toBe(V2);
      expect([view.shown!.names, view.shown!.units, view.shown!.positions], who).toEqual([chart.names, chart.units, chart.positions]);
      expect(namesIn(view.shown!), who).toEqual([...NAMES].sort());
      // The draft first in the list, then the current version, then history.
      expect(view.versions.map((v) => v.state), who).toEqual(["draft", "published", "superseded"]);
    }
  });

  it("the firm also opens the draft, marked as the draft, and earlier versions as getVersion gives them", async () => {
    const draft = await svc(U.lead, (tx, p) => OC.getStructure(tx, p, ACME, "draft"));
    expect(draft.shown!.version.state).toBe("draft");
    expect(draft.shown!.positions.map((p) => p.titleEn)).toContain(DRAFT_ONLY);
    const same = await svc(U.lead, (tx, p) => OC.getStructure(tx, p, ACME, draft.shown!.version.id));
    expect(same.shown!.positions).toEqual(draft.shown!.positions);
    const [old, direct] = await svc(U.obs, async (tx, p) => [await OC.getStructure(tx, p, ACME, V1), await OC.getVersion(tx, p, V1)] as const);
    expect([old.shown!.version, old.shown!.asOf, old.shown!.names, old.shown!.positions]).toEqual([direct.version, direct.asOf, direct.names, direct.positions]);
    expect(old.shown!.positions.map((p) => p.titleEn)).not.toContain("Treasury officer");
  });

  it("the client's admin: every name on the current version and the history; never the draft", async () => {
    const [view, chart] = await svc(U.cadmin, async (tx, p) => [await OC.getStructure(tx, p, ACME), await OC.getPublishedChart(tx, p, ACME)] as const);
    expect([view.shown!.names, view.shown!.positions]).toEqual([chart.names, chart.positions]);
    expect(namesIn(view.shown!)).toEqual([...NAMES].sort());
    expect(view.versions.map((v) => v.state)).toEqual(["published", "superseded"]);
    const draftId = await draftIdOf(ACME);
    await expect(svc(U.cadmin, (tx, p) => OC.getStructure(tx, p, ACME, "draft"))).rejects.toThrow(REFUSED);
    await expect(svc(U.cadmin, (tx, p) => OC.getStructure(tx, p, ACME, draftId))).rejects.toThrow(REFUSED);
    for (const pick of [undefined, V1, V2]) {
      const s = await svc(U.cadmin, (tx, p) => OC.getStructure(tx, p, ACME, pick));
      expect(JSON.stringify(s)).not.toContain(DRAFT_ONLY);
    }
  });

  it("a manager: every title, no name while show names is off", async () => {
    const [view, chart] = await svc(U.mgr, async (tx, p) => [await OC.getStructure(tx, p, ACME), await OC.getPublishedChart(tx, p, ACME)] as const);
    expect([view.shown!.names, view.shown!.positions]).toEqual(["none", chart.positions]);
    expect(view.shown!.positions).toHaveLength(7);
    expect(namesIn(view.shown!)).toEqual([]);
    // Vacancies are not names: the analyst and the treasury officer.
    expect(view.shown!.positions.filter((p) => p.vacant).map((p) => p.titleEn).sort()).toEqual(["Analyst", "Treasury officer"]);
    await expect(svc(U.mgr, (tx, p) => OC.getStructure(tx, p, ACME, "draft"))).rejects.toThrow(REFUSED);
  });

  it("a manager with show names on: names only in her branch and the chain above it, as the database sends them", async () => {
    await svc(U.cadmin, (tx, p) => OC.setShowNames(tx, p, V2, true), true);
    const [view, chart] = await svc(U.mgr, async (tx, p) => [await OC.getStructure(tx, p, ACME), await OC.getPublishedChart(tx, p, ACME)] as const);
    expect(view.shown!.names).toBe("branch");
    expect(view.shown!.positions).toEqual(chart.positions);
    expect(namesIn(view.shown!)).toEqual(["Cfo Person", "Hessa Chair", "Nasser Ceo"]);
    // What the drawing gets is that, and nothing more.
    const drawn = buildTree(view.shown!.units, view.shown!.positions, { locale: "en", depth: null, names: true });
    expect(JSON.stringify(drawn)).not.toMatch(/Auditor Person|mgr person/);
    // A manager in no department has no branch.
    expect(namesIn((await svc(U.mgr2, (tx, p) => OC.getStructure(tx, p, ACME))).shown!)).toEqual([]);
    // Earlier versions are titles only for her.
    const old = await svc(U.mgr, (tx, p) => OC.getStructure(tx, p, ACME, V1));
    expect([old.shown!.names, old.shown!.positions.every((p) => p.vacant === null && p.holders.length === 0)]).toEqual(["none", true]);
  });

  it("a minimal-records client: titles only", async () => {
    const view = await svc(U.lead, (tx, p) => OC.getStructure(tx, p, MANAGED));
    expect([view.shown!.names, view.shown!.positions.map((p) => [p.titleEn, p.vacant, p.holders])]).toEqual(["none", [["Council head", null, []]]]);
  });

  it("a restricted client: its admin reads every name", async () => {
    const view = await svc(U.radmin, (tx, p) => OC.getStructure(tx, p, RESTR));
    expect([view.shown!.names, namesIn(view.shown!)]).toEqual(["all", ["Restr Chairwoman"]]);
  });

  it("an action owner has no tab: refused", async () => {
    expect(OC.canReadStructure((await svc(U.owner, async (_tx, p) => p))!, ACME)).toBe(false);
    await expect(svc(U.owner, (tx, p) => OC.getStructure(tx, p, ACME))).rejects.toThrow(REFUSED);
    await expect(svc(U.owner, (tx, p) => OC.getStructure(tx, p, ACME, V2))).rejects.toThrow(REFUSED);
  });

  it("another client's chart is 404, and so is its version through this client's address", async () => {
    for (const who of [U.oadmin, U.omgr]) {
      expect(OC.canReadStructure((await svc(who, async (_tx, p) => p))!, ACME), who).toBe(false);
      await expect(svc(who, (tx, p) => OC.getStructure(tx, p, ACME))).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => OC.getStructure(tx, p, OTHER, V2))).rejects.toThrow(REFUSED);
    }
    await expect(svc(U.cadmin, (tx, p) => OC.getStructure(tx, p, OTHER))).rejects.toThrow(REFUSED);
    await expect(svc(U.cadmin, (tx, p) => OC.getStructure(tx, p, ACME, OTHER_V))).rejects.toThrow(REFUSED);
    // The firm admin reads both, but never one client's version under the other's address.
    await expect(svc(U.admin, (tx, p) => OC.getStructure(tx, p, ACME, OTHER_V))).rejects.toThrow(REFUSED);
    await expect(svc(U.admin, (tx, p) => OC.getStructure(tx, p, ACME, "not-a-version"))).rejects.toThrow(REFUSED);
    // A consultant on the team staffed on nothing.
    expect(OC.canReadStructure((await svc(U.team, async (_tx, p) => p))!, ACME)).toBe(false);
    await expect(svc(U.team, (tx, p) => OC.getStructure(tx, p, ACME))).rejects.toThrow(REFUSED);
  });

  it("the firm's Departments tab beside it is Not found, never an error, for a firm person outside the client's team", async () => {
    const principal = async (who: string) => (await svc(who, async (_tx, p) => p))!;
    // The lead of Acme is not on Other's team: the page answers Not found instead of failing on getEngagement().
    expect(canReadDepartments(await principal(U.lead), OTHER)).toBe(false);
    await expect(svc(U.lead, (tx, p) => getEngagement(tx, p, OTHER))).rejects.toThrow(/forbidden/);
    for (const who of [U.admin, U.lead, U.team, U.obs]) expect(canReadDepartments(await principal(who), ACME), who).toBe(true);
  });

  it("the Structure tab shows only when there is something the reader may read: a published version, and for the firm a draft with units", async () => {
    const tab = (who: string, client = FRESH) => svc(who, (tx, p) => OC.hasStructure(tx, p, client));
    const read = (who: string) => svc(who, (tx, p) => OC.getStructure(tx, p, FRESH));
    // No chart yet: no tab for anyone, and nothing to show.
    expect([await tab(U.lead), await tab(U.admin), await tab(U.fadmin)]).toEqual([false, false, false]);
    expect([(await read(U.lead)).shown, (await read(U.fadmin)).shown]).toEqual([null, null]);
    // Started, still empty: nothing to read yet.
    await svc(U.lead, (tx, p) => OC.startChart(tx, p, FRESH), true);
    expect([await tab(U.lead), await tab(U.fadmin)]).toEqual([false, false]);
    // A draft with a unit: the firm's tab, never the client's.
    await build(U.lead, FRESH, [["board", { kind: "board", nameEn: "Fresh board" }]], [["chair", "board", { titleEn: "Fresh chair", isHead: true }]]);
    expect([await tab(U.lead), await tab(U.admin), await tab(U.fadmin)]).toEqual([true, true, false]);
    const firm = await read(U.lead);
    expect([firm.current, firm.shown!.version.state]).toEqual([null, "draft"]);
    const client = await read(U.fadmin);
    expect([client.shown, client.versions]).toEqual([null, []]);
    await expect(pdf(U.fadmin, FRESH)).rejects.toThrow(REFUSED);
    // Published: everyone who reads the structure has the tab; never an action owner, another client or a firm person outside the client.
    await publishAs(U.lead, FRESH);
    expect([await tab(U.lead), await tab(U.fadmin)]).toEqual([true, true]);
    expect([await tab(U.cadmin), await tab(U.mgr), await tab(U.obs)]).toEqual([false, false, false]);
    expect([await tab(U.cadmin, ACME), await tab(U.mgr, ACME), await tab(U.obs, ACME), await tab(U.owner, ACME), await tab(U.team, ACME), await tab(U.oadmin, ACME)]).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe("the PDF holds what the tab holds", () => {
  it("the firm: the current version, A3 landscape, every name, the footer with version, effective day, print day and client", async () => {
    const { file, html, footer } = await pdf(U.lead, ACME, {}, "ar");
    expect(file.contentType).toBe("application/pdf");
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain("@page{size:A3 landscape;");
    expect(html).not.toMatch(/<script/i);
    for (const n of NAMES) expect(html).toContain(n);
    expect(html).toContain("شاغر");
    expect(html).not.toContain(DRAFT_ONLY);
    expect(html).not.toContain("مخطط إعادة الهيكلة");
    // An overview page, then Finance and Human resources.
    expect(html.match(/<section class="page">/g)).toHaveLength(3);
    const day = (iso: string) => new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
    expect(footer).toBe(`أكمي · الإصدار 2، الحالي · نافذ من ${day(firmToday())} · تاريخ الطباعة ${day(firmToday())}`);
    const audit = await owner.query(`SELECT actor_id, meta FROM audit_log WHERE action = 'org_chart.export' ORDER BY created_at DESC LIMIT 1`);
    expect(audit.rows[0]).toMatchObject({ actor_id: U.lead, meta: { client: ACME, number: 2, size: "a3", names: true } });
  });

  it("A4, a depth, and a copy without names hold no name at all", async () => {
    const { html } = await pdf(U.cadmin, ACME, { size: "a4", names: false, depth: "2" });
    expect(html).toContain("@page{size:A4 landscape;");
    for (const n of NAMES) expect(html).not.toContain(n);
    // Two levels: the board and the chief executive, no department page.
    expect(html).not.toContain("Finance");
    expect(html.match(/<section class="page">/g)).toHaveLength(1);
  });

  it("a manager's PDF never has a name her tab would not show", async () => {
    let { html } = await pdf(U.mgr, ACME);
    for (const n of NAMES) expect(html).not.toContain(n);
    await svc(U.cadmin, (tx, p) => OC.setShowNames(tx, p, V2, true), true);
    ({ html } = await pdf(U.mgr, ACME));
    expect(["Cfo Person", "Hessa Chair", "Nasser Ceo"].every((n) => html.includes(n))).toBe(true);
    expect(html).not.toMatch(/Auditor Person|mgr person/);
  });

  it("the firm's draft prints for the firm, marked; never for the client", async () => {
    const { html, footer } = await pdf(U.deputy, ACME, { version: "draft" });
    expect(html).toContain(DRAFT_ONLY);
    expect(html).toContain('<p class="draft">The firm&#39;s draft: the client does not see it.</p>');
    expect(footer).toContain("Unpublished draft");
    await expect(pdf(U.cadmin, ACME, { version: "draft" })).rejects.toThrow(REFUSED);
    await expect(pdf(U.cadmin, ACME, { version: await draftIdOf(ACME) })).rejects.toThrow(REFUSED);
    await expect(pdf(U.mgr, ACME, { version: "draft" })).rejects.toThrow(REFUSED);
  });

  it("refuses an action owner, another client's people and a firm person outside the client, and prints nothing", async () => {
    printed.length = 0;
    for (const [who, client, version] of [
      [U.owner, ACME, undefined],
      [U.oadmin, ACME, undefined],
      [U.omgr, ACME, undefined],
      [U.team, ACME, undefined],
      [U.cadmin, OTHER, undefined],
      [U.admin, ACME, OTHER_V],
    ] as const) {
      await expect(svc(who, (tx, p) => orgChartPdf(tx, p, client, { size: "a3", names: true, version }, "en")), who).rejects.toThrow(REFUSED);
    }
    expect(printed).toEqual([]);
  });

  it("an earlier version says it was replaced, when and by which version, and whose holders it shows, on screen and in print", async () => {
    const day = (iso: string) => new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
    const today = firmToday();
    const view = await svc(U.cadmin, (tx, p) => OC.getStructure(tx, p, ACME, V1));
    expect(view.shown!.status).toEqual({ kind: "past", replacedOn: today, by: 2 });
    expect(view.versions.map((v) => [v.number, v.status.kind])).toEqual([
      [2, "current"],
      [1, "past"],
    ]);
    const { html, footer } = await pdf(U.cadmin, ACME, { version: V1 });
    const said = `Version 1 · In effect from ${day(today)} · Replaced on ${day(today)} by version 2 · Who held each position on ${day(today)}`;
    expect(html).toContain(`<p class="meta">${said}</p>`);
    expect(footer).toBe(`Acme · ${said} · Printed on ${day(today)}`);
    // The current version says it is current, and nothing about being replaced.
    const now = await pdf(U.cadmin, ACME);
    expect(now.footer).toBe(`Acme · Version 2, current · In effect from ${day(today)} · Printed on ${day(today)}`);
  });

  it("a version that takes effect later is not 'current': it says when it takes effect, and the one it replaces stays current until then", async () => {
    const draftId = await draftIdOf(OTHER);
    await svc(U.admin, (tx, p) => OC.publish(tx, p, OTHER, { draftId, effectiveOn: "2099-01-01" }), true);
    const view = await svc(U.admin, (tx, p) => OC.getStructure(tx, p, OTHER));
    expect([view.shown!.version.number, view.shown!.status]).toEqual([2, { kind: "upcoming", on: "2099-01-01" }]);
    expect(view.versions.filter((v) => v.state !== "draft").map((v) => [v.number, v.status])).toEqual([
      [2, { kind: "upcoming", on: "2099-01-01" }],
      [1, { kind: "current", until: "2099-01-01", by: 2 }],
    ]);
    const { html } = await pdf(U.admin, OTHER);
    expect(html).toContain('<p class="meta">Version 2 · Takes effect on Jan 1, 2099</p>');
    expect(html).not.toContain("current");
  });

  it("the file is named after the structure, the client and the version, so two downloads do not share a name", async () => {
    const today = firmToday();
    const now = await pdf(U.cadmin, ACME, {}, "ar");
    expect([now.file.fileName, now.file.title]).toEqual([`selah-structure-v2-${today}.pdf`, "الهيكل التنظيمي - أكمي - الإصدار 2"]);
    const old = await pdf(U.cadmin, ACME, { version: V1 });
    expect([old.file.fileName, old.file.title]).toEqual([`selah-structure-v1-${today}.pdf`, "Organisation structure - Acme - Version 1"]);
    const draft = await pdf(U.lead, ACME, { version: "draft" });
    expect([draft.file.fileName, draft.file.title]).toEqual([`selah-structure-draft-${today}.pdf`, "Organisation structure - Acme - Draft"]);
    // The draft's banner is on every page.
    expect(draft.html.match(/<p class="draft">/g)!.length).toBe(draft.html.match(/<section class="page">/g)!.length);
  });

  it("a minimal-records client prints titles only", async () => {
    const { html } = await pdf(U.lead, MANAGED);
    expect(html).toContain("Council head");
    expect(html).not.toContain("Vacant");
  });
});
