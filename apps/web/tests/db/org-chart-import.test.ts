// Org chart, part 4, against a real Postgres: the ways in (the Excel
// template and its export, a Word outline, the assistant's draft from pasted
// text) and the save into the firm's draft. Only the draft's editors may
// import; another client is a 404; a row with an error saves nothing;
// nothing is published; the template round-trips; the assistant's model
// never sees a known name and nothing it adds that is not in the text is kept.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { firmToday } from "@/lib/dates";
import { writeXlsx } from "@/lib/office/xlsx-write";
import { readEntries } from "@/lib/office/zip";
import { ORG_IMPORT_FIELDS, type OrgValues } from "@/lib/org-chart-import";
import type { PreparedUpload } from "@/services/evidence";
import { loadPrincipal } from "@/services/principal";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import { truncateAuditLog } from "./audit-reset";

// The model, faked: it keeps what reached it and answers with what the test sets.
const sent = vi.hoisted(() => [] as string[]);
const answer = vi.hoisted(() => ({ fn: (masked: string) => ({ units: [], positions: [], seen: masked.length }) as { units: unknown[]; positions: unknown[] } }));
vi.mock("@/services/ai-client", () => ({
  draftOrgChart: async (text: string) => {
    sent.push(text);
    return { ...answer.fn(text), model: "fake" };
  },
  embed: async () => {
    throw new Error("not in tests");
  },
  answer: async () => {
    throw new Error("not in tests");
  },
  translateText: async () => {
    throw new Error("not in tests");
  },
  summarizePages: async () => {
    throw new Error("not in tests");
  },
}));
// The export translates on the server; outside a request, the real messages through next-intl's own translator.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = { ar: (await import("../../messages/ar.json")).default, en: (await import("../../messages/en.json")).default };
  return {
    getTranslations: async ({ locale, namespace }: { locale: "ar" | "en"; namespace?: string }) =>
      createTranslator({ locale, messages: messages[locale], namespace: namespace as never }),
  };
});

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

// The app's configuration (the import's token is signed with the auth secret).
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

const OC = await import("@/services/org-chart");
const IM = await import("@/services/org-chart-import");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-0c1d-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const SAHM = id(2); // full, departments on: the chart under test
const OTHER = id(3); // another client of the firm
const MANAGED = id(4); // consultant-managed with minimal records: titles only
const NOPROJ = id(5); // a client with no project yet: the assistant has nothing to read for it
const P = id(6);
const P_OTHER = id(7);
const P_MANAGED = id(8);
const U = {
  admin: id(21), // firm admin
  lead: id(22), // Sahm's and Managed's lead
  deputy: id(23), // Sahm's deputy
  cons: id(24), // staffed on Sahm's project
  obs: id(25), // observing Sahm's project
  team: id(26), // on Sahm's team, staffed on nothing
  cadmin: id(27),
  mgr: id(28), // a Sahm manager with an account, placed by e-mail
  owner: id(29),
  oadmin: id(30), // Other's admin
};
const NAMES: Record<keyof typeof U, string> = {
  admin: "Huda Firm-Admin",
  lead: "Majed Lead-Consultant",
  deputy: "Deputy Person",
  cons: "Staffed Person",
  obs: "Observer Person",
  team: "Team Person",
  cadmin: "Sahm Admin-Person",
  mgr: "Nawaf Al-Qasimi",
  owner: "Owner Person",
  oadmin: "Other Admin-Person",
};

const REFUSED = /not found|forbidden/i;

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
const q = (text: string, params: unknown[] = []) => owner.query(text, params);

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** A file as the upload scan hands it over. */
const upload = (bytes: Uint8Array, fileName: string, contentType = XLSX): PreparedUpload => ({
  bytes,
  fileName,
  contentType,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  scanned: false,
  scanMs: 0,
});
/** A filled template: Arabic headings over English ones, as the template writes them. */
const workbook = (rows: OrgValues[]) =>
  writeXlsx([
    {
      name: "الهيكل",
      rtl: true,
      columns: ORG_IMPORT_FIELDS.map((f) => ({ header: `${ar.orgChartImport.fields[f]}\n${en.orgChartImport.fields[f]}` })),
      rows: rows.map((r) => ORG_IMPORT_FIELDS.map((f) => r[f] ?? "")),
    },
  ]);

/** Read a file and save its rows, as the review step does when nothing needs fixing. */
async function importFile(userId: string, client: string, file: PreparedUpload, mode?: "replace" | "add", commit = true) {
  return svc(
    userId,
    async (tx, p) => {
      const read = await IM.parseImportFile(tx, p, client, file);
      return IM.saveImport(tx, p, client, { token: read.token, rows: read.rows.map((r) => ({ line: r.line, values: r.values })), mode });
    },
    commit,
  );
}

const SAHM_ROWS: OrgValues[] = [
  { unitCode: "1", unitNameAr: "مجلس الإدارة", unitNameEn: "Board", unitKind: "مجلس", level: "1", positionCode: "1.1", titleAr: "رئيس مجلس الإدارة", head: "نعم", holder: "Reem Al-Harbi" },
  { unitCode: "2", unitNameAr: "الرئيس التنفيذي", unitKind: "تنفيذي", parentCode: "1", level: "2", positionCode: "2.1", titleAr: "الرئيس التنفيذي", titleEn: "CEO", reportsTo: "1.1", head: "نعم", holder: "MGR@example.test" },
  {
    unitCode: "2.1",
    unitNameAr: "الإدارة المالية",
    unitNameEn: "Finance",
    unitKind: "إدارة",
    parentCode: "2",
    level: "3",
    positionCode: "2.1.1",
    titleAr: "مدير الإدارة المالية",
    reportsTo: "2.1",
    head: "نعم",
    specialties: "الميزانية؛ التقارير المالية",
  },
  { unitCode: "2.1", positionCode: "2.1.2", titleAr: "محاسب", reportsTo: "2.1.1", vacant: "نعم", planned: "2" },
  { unitCode: "2.2", unitNameEn: "Internal audit", unitKind: "unit", parentCode: "1", level: "2", advisory: "yes" },
];

/** The draft as an editor reads it, by code: the structure, and who holds what. */
async function draftOf(userId: string, client: string) {
  const d = await svc(userId, (tx, p) => OC.getDraft(tx, p, client));
  const unitCode = new Map(d.units.map((u) => [u.id, u.code]));
  const code = new Map(d.positions.map((p) => [p.id, p.code]));
  return {
    units: d.units
      .map((u) => ({ code: u.code, nameAr: u.nameAr, nameEn: u.nameEn, kind: u.kind, level: u.level, advisory: u.advisory, parent: u.parentId ? unitCode.get(u.parentId) : null }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    positions: d.positions
      .map((p) => ({
        id: p.id,
        code: p.code,
        unit: unitCode.get(p.unitId),
        titleAr: p.titleAr,
        titleEn: p.titleEn,
        reportsTo: p.reportsToId ? code.get(p.reportsToId) : null,
        isHead: p.isHead,
        specialties: p.specialties,
        plannedCount: p.plannedCount,
        holders: p.holders.map((h) => ({ id: h.id, userId: h.userId, name: h.name })),
        vacant: p.vacant,
      }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}
const publishedCount = async (client: string) =>
  Number((await q(`SELECT count(*)::int AS n FROM org_chart_versions WHERE org_id = $1 AND state <> 'draft'`, [client])).rows[0].n);

beforeAll(async () => {
  await q(`TRUNCATE "user", organizations CASCADE`);
  await truncateAuditLog(owner);
  await q(
    `INSERT INTO organizations (id, kind, name, name_ar, engagement_mode, departments_enabled, minimal_records, display_alias) VALUES
      ($1,'firm','Mizan Advisory','ميزان للاستشارات',NULL,false,false,NULL), ($2,'client','Sahm Trading','شركة سهم للتجارة','full',true,false,NULL),
      ($3,'client','Other Client',NULL,'full',false,false,NULL), ($4,'client','Managed','', 'consultant_managed',false,true,'Family office A'),
      ($5,'client','Noproj Client',NULL,'full',false,false,NULL)`,
    [FIRM, SAHM, OTHER, MANAGED, NOPROJ],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [k, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, NAMES[k as keyof typeof U], `${k}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$11,'firm_admin'), ($2,$11,'consultant'), ($3,$11,'consultant'), ($4,$11,'consultant'), ($5,$11,'consultant'), ($6,$11,'consultant'),
      ($7,$12,'client_admin'), ($8,$12,'client_manager'), ($9,$12,'action_owner'), ($10,$13,'client_admin')`,
    [U.admin, U.lead, U.deputy, U.cons, U.obs, U.team, U.cadmin, U.mgr, U.owner, U.oadmin, FIRM, SAHM, OTHER],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$2,$7,'Sahm governance','active',$8), ($3,'client',$4,$7,'Other governance','active',$8), ($5,'client',$6,$7,'Managed charter','active',$8)`,
    [P, SAHM, P_OTHER, OTHER, P_MANAGED, MANAGED, FIRM, U.admin],
  );
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES
      ($1,$2,true,false), ($1,$3,false,true), ($1,$4,false,false), ($1,$5,false,false), ($1,$6,false,false), ($7,$2,true,false)`,
    [SAHM, U.lead, U.deputy, U.cons, U.obs, U.team, MANAGED],
  );
  await q(`INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,false), ($1,$3,true), ($1,$4,false), ($1,$5,false)`, [P, U.cons, U.obs, U.mgr, U.owner]);
  await q(`INSERT INTO departments (org_id, name_ar, name_en) VALUES ($1,'المالية','Finance')`, [SAHM]);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("who may import", () => {
  const file = () => upload(workbook(SAHM_ROWS), "structure.xlsx");

  it("only the draft's editors: the firm admin, the lead, the deputy and a consultant staffed (not observing)", async () => {
    for (const who of [U.admin, U.lead, U.deputy, U.cons]) {
      const view = await svc(who, (tx, p) => IM.importContext(tx, p, SAHM));
      expect(view, who).not.toBeNull();
      expect(view!.client.id).toBe(SAHM);
    }
    // Observers read the structure but change nothing; the team member staffed on nothing, and the client's people, read no draft.
    for (const who of [U.obs, U.team, U.cadmin, U.mgr, U.owner, U.oadmin]) {
      expect(await svc(who, (tx, p) => IM.importContext(tx, p, SAHM)), who).toBeNull();
      await expect(svc(who, (tx, p) => IM.parseImportFile(tx, p, SAHM, file())), who).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => IM.draftFromText(tx, p, SAHM, "Accountant")), who).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => IM.saveImport(tx, p, SAHM, { token: "x.y", rows: [{ line: 2, values: { unitCode: "1", unitNameEn: "Board" } }] })), who).rejects.toThrow(REFUSED);
      expect(await svc(who, async (_tx, p) => IM.canImport(p, SAHM)), who).toBe(false);
    }
    expect(sent).toEqual([]);
  });

  it("another client is a 404, even with a token of one's own client", async () => {
    const token = (await svc(U.lead, (tx, p) => IM.parseImportFile(tx, p, SAHM, file()))).token;
    for (const who of [U.lead, U.deputy, U.cons]) {
      expect(await svc(who, (tx, p) => IM.importContext(tx, p, OTHER)), who).toBeNull();
      await expect(svc(who, (tx, p) => IM.parseImportFile(tx, p, OTHER, file())), who).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => IM.saveImport(tx, p, OTHER, { token, rows: [{ line: 2, values: { unitCode: "1", unitNameEn: "Board" } }] })), who).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => IM.orgChartWorkbook(tx, p, OTHER, undefined, "ar")), who).rejects.toThrow(REFUSED);
    }
    // A token is for its own client and person only.
    await expect(svc(U.admin, (tx, p) => IM.saveImport(tx, p, OTHER, { token, rows: [{ line: 2, values: { unitCode: "1", unitNameEn: "Board" } }] }))).rejects.toThrow(/expired/);
    expect(await q(`SELECT 1 FROM org_charts WHERE org_id = $1`, [OTHER]).then((r) => r.rowCount)).toBe(0);
  });
});

/** The plans of the client's draft by position code (read as the database's owner, past every rule). */
async function plansOf(client: string) {
  const { rows } = await q(
    `SELECT p.code, h.user_id, h.name FROM org_chart_planned_holders h JOIN positions p ON p.id = h.position_id
     JOIN org_chart_versions v ON v.id = p.version_id WHERE h.org_id = $1 AND v.state = 'draft' ORDER BY p.code, h.sort_order`,
    [client],
  );
  const out: Record<string, { userId: string | null; name: string | null }[]> = {};
  for (const r of rows) (out[r.code] ??= []).push({ userId: r.user_id, name: r.name });
  return out;
}
/** How many holdings (people in positions) the client's structure has, now or in the past. */
const holdingsOf = async (client: string) => Number((await q(`SELECT count(*)::int AS n FROM position_holders WHERE org_id = $1`, [client])).rows[0].n);
/** How many plans a person can read, straight from row-level security. */
const plansSeenBy = (who: string) => as(who, async (c) => Number((await c.query(`SELECT count(*)::int AS n FROM org_chart_planned_holders`)).rows[0].n));

describe("saving into the draft", () => {
  it("refuses the whole save when a row has an error, and saves nothing", async () => {
    const bad = SAHM_ROWS.map((r) => (r.positionCode === "2.1.1" ? { ...r, parentCode: "9" } : r));
    await expect(importFile(U.lead, SAHM, upload(workbook(bad), "bad.xlsx"))).rejects.toThrow(/rows with errors: 4/);
    expect(await q(`SELECT 1 FROM org_charts WHERE org_id = $1`, [SAHM]).then((r) => r.rowCount)).toBe(0);
  });

  it("starts the chart and its draft, writes every row, plans people by e-mail or typed name without placing anyone, and publishes nothing", async () => {
    await truncateAuditLog(owner);
    const saved = await importFile(U.lead, SAHM, upload(workbook(SAHM_ROWS), "structure.xlsx"));
    expect(saved.counts).toMatchObject({ unitsAdded: 4, positionsAdded: 4, planned: 2, unitsRemoved: 0, positionsRemoved: 0 });
    const d = await draftOf(U.lead, SAHM);
    expect(d.units).toEqual([
      { code: "1", nameAr: "مجلس الإدارة", nameEn: "Board", kind: "board", level: 1, advisory: false, parent: null },
      { code: "2", nameAr: "الرئيس التنفيذي", nameEn: null, kind: "executive", level: 2, advisory: false, parent: "1" },
      { code: "2.1", nameAr: "الإدارة المالية", nameEn: "Finance", kind: "department", level: 3, advisory: false, parent: "2" },
      { code: "2.2", nameAr: null, nameEn: "Internal audit", kind: "unit", level: 2, advisory: true, parent: "1" },
    ]);
    const pos = Object.fromEntries(d.positions.map((p) => [p.code, p]));
    expect(pos["1.1"]).toMatchObject({ unit: "1", isHead: true, reportsTo: null });
    expect(pos["2.1"]).toMatchObject({ unit: "2", titleEn: "CEO", isHead: true, reportsTo: "1.1" });
    expect(pos["2.1.1"]).toMatchObject({ reportsTo: "2.1", specialties: ["الميزانية", "التقارير المالية"] });
    expect(pos["2.1.2"]).toMatchObject({ reportsTo: "2.1.1", plannedCount: 2 });
    // An import places nobody: the holder column is a plan, for publishing to carry out.
    expect(await holdingsOf(SAHM)).toBe(0);
    expect(d.positions.every((p) => p.holders.length === 0)).toBe(true);
    expect(await plansOf(SAHM)).toEqual({ "1.1": [{ userId: null, name: "Reem Al-Harbi" }], "2.1": [{ userId: U.mgr, name: null }] });
    // Nothing is published: the client sees no structure, and the Structure tab offers it nothing.
    expect(await publishedCount(SAHM)).toBe(0);
    expect((await svc(U.cadmin, (tx, p) => OC.getPublishedChart(tx, p, SAHM))).version).toBeNull();
    expect(await svc(U.cadmin, (tx, p) => OC.hasStructure(tx, p, SAHM))).toBe(false);
    const logged = (await q(`SELECT action, meta FROM audit_log WHERE action LIKE 'org_chart.import%' OR action = 'org_chart.plan'`)).rows;
    expect(logged.map((r) => r.action).sort()).toEqual(["org_chart.import", "org_chart.import_read", "org_chart.plan", "org_chart.plan"]);
    expect(logged.find((r) => r.action === "org_chart.import")!.meta).toMatchObject({ source: "xlsx", mode: "add", unitsAdded: 4 });
    // The audit says a plan changed, never whom it names.
    expect(JSON.stringify(logged.filter((r) => r.action === "org_chart.plan").map((r) => r.meta))).not.toMatch(/Reem|mgr@/);
  });

  it("lets only the draft's editors read or write a plan: never a client person, an observer or anyone of another client", async () => {
    for (const who of [U.admin, U.lead, U.deputy, U.cons]) expect(await plansSeenBy(who), who).toBe(2);
    for (const who of [U.cadmin, U.mgr, U.owner, U.obs, U.team, U.oadmin]) expect(await plansSeenBy(who), who).toBe(0);
    const position = (await q(`SELECT h.position_id FROM org_chart_planned_holders h WHERE h.org_id = $1 LIMIT 1`, [SAHM])).rows[0].position_id;
    for (const who of [U.cadmin, U.mgr, U.obs]) {
      await expect(
        as(who, (c) => c.query(`INSERT INTO org_chart_planned_holders (org_id, position_id, name, created_by) VALUES ($1,$2,'Someone Else',$3)`, [SAHM, position, who])),
        who,
      ).rejects.toThrow(/row-level security/);
      expect((await as(who, (c) => c.query(`DELETE FROM org_chart_planned_holders`))).rowCount, who).toBe(0);
    }
    expect(await plansSeenBy(U.lead)).toBe(2);
  });

  it("asks whether to replace the draft or add to it once the draft holds something", async () => {
    await expect(importFile(U.lead, SAHM, upload(workbook(SAHM_ROWS), "again.xlsx"))).rejects.toThrow(/replace or add/);
    // Adding the same rows again: their position codes are already in the draft.
    await expect(importFile(U.lead, SAHM, upload(workbook(SAHM_ROWS), "again.xlsx"), "add")).rejects.toThrow(/rows with errors/);
  });

  it("round-trips: the draft exported in the template and brought back in is the same structure, the same positions and plans", async () => {
    const before = await draftOf(U.lead, SAHM);
    const plans = await plansOf(SAHM);
    for (const locale of ["ar", "en"] as const) {
      const file = await svc(U.lead, (tx, p) => IM.orgChartWorkbook(tx, p, SAHM, "draft", locale));
      const read = await svc(U.lead, (tx, p) => IM.parseImportFile(tx, p, SAHM, upload(file.bytes, file.fileName)));
      // The draft's holder column is its plan; a person with an account goes out as their e-mail, so they come back as the same person.
      expect(read.rows.find((r) => r.values.positionCode === "2.1")!.values.holder).toBe("mgr@example.test");
      expect(read.rows.find((r) => r.values.positionCode === "1.1")!.values.holder).toBe("Reem Al-Harbi");
      const saved = await svc(U.lead, (tx, p) => IM.saveImport(tx, p, SAHM, { token: read.token, rows: read.rows, mode: "replace" }), true);
      expect(saved.counts).toMatchObject({ unitsAdded: 0, unitsRemoved: 0, positionsAdded: 0, positionsRemoved: 0, planned: 0 });
      expect(await draftOf(U.lead, SAHM)).toEqual(before);
      expect(await plansOf(SAHM)).toEqual(plans);
    }
    expect(await holdingsOf(SAHM)).toBe(0);
  });

  it("round-trips what the app itself allows: a level set by hand at its parent's, more people planned than the planned number", async () => {
    // All in one transaction, rolled back: the next tests start from the draft as it was.
    await svc(U.lead, async (tx, p) => {
      const d = await OC.getDraft(tx, p, SAHM);
      const audit = d.units.find((u) => u.code === "2.2")!;
      await OC.updateUnit(tx, p, audit.id, { level: 1 });
      const more = [{ ...SAHM_ROWS[0]!, holder: "Reem Al-Harbi; Second Chair" }];
      const read1 = await IM.parseImportFile(tx, p, SAHM, upload(workbook([...more, ...SAHM_ROWS.slice(1).map((r) => (r.unitCode === "2.2" ? { ...r, level: "1" } : r))]), "more.xlsx"));
      await IM.saveImport(tx, p, SAHM, { token: read1.token, rows: read1.rows, mode: "replace" });
      const snapshot = async () => {
        const now = await OC.getDraft(tx, p, SAHM);
        return { units: now.units.map((u) => [u.code, u.level]), plans: (await IM.importContext(tx, p, SAHM))!.ctx.draft.positions.map((x) => [x.code, x.planned]) };
      };
      const before = await snapshot();
      expect(before.units).toContainEqual(["2.2", 1]);
      expect(before.plans).toContainEqual(["1.1", [{ userId: null, name: "Reem Al-Harbi" }, { userId: null, name: "Second Chair" }]]);
      const file = await IM.orgChartWorkbook(tx, p, SAHM, "draft", "ar");
      const read2 = await IM.parseImportFile(tx, p, SAHM, upload(file.bytes, file.fileName));
      const saved = await IM.saveImport(tx, p, SAHM, { token: read2.token, rows: read2.rows, mode: "replace" });
      expect(saved.counts).toMatchObject({ unitsChanged: 0, positionsChanged: 0, planned: 0 });
      expect(await snapshot()).toEqual(before);
    });
  });

  it("publishing leaves the plans for part 5, and no client reader ever sees one", async () => {
    const draftId = (await svc(U.lead, (tx, p) => OC.getDraft(tx, p, SAHM))).draft!.id;
    await svc(U.lead, (tx, p) => OC.publish(tx, p, SAHM, { draftId, effectiveOn: firmToday() }), true);
    expect(await holdingsOf(SAHM)).toBe(0);
    for (const who of [U.cadmin, U.mgr]) {
      const seen = await svc(who, (tx, p) => OC.getStructure(tx, p, SAHM));
      expect(seen.shown!.positions.every((p) => p.holders.length === 0)).toBe(true);
      expect(JSON.stringify(seen)).not.toMatch(/Reem|mgr@example/);
      expect(await plansSeenBy(who)).toBe(0);
      // The whole masking list names no plan for them (the firm's editors' list does); a text that names one is still masked.
      const list = await svc(who, async (tx) => (await tx.execute<{ term: string }>(sql`SELECT term FROM app_mask_terms(${P}::uuid)`)).rows.map((r) => r.term));
      expect(list).not.toContain("Reem Al-Harbi");
      const inText = await svc(who, async (tx) => (await tx.execute<{ term: string }>(sql`SELECT term FROM app_mask_terms_in(${P}::uuid, 'The Chair is Reem Al-Harbi')`)).rows.map((r) => r.term));
      expect(inText).toContain("Reem Al-Harbi");
    }
    const firm = await svc(U.lead, async (tx) => (await tx.execute<{ term: string }>(sql`SELECT term FROM app_mask_terms(${P}::uuid)`)).rows.map((r) => r.term));
    expect(firm).toContain("Reem Al-Harbi");
    // The snapshot the client reads has no names either.
    const snap = (await q(`SELECT published_snapshot::text AS s FROM org_chart_versions WHERE org_id = $1 AND state = 'published'`, [SAHM])).rows[0].s as string;
    expect(snap).not.toMatch(/Reem|mgr@example/);
  });

  it("replacing a published structure's draft changes the draft only: the published version stays, plans go with their positions, holdings never", async () => {
    // The client's admin places someone on the live structure.
    const live = await svc(U.cadmin, (tx, p) => OC.getPublishedChart(tx, p, SAHM));
    const director = live.positions.find((p) => p.code === "2.1.1")!;
    await svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, director.id, { start: { name: "Khalid Typed", from: firmToday() } }), true);
    const holdings = await holdingsOf(SAHM);
    const seen = await svc(U.cadmin, (tx, p) => OC.getPublishedChart(tx, p, SAHM));

    // Finance renamed, its two positions gone (the director's has someone in it on the live structure), a new one.
    const changed = [
      ...SAHM_ROWS.filter((r) => r.positionCode !== "2.1.2" && r.positionCode !== "2.1.1"),
      { unitCode: "2.1", unitNameAr: "الإدارة المالية والإدارية", unitNameEn: "Finance", unitKind: "إدارة", parentCode: "2", level: "3" },
      { unitCode: "2.1", positionCode: "2.1.3", titleAr: "أمين صندوق", reportsTo: "2.1", holder: "Saad Al-Dosari" },
    ];
    const saved = await importFile(U.lead, SAHM, upload(workbook(changed), "v2.xlsx"), "replace");
    expect(saved.counts).toMatchObject({ unitsChanged: 1, positionsAdded: 1, positionsRemoved: 2 });

    // The client's view, the number of published versions and every holding are unchanged.
    expect(await publishedCount(SAHM)).toBe(1);
    expect(await svc(U.cadmin, (tx, p) => OC.getPublishedChart(tx, p, SAHM))).toEqual(seen);
    expect(await holdingsOf(SAHM)).toBe(holdings);
    expect((await q(`SELECT to_date FROM position_holders WHERE org_id = $1 AND name = 'Khalid Typed'`, [SAHM])).rows).toEqual([{ to_date: null }]);
    // The draft holds the change, with the plans the rows give.
    const d = await draftOf(U.lead, SAHM);
    expect(d.units.find((u) => u.code === "2.1")!.nameAr).toBe("الإدارة المالية والإدارية");
    expect(d.positions.map((p) => p.code)).toEqual(["1.1", "2.1", "2.1.3"]);
    expect(await plansOf(SAHM)).toEqual({
      "1.1": [{ userId: null, name: "Reem Al-Harbi" }],
      "2.1": [{ userId: U.mgr, name: null }],
      "2.1.3": [{ userId: null, name: "Saad Al-Dosari" }],
    });
  });

  it("adding keeps everything in the draft and uses its units by code", async () => {
    const before = await draftOf(U.lead, SAHM);
    const plans = await plansOf(SAHM);
    const rows = [
      { unitCode: "2.1.9", unitNameEn: "Treasury", unitKind: "section", parentCode: "2.1", level: "4" },
      { unitCode: "2.1.9", positionCode: "2.1.9.1", titleEn: "Treasurer", reportsTo: "2.1" },
      { unitCode: "2", positionCode: "2.9", titleEn: "Executive assistant", reportsTo: "2.1" },
    ];
    await importFile(U.cons, SAHM, upload(workbook(rows), "add.xlsx"), "add");
    const d = await draftOf(U.lead, SAHM);
    expect(d.units).toEqual(expect.arrayContaining(before.units));
    expect(d.positions.filter((p) => before.positions.some((b) => b.id === p.id))).toEqual(before.positions);
    expect(d.units.find((u) => u.code === "2.1.9")).toMatchObject({ parent: "2.1", level: 4, kind: "section" });
    expect(d.positions.find((p) => p.code === "2.9")).toMatchObject({ unit: "2", reportsTo: "2.1" });
    expect(await plansOf(SAHM)).toEqual(plans);
  });

  it("serves a template whose code columns are Text, so Excel keeps a code such as 2.10 as typed", async () => {
    for (const locale of ["ar", "en"] as const) {
      const file = await IM.orgChartTemplate(locale);
      const files = readEntries(file.bytes, (p) => p.endsWith(".xml"));
      const xfs = [...(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(files.get("xl/styles.xml")!)![1]!.matchAll(/<xf [^>]*>/g))].map((m) => m[0]);
      const text = xfs.findIndex((x) => /numFmtId="49"/.test(x));
      const cols = [...files.get("xl/worksheets/sheet1.xml")!.matchAll(/<col min="(\d+)"[^>]*?(?: style="(\d+)")?\/>/g)];
      expect(cols.filter((m) => Number(m[2]) === text).map((m) => ORG_IMPORT_FIELDS[Number(m[1]) - 1])).toEqual(["unitCode", "parentCode", "positionCode", "reportsTo"]);
    }
  });

  it("reads a Word outline through the same scan and review", async () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const p = (style: string, text: string) => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const styles = `<?xml version="1.0"?><w:styles ${W}>${[1, 2, 3].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/></w:style>`).join("")}<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/></w:style></w:styles>`;
    const bytes = zipSync({
      "word/document.xml": strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${p("Heading1", "قطاع العمليات")}${p("Heading2", "إدارة المشتريات")}${p("ListBullet", "مدير المشتريات")}</w:body></w:document>`),
      "word/styles.xml": strToU8(styles),
    });
    const read = await svc(U.lead, (tx, pr) => IM.parseImportFile(tx, pr, SAHM, upload(bytes, "outline.docx", DOCX)));
    // Its codes avoid the draft's.
    expect(read.rows.map((r) => r.values)).toEqual([
      { unitCode: "3", unitNameAr: "قطاع العمليات", parentCode: "", level: "1" },
      { unitCode: "3.1", unitNameAr: "إدارة المشتريات", parentCode: "3", level: "2" },
      { unitCode: "3.1", positionCode: "3.1.1", titleAr: "مدير المشتريات" },
    ]);
    await expect(svc(U.lead, (tx, pr) => IM.parseImportFile(tx, pr, SAHM, upload(zipSync({ "word/document.xml": strToU8(`<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:r><w:t>Just text</w:t></w:r></w:p></w:body></w:document>`) }), "plain.docx", DOCX)))).rejects.toThrow(/no headings/);
    await expect(svc(U.lead, (tx, pr) => IM.parseImportFile(tx, pr, SAHM, upload(writeXlsx([{ name: "x", rtl: false, columns: [{ header: "Something" }], rows: [["else"]] }]), "other.xlsx")))).rejects.toThrow(/not the template/);
  });

  it("keeps no names at a client with minimal records: no plan, no holding", async () => {
    const rows = [{ unitCode: "1", unitNameEn: "Family council", positionCode: "1.1", titleEn: "Chair", head: "yes", holder: "Some Typed Name" }];
    await importFile(U.lead, MANAGED, upload(workbook(rows), "managed.xlsx"));
    expect((await draftOf(U.lead, MANAGED)).positions.map((p) => p.titleEn)).toEqual(["Chair"]);
    expect(await plansOf(MANAGED)).toEqual({});
    expect(await holdingsOf(MANAGED)).toBe(0);
  });
});


describe("the structure in the template (the filled export)", () => {
  it("is for the draft's editors only: everyone else, the client's people included, gets a 404", async () => {
    // Sahm has a published version and a draft by now.
    for (const who of [U.cadmin, U.mgr, U.owner, U.obs, U.team, U.oadmin]) {
      await expect(svc(who, (tx, p) => IM.orgChartWorkbook(tx, p, SAHM, undefined, "ar")), who).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => IM.orgChartWorkbook(tx, p, SAHM, "draft", "en")), who).rejects.toThrow(REFUSED);
    }
  });

  it("is limited like the PDF: ten a person in ten minutes", async () => {
    await svc(U.deputy, async (tx, p) => {
      for (let i = 0; i < 10; i++) await IM.orgChartWorkbook(tx, p, SAHM, "draft", "en");
      await expect(IM.orgChartWorkbook(tx, p, SAHM, "draft", "en")).rejects.toThrow(/too many/);
    });
  });
});

describe("the assistant's draft from pasted text", () => {
  const TEXT = [
    "Sahm Trading structure, prepared by Mizan Advisory.",
    "Finance department: the Finance Manager is Nawaf Al-Qasimi; the Accountant is Reem Al-Harbi (reem.h@example.test, 0551234567).",
    "Khalid Al-Otaibi is the Driver.",
    "المدير المالي في شركة سهم للتجارة",
  ].join("\n");

  it("is offered only when the AI service runs the local model, so no text reaches a hosted model", async () => {
    sent.length = 0;
    for (const hosted of ["openai_compat", "something-else"]) {
      process.env.LLM_PROVIDER = hosted;
      try {
        expect((await svc(U.lead, (tx, p) => IM.importContext(tx, p, SAHM)))!.assistant, hosted).toBe(false);
        await expect(svc(U.lead, (tx, p) => IM.draftFromText(tx, p, SAHM, TEXT)), hosted).rejects.toThrow(REFUSED);
      } finally {
        delete process.env.LLM_PROVIDER;
      }
    }
    expect(sent).toEqual([]);
    // The local model (the default): offered.
    expect((await svc(U.lead, (tx, p) => IM.importContext(tx, p, SAHM)))!.assistant).toBe(true);
    process.env.LLM_PROVIDER = "ollama";
    try {
      expect((await svc(U.lead, (tx, p) => IM.importContext(tx, p, SAHM)))!.assistant).toBe(true);
    } finally {
      delete process.env.LLM_PROVIDER;
    }
  });

  it("never handles people, still masks the names it knows as a second line, and never adds a position", async () => {
    process.env.AI_MASKING = "on";
    try {
      sent.length = 0;
      await truncateAuditLog(owner);
      answer.fn = (masked) => {
        const dept = masked.match(/\[DEPT_\d+\]/)?.[0] ?? "Finance";
        const people = [...new Set([...masked.matchAll(/\[PERSON_\d+\]/g)].map((m) => m[0]))];
        return {
          units: [{ ref: "U1", parent: "", code: "", name: `${dept} department`, kind: "department" }],
          positions: [
            // A model that answers with people anyway: none of them is kept.
            { ref: "P1", unit: "U1", code: "", title: `${dept} Manager`, reports_to: "", head: true, holder: people[0] ?? "", specialties: [] },
            { ref: "P2", unit: "U1", code: "", title: "Accountant", reports_to: "P1", head: false, holder: people[1] ?? "", specialties: [] },
            // Not in the text: never added.
            { ref: "P3", unit: "U1", code: "", title: "Chief Risk Officer", reports_to: "P1", head: false, specialties: [] },
            { ref: "P4", unit: "", code: "", title: "المدير المالي", reports_to: "", head: false, holder: "Khalid Al-Otaibi", specialties: [] },
          ],
        };
      };
      // Committed: it writes nothing but its audit record.
      const draft = await svc(U.lead, (tx, p) => IM.draftFromText(tx, p, SAHM, TEXT), true);

      // What reached the (local) model: no name Selah knows (the client, the firm, a person with an
      // account, a name typed into the structure, a department), no e-mail and no phone number.
      expect(sent).toHaveLength(1);
      for (const name of ["Sahm", "سهم", "Mizan", "Nawaf", "Qasimi", "Reem", "Harbi", "reem.h@example.test", "0551234567", "Finance"]) expect(sent[0]).not.toContain(name);
      expect(sent[0]).toContain("المدير المالي");

      // Titles came back unmasked; no person did; the position the text never named was left out and listed.
      const byTitle = Object.fromEntries(draft.rows.filter((r) => r.values.positionCode).map((r) => [r.values.titleEn ?? r.values.titleAr, r.values]));
      expect(Object.keys(byTitle).sort()).toEqual(["Accountant", "Finance Manager", "المدير المالي"].sort());
      expect(byTitle["Finance Manager"]).toMatchObject({ head: "yes" });
      expect(byTitle["Accountant"]).toMatchObject({ reportsTo: byTitle["Finance Manager"]!.positionCode });
      expect(draft.rows.filter((r) => r.values.holder)).toEqual([]);
      expect(JSON.stringify(draft.rows)).not.toMatch(/Nawaf|Reem|Khalid/);
      expect(byTitle["المدير المالي"]!.unitCode).toBeUndefined();
      expect(draft.rows.find((r) => r.values.unitNameEn)!.values.unitNameEn).toBe("Finance department");
      expect(draft.dropped).toEqual([{ kind: "position", text: "Chief Risk Officer" }]);
      // The audit record says what happened, never the text.
      const [entry] = (await q(`SELECT meta FROM audit_log WHERE action = 'org_chart.import_draft'`)).rows;
      expect(entry.meta).toMatchObject({ dropped: 1, model: "fake" });
      expect(entry.meta.masked).toBeGreaterThan(4);
      expect(JSON.stringify(entry.meta)).not.toMatch(/Nawaf|Accountant/);

      // The rows land in the same review step: saved like any import, once the position with no unit is placed.
      const rows = draft.rows.map((r) => ({ line: r.line, values: r.values.titleAr === "المدير المالي" ? { ...r.values, unitCode: "2.1" } : r.values }));
      const saved = await svc(U.lead, (tx, p) => IM.saveImport(tx, p, SAHM, { token: draft.token, rows, mode: "add" }));
      expect(saved.counts.positionsAdded).toBe(3);
    } finally {
      delete process.env.AI_MASKING;
    }
  });

  it("checks the length after masking, and says how much shorter the text must be", async () => {
    process.env.AI_MASKING = "on";
    try {
      sent.length = 0;
      // Under 20,000 characters as pasted, over once each city becomes a placeholder ("جدة" is "[PLACE_1]").
      const branches = "مدير فرع جدة\n".repeat(1500);
      expect(branches.trim().length).toBeLessThan(20_000);
      const refused = await svc(U.lead, (tx, p) => IM.draftFromText(tx, p, SAHM, branches)).catch((e: Error) => e.message);
      expect(refused).toMatch(/^text too long: \d+$/);
      expect(Number(/(\d+)$/.exec(refused as string)![1])).toBeGreaterThan(0);
      // Over the limit as pasted: by exactly how much.
      await expect(svc(U.lead, (tx, p) => IM.draftFromText(tx, p, SAHM, "x".repeat(20_005)))).rejects.toThrow(/^text too long: 5$/);
      expect(sent).toEqual([]);
    } finally {
      delete process.env.AI_MASKING;
    }
  });

  it("is off where the assistant is off: a client with no project the reader can ask about", async () => {
    const view = await svc(U.admin, (tx, p) => IM.importContext(tx, p, NOPROJ));
    expect(view).not.toBeNull();
    expect(view!.assistant).toBe(false);
    expect((await svc(U.admin, (tx, p) => IM.importContext(tx, p, SAHM)))!.assistant).toBe(true);
    sent.length = 0;
    await expect(svc(U.admin, (tx, p) => IM.draftFromText(tx, p, NOPROJ, "Accountant"))).rejects.toThrow(REFUSED);
    expect(sent).toEqual([]);
  });
});
