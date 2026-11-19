// The organisation structure, part 5 (migration 0105): publishing (who, the
// draft id, the day it takes effect, the people planned for the draft placed
// from that day after a second check, the people on positions the new
// version drops), the client's suggestions and the firm's answer, the
// department-head suggestion (which never changes access on its own), and
// "your manager" with the names rule. Allow and deny for each, through the
// services and straight in the database.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { firmToday } from "@/lib/dates";
import { orgChartError } from "@/lib/org-chart";
import * as AC from "@/services/accounts";
import * as OC from "@/services/org-chart";
import { loadPrincipal } from "@/services/principal";
import { today as firmDay } from "@/services/today";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

vi.setConfig({ hookTimeout: 60_000, testTimeout: 30_000 });

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-0c5b-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const SAHM = id(2); // full, departments on: the chart under test
const OTHER = id(3); // another client of the firm, with a draft of its own
const P = id(6);
const P_OTHER = id(7);
const FIN = id(10); // Sahm's Finance department
const HR = id(11); // Sahm's HR department: the Finance manager is not in it
const U = {
  admin: id(21), // firm admin
  lead: id(22), // Sahm's and Other's lead
  deputy: id(23), // Sahm's deputy
  cons: id(24), // staffed on Sahm's project: edits the draft, never publishes
  obs: id(25), // observer on Sahm's project
  cadmin: id(26), // Sahm's admin
  mgr: id(27), // Sahm manager in Finance
  fhead: id(28), // Sahm manager, Finance's head in Selah
  outsider: id(29), // Sahm manager in no department: placed in the Finance head position
  owner: id(30), // Sahm action owner, placed as the accountant
  newbie: id(31), // Sahm manager, planned for the treasurer position
  leaver: id(32), // Sahm manager, planned, then no longer one of Sahm's people
  oadmin: id(33), // Other's admin
  quitter: id(34), // Sahm manager: in the Finance head position, the holding ends today
  goner: id(35), // Sahm manager: in the Finance head position, then switched off
  suggester: id(36), // Sahm's second admin: suggests a change, then is switched off
};
const NAMES: Record<keyof typeof U, string> = {
  admin: "Huda Firm-Admin",
  lead: "Majed Lead",
  deputy: "Deputy Person",
  cons: "Staffed Person",
  obs: "Observer Person",
  cadmin: "Sahm Admin",
  mgr: "Finance Manager",
  fhead: "Finance Head",
  outsider: "Nawaf Outsider",
  owner: "Owner Person",
  newbie: "Newbie Person",
  leaver: "Leaver Person",
  oadmin: "Other Admin",
  quitter: "Quitter Person",
  goner: "Goner Person",
  suggester: "Second Admin",
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

/** A day counted from the firm's today. */
function plus(n: number) {
  const d = new Date(`${firmToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const draftId = async (client = SAHM) => (await svc(U.lead, (tx, p) => OC.getDraft(tx, p, client))).draft!.id;
/** A position of the client's draft, or of its current version, by code. */
const draftPosition = async (code: string) => (await svc(U.lead, (tx, p) => OC.getDraft(tx, p, SAHM))).positions.find((x) => x.code === code)!;
const livePosition = async (code: string) => (await svc(U.lead, (tx, p) => OC.getPublishedChart(tx, p, SAHM))).positions.find((x) => x.code === code)!;
/** Plan someone for a position of the draft, as the lead (the import's way: part 4). */
const plan = (positionId: string, who: { userId?: string; name?: string }, sort = 0) =>
  as(
    U.lead,
    (c) =>
      c.query(`INSERT INTO org_chart_planned_holders (org_id, position_id, user_id, name, sort_order, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [
        SAHM,
        positionId,
        who.userId ?? null,
        who.name ?? null,
        sort,
        U.lead,
      ]),
    true,
  );
const plansLeft = async () => Number((await q(`SELECT count(*)::int AS n FROM org_chart_planned_holders WHERE org_id = $1`, [SAHM])).rows[0].n);
const holdingsOf = async (lineage: string) =>
  (await q(`SELECT user_id, name, from_date::text AS from_date, to_date::text AS to_date FROM position_holders WHERE position_lineage_id = $1 ORDER BY from_date`, [lineage])).rows as {
    user_id: string | null;
    name: string | null;
    from_date: string;
    to_date: string | null;
  }[];

const pos: Record<string, string> = {};

beforeAll(async () => {
  await q(`TRUNCATE "user", organizations CASCADE`);
  await truncateAuditLog(owner);
  await q(
    `INSERT INTO organizations (id, kind, name, name_ar, engagement_mode, departments_enabled) VALUES
      ($1,'firm','Mizan Advisory','ميزان للاستشارات',NULL,false), ($2,'client','Sahm Trading','شركة سهم للتجارة','full',true), ($3,'client','Other Client',NULL,'full',false)`,
    [FIRM, SAHM, OTHER],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [k, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, NAMES[k as keyof typeof U], `${k}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$14,'firm_admin'), ($2,$14,'consultant'), ($3,$14,'consultant'), ($4,$14,'consultant'), ($5,$14,'consultant'),
      ($6,$15,'client_admin'), ($7,$15,'client_manager'), ($8,$15,'client_manager'), ($9,$15,'client_manager'), ($10,$15,'action_owner'),
      ($11,$15,'client_manager'), ($12,$15,'client_manager'), ($13,$16,'client_admin')`,
    [U.admin, U.lead, U.deputy, U.cons, U.obs, U.cadmin, U.mgr, U.fhead, U.outsider, U.owner, U.newbie, U.leaver, U.oadmin, FIRM, SAHM, OTHER],
  );
  await q(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$4,'client_manager'), ($2,$4,'client_manager'), ($3,$4,'client_admin')`, [
    U.quitter,
    U.goner,
    U.suggester,
    SAHM,
  ]);
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$2,$5,'Sahm governance','active',$6), ($3,'client',$4,$5,'Other governance','active',$6)`,
    [P, SAHM, P_OTHER, OTHER, FIRM, U.admin],
  );
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES
      ($1,$2,true,false), ($1,$3,false,true), ($1,$4,false,false), ($1,$5,false,false), ($6,$2,true,false)`,
    [SAHM, U.lead, U.deputy, U.cons, U.obs, OTHER],
  );
  await q(`INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,false), ($1,$3,true)`, [P, U.cons, U.obs]);
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$3,'المالية','Finance'), ($2,$3,'الموارد البشرية','HR')`, [FIN, HR, SAHM]);
  await q(`INSERT INTO department_members (department_id, user_id, is_head) VALUES ($1,$2,false), ($1,$3,true)`, [FIN, U.mgr, U.fhead]);

  // Sahm's first draft: the board, the chief executive, Finance (linked to the department) with its head, an accountant and a clerk.
  await svc(U.lead, (tx, p) => OC.startChart(tx, p, SAHM), true);
  const unit: Record<string, string> = {};
  for (const [key, parent, input] of [
    ["board", null, { kind: "board", code: "1", nameAr: "مجلس الإدارة", nameEn: "Board" }],
    ["ceo", "board", { kind: "executive", code: "2", nameAr: "الرئيس التنفيذي", nameEn: "Chief executive" }],
    ["fin", "ceo", { kind: "department", code: "2.1", nameAr: "الإدارة المالية", nameEn: "Finance", departmentId: FIN }],
  ] as const) {
    unit[key] = (await svc(U.lead, (tx, p) => OC.addUnit(tx, p, SAHM, { ...input, parentId: parent ? unit[parent] : null }), true)).id;
  }
  for (const [key, u, reports, input] of [
    ["chair", "board", null, { code: "1.1", titleAr: "رئيس المجلس", titleEn: "Chair", isHead: true }],
    ["ceo", "ceo", "chair", { code: "2.0.1", titleAr: "الرئيس التنفيذي", titleEn: "CEO", isHead: true }],
    ["cfo", "fin", "ceo", { code: "2.1.1", titleAr: "المدير المالي", titleEn: "CFO", isHead: true }],
    ["accountant", "fin", "cfo", { code: "2.1.2", titleAr: "محاسب", titleEn: "Accountant" }],
    ["clerk", "fin", "cfo", { code: "2.1.3", titleAr: "كاتب", titleEn: "Clerk" }],
    ["treasurer", "fin", "cfo", { code: "2.1.4", titleAr: "أمين صندوق", titleEn: "Treasurer" }],
  ] as const) {
    pos[key] = (await svc(U.lead, (tx, p) => OC.addPosition(tx, p, unit[u]!, { ...input, reportsToId: reports ? pos[reports] : null }), true)).id;
  }
  // Other has a draft of its own (its id must never publish Sahm's).
  await svc(U.lead, (tx, p) => OC.startChart(tx, p, OTHER), true);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("who publishes", () => {
  it("only the firm admin, the lead and the deputy: anyone else, the screen and the call are a 404", async () => {
    for (const who of [U.admin, U.lead, U.deputy]) {
      const preview = await svc(who, (tx, p) => OC.publishPreview(tx, p, SAHM));
      expect(preview.draftId, who).toBe(await draftId());
      expect(preview.current).toBeNull();
      expect(preview.nextNumber).toBe(1);
    }
    for (const who of [U.cons, U.obs, U.cadmin, U.mgr, U.owner, U.oadmin]) {
      await expect(svc(who, (tx, p) => OC.publishPreview(tx, p, SAHM)), who).rejects.toThrow(REFUSED);
      await expect(svc(who, (tx, p) => OC.publish(tx, p, SAHM, { draftId: id(999), effectiveOn: firmToday() })), who).rejects.toThrow(REFUSED);
    }
    // Straight in the database: a staffed consultant edits the draft but never publishes it.
    const chart = (await q(`SELECT id FROM org_charts WHERE org_id = $1`, [SAHM])).rows[0].id as string;
    const draft = await draftId();
    await expect(as(U.cons, (c) => c.query(`SELECT app_publish_org_chart($1, $2, $3::date, NULL)`, [chart, draft, firmToday()]))).rejects.toThrow(/no such structure/);
    await expect(as(U.cadmin, (c) => c.query(`SELECT app_publish_org_chart($1, $2, $3::date, NULL)`, [chart, draft, firmToday()]))).rejects.toThrow(/no such structure/);
  });

  it("names the draft the publisher checked: another client's draft, an unknown id or a malformed one is refused, and nothing is published", async () => {
    const other = await draftId(OTHER);
    for (const wrong of [other, id(998)]) {
      const err = await svc(U.lead, (tx, p) => OC.publish(tx, p, SAHM, { draftId: wrong, effectiveOn: firmToday() })).catch((e: Error) => e);
      expect(orgChartError((err as Error).message)).toBe("draftChanged");
    }
    await expect(svc(U.lead, (tx, p) => OC.publish(tx, p, SAHM, { draftId: "nope", effectiveOn: firmToday() }))).rejects.toThrow(/draft_id/);
    const draft = await draftId();
    await expect(svc(U.lead, (tx, p) => OC.publish(tx, p, SAHM, { draftId: draft, effectiveOn: "2027-13-40" }))).rejects.toThrow(/date/);
    expect((await q(`SELECT count(*)::int AS n FROM org_chart_versions WHERE org_id = $1 AND state <> 'draft'`, [SAHM])).rows[0].n).toBe(0);
  });

  it("refuses a board resolution the client cannot see or the publisher cannot open", async () => {
    const draft = await draftId();
    await expect(svc(U.lead, (tx, p) => OC.publish(tx, p, SAHM, { draftId: draft, effectiveOn: firmToday(), resolutionDocumentId: id(997) }))).rejects.toThrow(/resolution/);
  });
});

describe("publishing places the people planned for the draft", () => {
  it("lists what will happen before anything is published: placed from the day it takes effect, or skipped and why", async () => {
    await plan(pos.chair!, { name: "Reem Typed" });
    await plan(pos.treasurer!, { userId: U.newbie });
    await plan(pos.clerk!, { userId: U.leaver });
    // The leaver moved to another client (one membership a person: review S4). Switching an account off removes its plans
    // altogether (migration 0100, tested with the imports); this is the second check publishing makes.
    await q(`UPDATE org_memberships SET org_id = $1, role = 'action_owner' WHERE user_id = $2`, [OTHER, U.leaver]);
    const preview = await svc(U.lead, (tx, p) => OC.publishPreview(tx, p, SAHM, plus(3)));
    expect(preview.effectiveOn).toBe(plus(3));
    expect(preview.plans.map((x) => [x.code, x.name, x.outcome])).toEqual([
      ["1.1", "Reem Typed", "place"],
      ["2.1.3", "Leaver Person", "left"],
      ["2.1.4", "Newbie Person", "place"],
    ]);
    expect(preview.changes.units.added.map((u) => u.code)).toEqual(["1", "2", "2.1"]);
    expect(preview.changes.positions.added).toHaveLength(6);
    expect(preview.dropped).toEqual([]);
    // Nobody else reads the plans' outcomes: the database gives them nothing.
    for (const who of [U.cadmin, U.mgr, U.obs]) {
      const { rows } = await as(who, (c) => c.query(`SELECT * FROM app_org_chart_plan_outcomes($1, $2::date)`, [preview.draftId, plus(3)]));
      expect(rows, who).toEqual([]);
    }
  });

  it("places them from the effective day, skips the one who left, clears every plan and tells the deputy", async () => {
    await truncateAuditLog(owner);
    await q(`DELETE FROM notifications`);
    const done = await svc(U.lead, async (tx, p) => OC.publish(tx, p, SAHM, { draftId: await draftId(), effectiveOn: plus(3) }), true);
    expect(done.number).toBe(1);
    expect(done.placed.map((x) => x.name).sort()).toEqual(["Newbie Person", "Reem Typed"]);
    expect(done.skipped.map((x) => [x.name, x.outcome])).toEqual([["Leaver Person", "left"]]);
    expect(await holdingsOf(pos.chair!)).toEqual([{ user_id: null, name: "Reem Typed", from_date: plus(3), to_date: null }]);
    expect(await holdingsOf(pos.treasurer!)).toEqual([{ user_id: U.newbie, name: null, from_date: plus(3), to_date: null }]);
    expect(await holdingsOf(pos.clerk!)).toEqual([]);
    // No plan is left anywhere: not on the published version, not carried to the next draft.
    expect(await plansLeft()).toBe(0);
    // The lead published; the deputy is told that who holds positions changed (no name in it).
    const told = (await q(`SELECT user_id, kind FROM notifications WHERE kind = 'org_chart.holder_changed'`)).rows;
    expect(told).toEqual([{ user_id: U.deputy, kind: "org_chart.holder_changed" }]);
    const audit = (await q(`SELECT meta FROM audit_log WHERE action = 'org_chart.plan'`)).rows.map((r) => r.meta);
    expect(audit).toEqual([expect.objectContaining({ published: true, placed: 2, skipped: 1 })]);
    expect(JSON.stringify(audit)).not.toMatch(/Reem|Newbie|Leaver/);
    // The client reads its structure: nobody yet today; the treasurer from the effective day.
    const live = await svc(U.cadmin, (tx, p) => OC.getPublishedChart(tx, p, SAHM, plus(3)));
    expect(live.positions.find((x) => x.code === "2.1.4")!.holders.map((h) => h.name)).toEqual(["Newbie Person"]);
  });

  it("skips someone planned for a position they already hold", async () => {
    const treasurer = await draftPosition("2.1.4");
    await plan(treasurer.id, { userId: U.newbie });
    const preview = await svc(U.lead, (tx, p) => OC.publishPreview(tx, p, SAHM, plus(3)));
    expect(preview.plans.map((x) => [x.code, x.outcome])).toEqual([["2.1.4", "holds"]]);
    // Cleared without publishing (rolled back below): the plan of a position that is already filled stays a plan until then.
    await as(U.lead, (c) => c.query(`DELETE FROM org_chart_planned_holders WHERE position_id = $1`, [treasurer.id]), true);
  });
});

describe("the day a new version takes effect", () => {
  it("is on or after the day the current one did, by the service and in the database", async () => {
    const err = await svc(U.lead, async (tx, p) => OC.publish(tx, p, SAHM, { draftId: await draftId(), effectiveOn: plus(2) })).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/effective_before/);
    const chart = (await q(`SELECT id FROM org_charts WHERE org_id = $1`, [SAHM])).rows[0].id as string;
    const draft = await draftId();
    await expect(as(U.lead, (c) => c.query(`SELECT app_publish_org_chart($1, $2, $3::date, NULL)`, [chart, draft, plus(2)]))).rejects.toThrow(/on or after the day the current one did/);
    expect(orgChartError("a new version takes effect on or after the day the current one did")).toBe("effective_before");
    // The same day is fine (rolled back).
    await as(U.lead, (c) => c.query(`SELECT app_publish_org_chart($1, $2, $3::date, NULL)`, [chart, draft, plus(3)]));
  });

  // Review B1 (19 Nov): a back-dated version deleted holdings of the positions it dropped, current and past.
  it("is never in the past, even for a first version; and publishing never deletes a holding that has started, it only ends it", async () => {
    const otherDraft = async () => (await svc(U.lead, (tx, p) => OC.getDraft(tx, p, OTHER))).draft!.id;
    const board = (await svc(U.lead, (tx, p) => OC.addUnit(tx, p, OTHER, { kind: "board", code: "1", nameEn: "Board" }), true)).id;
    await svc(U.lead, (tx, p) => OC.addPosition(tx, p, board, { code: "1.1", titleEn: "Chair", isHead: true }), true);
    await svc(U.lead, (tx, p) => OC.addPosition(tx, p, board, { code: "1.2", titleEn: "Clerk" }), true);
    const err = await svc(U.lead, async (tx, p) => OC.publish(tx, p, OTHER, { draftId: await otherDraft(), effectiveOn: plus(-1) })).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/effective_before/);
    const chart = (await q(`SELECT id FROM org_charts WHERE org_id = $1`, [OTHER])).rows[0].id as string;
    const first = await otherDraft();
    await expect(as(U.lead, (c) => c.query(`SELECT app_publish_org_chart($1, $2, $3::date, NULL)`, [chart, first, plus(-1)]))).rejects.toThrow(/today or later/);
    // The earliest day offered is today for a first version.
    expect((await svc(U.lead, (tx, p) => OC.publishPreview(tx, p, OTHER, plus(-5)))).earliest).toBe(firmToday());
    await svc(U.lead, (tx, p) => OC.publish(tx, p, OTHER, { draftId: first, effectiveOn: firmToday() }), true);

    // Other's admin places a clerk from today (in post) and another from tomorrow (not started).
    const clerk = (await svc(U.oadmin, (tx, p) => OC.getPublishedChart(tx, p, OTHER))).positions.find((x) => x.code === "1.2")!;
    await svc(U.oadmin, (tx, p) => OC.changeHolder(tx, p, clerk.id, { start: { name: "Clerk Today", from: firmToday() } }), true);
    await svc(U.oadmin, (tx, p) => OC.changeHolder(tx, p, clerk.id, { start: { name: "Clerk Tomorrow", from: plus(1) } }), true);
    // The firm drops the clerk and publishes version 2, in effect today.
    const d = await svc(U.lead, (tx, p) => OC.getDraft(tx, p, OTHER));
    await svc(U.lead, (tx, p) => OC.deletePosition(tx, p, d.positions.find((x) => x.code === "1.2")!.id), true);
    const preview = await svc(U.lead, (tx, p) => OC.publishPreview(tx, p, OTHER, firmToday()));
    expect(preview.dropped.map((h) => [h.name, h.endsOn, h.cancelled])).toEqual([
      ["Clerk Today", firmToday(), false],
      ["Clerk Tomorrow", null, true],
    ]);
    await svc(U.lead, async (tx, p) => OC.publish(tx, p, OTHER, { draftId: await otherDraft(), effectiveOn: firmToday() }), true);
    // The one in post is kept, ended today; only the one who had not started is cancelled.
    expect(await holdingsOf(clerk.lineageId)).toEqual([{ user_id: null, name: "Clerk Today", from_date: firmToday(), to_date: firmToday() }]);
  });
});

describe("people on positions the new version drops", () => {
  it("are listed before publishing; then a holding that started ends the day before, one not started is cancelled", async () => {
    // The client's admin places people on the live clerk position: one now, one from a later day.
    const clerk = await livePosition("2.1.3");
    await svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, clerk.id, { start: { name: "Clerk Now", from: plus(-30) } }), true);
    await svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, clerk.id, { start: { name: "Clerk Later", from: plus(40) } }), true);
    // The firm drops the clerk, adds a Treasury unit, moves the accountant there and renames the CFO.
    const d = await svc(U.lead, (tx, p) => OC.getDraft(tx, p, SAHM));
    const draftClerk = d.positions.find((x) => x.code === "2.1.3")!;
    const fin = d.units.find((u) => u.code === "2.1")!;
    await svc(
      U.lead,
      async (tx, p) => {
        await OC.deletePosition(tx, p, draftClerk.id);
        const treasury = await OC.addUnit(tx, p, SAHM, { kind: "section", code: "2.1.9", nameAr: "الخزينة", nameEn: "Treasury", parentId: fin.id });
        await OC.movePosition(tx, p, d.positions.find((x) => x.code === "2.1.2")!.id, { unitId: treasury.id });
        await OC.updatePosition(tx, p, d.positions.find((x) => x.code === "2.1.1")!.id, { titleEn: "Chief financial officer" });
      },
      true,
    );
    const preview = await svc(U.lead, (tx, p) => OC.publishPreview(tx, p, SAHM, plus(5)));
    expect(preview.current?.number).toBe(1);
    expect(preview.nextNumber).toBe(2);
    expect(preview.changes.units.added.map((u) => u.code)).toEqual(["2.1.9"]);
    expect(preview.changes.units.removed).toEqual([]);
    expect(preview.changes.units.moved).toEqual([]);
    expect(preview.changes.positions.removed.map((x) => x.code)).toEqual(["2.1.3"]);
    expect(preview.changes.positions.moved.map((x) => [x.position.code, x.from?.code, x.to?.code])).toEqual([["2.1.2", "2.1", "2.1.9"]]);
    expect(preview.changes.positions.renamed.map((x) => x.position.code)).toEqual(["2.1.1"]);
    expect(preview.dropped).toEqual([
      { code: "2.1.3", titleAr: "كاتب", titleEn: "Clerk", name: "Clerk Now", endsOn: plus(4), cancelled: false },
      { code: "2.1.3", titleAr: "كاتب", titleEn: "Clerk", name: "Clerk Later", endsOn: null, cancelled: true },
    ]);
    await svc(U.deputy, async (tx, p) => OC.publish(tx, p, SAHM, { draftId: await draftId(), effectiveOn: plus(5) }), true);
    expect(await holdingsOf(clerk.lineageId)).toEqual([{ user_id: null, name: "Clerk Now", from_date: plus(-30), to_date: plus(4) }]);
    // Version 1 stays readable after version 2, with its clerk.
    const history = await svc(U.cadmin, (tx, p) => OC.listVersions(tx, p, SAHM));
    expect(history.map((v) => [v.number, v.state])).toEqual([
      [2, "published"],
      [1, "superseded"],
    ]);
    const v1 = await svc(U.cadmin, (tx, p) => OC.getVersion(tx, p, history[1]!.id));
    expect(v1.positions.map((x) => x.code)).toContain("2.1.3");
  });
});

// Review S1 (19 Nov): publishing put a second person in a one-person position. It now follows changeHolder().
describe("a planned person taking over a one-person position", () => {
  it("ends the current holder the day before, lists who leaves and who takes it, and skips a position someone takes later", async () => {
    // The CEO's one-person position: someone is already due to take it after the new version's day.
    const ceo = await livePosition("2.0.1");
    await svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, ceo.id, { start: { name: "Future Ceo", from: plus(10) } }), true);
    await plan((await draftPosition("2.1.4")).id, { name: "Bob Typed" });
    await plan((await draftPosition("2.0.1")).id, { name: "Planned Ceo" });
    const preview = await svc(U.lead, (tx, p) => OC.publishPreview(tx, p, SAHM, plus(6)));
    expect(preview.plans.map((x) => [x.code, x.name, x.outcome, x.leaving])).toEqual([
      ["2.0.1", "Planned Ceo", "filled", []],
      ["2.1.4", "Bob Typed", "place", ["Newbie Person"]],
    ]);
    const done = await svc(U.lead, async (tx, p) => OC.publish(tx, p, SAHM, { draftId: await draftId(), effectiveOn: plus(6) }), true);
    expect(done.placed.map((x) => x.name)).toEqual(["Bob Typed"]);
    expect(done.skipped.map((x) => [x.name, x.outcome])).toEqual([["Planned Ceo", "filled"]]);
    const treasurer = await livePosition("2.1.4");
    expect(await holdingsOf(treasurer.lineageId)).toEqual([
      { user_id: U.newbie, name: null, from_date: plus(3), to_date: plus(5) },
      { user_id: null, name: "Bob Typed", from_date: plus(6), to_date: null },
    ]);
    expect((await holdingsOf(ceo.lineageId)).map((h) => h.name)).toEqual(["Future Ceo"]);
  });
});

describe("suggestions from the client", () => {
  let requestId = "";

  it("only the client's admin suggests; it waits on the lead's and the deputy's home, nobody else's", async () => {
    for (const who of [U.mgr, U.owner, U.lead, U.oadmin]) {
      await expect(svc(who, (tx, p) => OC.suggestChange(tx, p, SAHM, { what: "A new procurement section" })), who).rejects.toThrow(REFUSED);
    }
    requestId = (await svc(U.cadmin, (tx, p) => OC.suggestChange(tx, p, SAHM, { what: "A new procurement section", where: "Finance", why: "Purchasing grew" }), true)).id;
    for (const who of [U.lead, U.deputy]) {
      const home = await svc(who, (tx, p) => firmDay(tx, p));
      const row = home.decisions.find((r) => r.kind === "org_chart_request");
      expect(row, who).toMatchObject({ id: requestId, title: "A new procurement section", who: "Sahm Admin", href: `/clients/${SAHM}/structure#suggestions` });
    }
    for (const who of [U.cons, U.obs, U.admin]) {
      const home = await svc(who, (tx, p) => firmDay(tx, p));
      expect(home.decisions.some((r) => r.kind === "org_chart_request"), who).toBe(false);
    }
  });

  it("the firm's editors mark it done or declined, once; the admin gets a plain notice back and it leaves the home", async () => {
    await q(`DELETE FROM notifications`);
    for (const who of [U.obs, U.cadmin, U.mgr, U.oadmin]) {
      await expect(svc(who, (tx, p) => OC.closeChangeRequest(tx, p, requestId, "done")), who).rejects.toThrow(REFUSED);
    }
    await svc(U.cons, (tx, p) => OC.closeChangeRequest(tx, p, requestId, "done"), true);
    await expect(svc(U.lead, (tx, p) => OC.closeChangeRequest(tx, p, requestId, "declined"))).rejects.toThrow(/answered/);
    const back = (await q(`SELECT user_id, kind, entity_type, entity_id FROM notifications`)).rows;
    expect(back).toEqual([{ user_id: U.cadmin, kind: "org_chart.request_done", entity_type: "organization", entity_id: SAHM }]);
    const home = await svc(U.lead, (tx, p) => firmDay(tx, p));
    expect(home.decisions.some((r) => r.kind === "org_chart_request")).toBe(false);
    const list = await svc(U.cadmin, (tx, p) => OC.listChangeRequests(tx, p, SAHM));
    expect(list.items.map((r) => [r.what, r.status])).toEqual([["A new procurement section", "done"]]);
    expect(list.canClose).toBe(false);
  });

  it("a declined one tells the admin too", async () => {
    await q(`DELETE FROM notifications`);
    const second = (await svc(U.cadmin, (tx, p) => OC.suggestChange(tx, p, SAHM, { what: "Merge the board's committees" }), true)).id;
    await svc(U.lead, (tx, p) => OC.closeChangeRequest(tx, p, second, "declined"), true);
    expect((await q(`SELECT kind FROM notifications WHERE user_id = $1`, [U.cadmin])).rows).toEqual([{ kind: "org_chart.request_declined" }]);
  });
});

describe("the department-head suggestion", () => {
  it("shows when the head of a linked unit is not the department's head; nothing changes, and nobody gains access, until someone confirms", async () => {
    const cfo = await livePosition("2.1.1");
    await svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, cfo.id, { start: { userId: U.outsider, from: plus(-1) } }), true);
    const members = async () => (await q(`SELECT user_id, is_head FROM department_members WHERE department_id = $1 ORDER BY user_id`, [FIN])).rows;
    const before = await members();
    expect(before).toEqual([
      { user_id: U.mgr, is_head: false },
      { user_id: U.fhead, is_head: true },
    ]);
    for (const who of [U.cadmin, U.admin]) {
      const list = await svc(who, (tx, p) => OC.headSuggestions(tx, p, SAHM));
      expect(list.map((s) => [s.departmentId, s.holder.name, s.heads.map((h) => h.name)]), who).toEqual([[FIN, "Nawaf Outsider", ["Finance Head"]]]);
    }
    // Only the people who manage departments see it.
    for (const who of [U.lead, U.deputy, U.cons, U.mgr, U.outsider, U.owner, U.oadmin]) {
      expect(await svc(who, (tx, p) => OC.headSuggestions(tx, p, SAHM)), who).toEqual([]);
    }
    // The chart never grants access: in the CFO position, the outsider still sees nothing of Finance's work.
    const deptOk = () => as(U.outsider, async (c) => (await c.query(`SELECT app_dept_ok($1, $2) AS ok`, [FIN, SAHM])).rows[0].ok as boolean);
    expect(await deptOk()).toBe(false);
    expect(await members()).toEqual(before);
    // Confirming is for the client's admin or the firm admin only.
    for (const who of [U.lead, U.cons, U.mgr, U.outsider]) {
      await expect(svc(who, (tx, p) => OC.confirmHeadSuggestion(tx, p, SAHM, { departmentId: FIN, userId: U.outsider })), who).rejects.toThrow(REFUSED);
    }
    await expect(svc(U.cadmin, (tx, p) => OC.confirmHeadSuggestion(tx, p, SAHM, { departmentId: FIN, userId: U.mgr }))).rejects.toThrow(/suggestion_gone/);
    expect(await members()).toEqual(before);
    expect(await deptOk()).toBe(false);
  });

  it("confirmed by the client's admin: the holder heads the department, the former head stays in it, and the suggestion is gone", async () => {
    await svc(U.cadmin, (tx, p) => OC.confirmHeadSuggestion(tx, p, SAHM, { departmentId: FIN, userId: U.outsider }), true);
    const rows = (await q(`SELECT user_id, is_head FROM department_members WHERE department_id = $1 ORDER BY user_id`, [FIN])).rows;
    expect(rows).toEqual([
      { user_id: U.mgr, is_head: false },
      { user_id: U.fhead, is_head: false },
      { user_id: U.outsider, is_head: true },
    ]);
    expect(await svc(U.cadmin, (tx, p) => OC.headSuggestions(tx, p, SAHM))).toEqual([]);
    expect((await q(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'org_chart.head_confirm'`)).rows[0].n).toBe(1);
  });
});

describe("your manager", () => {
  it("reads the version in effect today only: none at Sahm, whose versions all take effect later (review N4)", async () => {
    const accountant = await livePosition("2.1.2");
    await svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, accountant.id, { start: { userId: U.owner, from: plus(-1) } }), true);
    expect(await svc(U.owner, (tx, p) => OC.myManager(tx, p))).toEqual([]);
    // The owner reads no structure at all.
    expect(await svc(U.owner, (tx, p) => OC.hasStructure(tx, p, SAHM))).toBe(false);
    await expect(svc(U.owner, (tx, p) => OC.getStructure(tx, p, SAHM))).rejects.toThrow(REFUSED);
    // Firm staff have no manager line.
    expect(await svc(U.lead, (tx, p) => OC.myManager(tx, p))).toEqual([]);
  });

  it("names the manager only while names are shown, from the version in effect, never one published to start later", async () => {
    // At Other (in effect since today): a secretary reporting to the chair, held by the leaver, now Other's action owner.
    const d = await svc(U.lead, (tx, p) => OC.getDraft(tx, p, OTHER));
    const chair = d.positions.find((x) => x.code === "1.1")!;
    await svc(U.lead, (tx, p) => OC.addPosition(tx, p, d.units[0]!.id, { code: "1.3", titleEn: "Secretary", reportsToId: chair.id }), true);
    await svc(U.lead, async (tx, p) => OC.publish(tx, p, OTHER, { draftId: (await OC.getDraft(tx, p, OTHER)).draft!.id, effectiveOn: firmToday() }), true);
    const live = await svc(U.oadmin, (tx, p) => OC.getPublishedChart(tx, p, OTHER));
    await svc(U.oadmin, (tx, p) => OC.changeHolder(tx, p, live.positions.find((x) => x.code === "1.1")!.id, { start: { name: "Typed Chair", from: firmToday() } }), true);
    await svc(U.oadmin, (tx, p) => OC.changeHolder(tx, p, live.positions.find((x) => x.code === "1.3")!.id, { start: { userId: U.leaver, from: firmToday() } }), true);
    const mine = () => svc(U.leaver, async (tx, p) => (await OC.myManager(tx, p)).map((m) => [m.titleEn, m.name]));
    expect(await mine()).toEqual([["Chair", null]]);
    // Only the client's admin switches names on.
    for (const who of [U.lead, U.admin, U.leaver, U.cadmin]) {
      await expect(svc(who, (tx, p) => OC.setShowNames(tx, p, live.version!.id, true)), who).rejects.toThrow(REFUSED);
    }
    await svc(U.oadmin, (tx, p) => OC.setShowNames(tx, p, live.version!.id, true), true);
    expect(await mine()).toEqual([["Chair", "Typed Chair"]]);
    // Version 4, from a later day, puts the secretary under a new chief executive: until then, "your manager" stays the chair.
    const d2 = await svc(U.lead, (tx, p) => OC.getDraft(tx, p, OTHER));
    const ceo = await svc(U.lead, (tx, p) => OC.addPosition(tx, p, d2.units[0]!.id, { code: "1.4", titleEn: "Chief executive", reportsToId: d2.positions.find((x) => x.code === "1.1")!.id }), true);
    await svc(U.lead, (tx, p) => OC.setReportsTo(tx, p, d2.positions.find((x) => x.code === "1.3")!.id, ceo.id), true);
    await svc(U.lead, async (tx, p) => OC.publish(tx, p, OTHER, { draftId: (await OC.getDraft(tx, p, OTHER)).draft!.id, effectiveOn: plus(10) }), true);
    expect(await mine()).toEqual([["Chair", "Typed Chair"]]);
    // Names off again (the current version's switch): no name.
    const current = (await svc(U.oadmin, (tx, p) => OC.getPublishedChart(tx, p, OTHER))).version!;
    await svc(U.oadmin, (tx, p) => OC.setShowNames(tx, p, current.id, false), true);
    expect(await mine()).toEqual([["Chair", null]]);
  });
});

describe("the department-head suggestion, after the people change", () => {

  // Review S2: two holders made a suggestion that undid itself on every confirmation.
  it("suggests only while the head position has exactly one holder", async () => {
    const cfo = await livePosition("2.1.1");
    const chart = (await q(`SELECT id FROM org_charts WHERE org_id = $1`, [SAHM])).rows[0].id as string;
    // A second person in the CFO position (as a two-person position would allow), written past the service.
    const second = (
      await q(`INSERT INTO position_holders (chart_id, org_id, position_lineage_id, user_id, from_date, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [
        chart,
        SAHM,
        cfo.lineageId,
        U.mgr,
        plus(-1),
        U.cadmin,
      ])
    ).rows[0].id as string;
    expect(await svc(U.cadmin, (tx, p) => OC.headSuggestions(tx, p, SAHM))).toEqual([]);
    await q(`DELETE FROM position_holders WHERE id = $1`, [second]);
  });

  // Review S3: someone who left today was still suggested, and confirming gave a database message.
  it("never suggests a holder whose term ends today or who was switched off; a refusal is said in plain words", async () => {
    const cfo = await livePosition("2.1.1");
    const holding = (who: string) => q(`SELECT id FROM position_holders WHERE position_lineage_id = $1 AND user_id = $2`, [cfo.lineageId, who]).then((r) => r.rows[0].id as string);
    const chart = (await q(`SELECT id FROM org_charts WHERE org_id = $1`, [SAHM])).rows[0].id as string;
    const put = (who: string) =>
      q(`INSERT INTO position_holders (chart_id, org_id, position_lineage_id, user_id, from_date, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [chart, SAHM, cfo.lineageId, who, plus(-1), U.cadmin]);
    const names = async () => (await svc(U.cadmin, (tx, p) => OC.headSuggestions(tx, p, SAHM))).map((s) => s.holder.name);
    // The outsider (the head) leaves the position yesterday; the quitter holds it until today.
    await svc(U.cadmin, async (tx, p) => OC.changeHolder(tx, p, cfo.id, { end: { holderId: await holding(U.outsider), on: plus(-1) } }), true);
    await put(U.quitter);
    expect(await names()).toEqual(["Quitter Person"]);
    await svc(U.cadmin, async (tx, p) => OC.changeHolder(tx, p, cfo.id, { end: { holderId: await holding(U.quitter), on: firmToday() } }), true);
    expect(await names()).toEqual([]);
    // The goner holds it, then is switched off (the leaving ends the holding today).
    await put(U.goner);
    expect(await names()).toEqual(["Goner Person"]);
    await svc(U.cadmin, (tx, p) => AC.setActive(tx, p, U.goner, { active: false, reason: "Left the company" }), true);
    expect(await names()).toEqual([]);
    const err = await svc(U.cadmin, (tx, p) => OC.confirmHeadSuggestion(tx, p, SAHM, { departmentId: FIN, userId: U.goner })).catch((e: Error) => e);
    expect(orgChartError((err as Error).message)).toBe("suggestion_gone");
    // The database's own refusal, if it ever reached the screen, is said the same way.
    expect(orgChartError("department members are active people of the client")).toBe("suggestion_gone");
  });
});

// Review S4: the rules this part promises that had no test.
describe("what the review found untested", () => {
  /** A file of Sahm's project, shared with the client, written by the schema's owner (the rules that read it are what is tested). */
  async function doc(docId: string, title: string, departmentId: string | null = null, kind: { purpose: string; state: string } = { purpose: "deliverable", state: "submitted" }) {
    await q(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, department_id,
         storage_key, content_type, size_bytes, sha256, scan_status)
       VALUES ($1,$2,$3,$3,$4,$9,$10,$5,'shared',$6,$7,'application/pdf',10,$8,'clean')`,
      [docId, P, SAHM, U.cadmin, title, departmentId, `k-${docId}`, `sha-${docId}`, kind.purpose, kind.state],
    );
  }
  const DOC_DRAFT = id(73);
  const DOC_HR = id(71);
  const DOC_ONLY = id(72);
  const resolutionFor = async (who: string) => (await svc(who, (tx, p) => OC.getStructure(tx, p, SAHM))).resolution?.title ?? null;

  it("publishing changes no department, even with a plan in a linked unit's head position", async () => {
    const members = async () => (await q(`SELECT department_id, user_id, is_head FROM department_members ORDER BY department_id, user_id`)).rows;
    const before = await members();
    await plan((await draftPosition("2.1.1")).id, { userId: U.fhead });
    await doc(DOC_HR, "Board resolution (HR)", HR);
    const done = await svc(U.lead, async (tx, p) => OC.publish(tx, p, SAHM, { draftId: await draftId(), effectiveOn: plus(7), resolutionDocumentId: DOC_HR }), true);
    expect(done.placed.map((x) => x.name)).toEqual(["Finance Head"]);
    expect(await members()).toEqual(before);
  });

  it("shows the board resolution to each reader who may open its file, and to nobody else", async () => {
    // A file of the HR department: the Finance manager may not open it; the client's admin and the firm's readers may.
    for (const who of [U.cadmin, U.lead, U.cons, U.obs, U.admin]) expect(await resolutionFor(who), who).toBe("Board resolution (HR)");
    expect(await resolutionFor(U.mgr)).toBeNull();
    // A file only the client's admin may see ("only these people", set by the admin): the manager gets nothing.
    await doc(DOC_ONLY, "Board resolution (only)");
    await q(`INSERT INTO item_audiences (org_id, item_type, item_id, mode, set_by) VALUES ($1,'document',$2,'only',$3)`, [SAHM, DOC_ONLY, U.cadmin]);
    await q(`INSERT INTO item_audience_people (item_type, item_id, user_id) VALUES ('document',$1,$2)`, [DOC_ONLY, U.cadmin]);
    await svc(U.lead, async (tx, p) => OC.publish(tx, p, SAHM, { draftId: await draftId(), effectiveOn: plus(7), resolutionDocumentId: DOC_ONLY }), true);
    expect(await resolutionFor(U.cadmin)).toBe("Board resolution (only)");
    expect(await resolutionFor(U.mgr)).toBeNull();
  });

  it("refuses a resolution the publisher may not open, though the database alone would take it", async () => {
    // Evidence the client's admin is still preparing: shared and not archived, but only its uploader opens it.
    await doc(DOC_DRAFT, "Draft evidence", null, { purpose: "evidence", state: "draft" });
    expect(await as(U.lead, async (c) => (await c.query(`SELECT 1 FROM documents WHERE id = $1`, [DOC_DRAFT])).rowCount)).toBe(0);
    const err = await svc(U.lead, async (tx, p) => OC.publish(tx, p, SAHM, { draftId: await draftId(), effectiveOn: plus(7), resolutionDocumentId: DOC_DRAFT })).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/^resolution$/);
    // The database's own check (a shared file of this client) would have let it through (rolled back).
    const chart = (await q(`SELECT id FROM org_charts WHERE org_id = $1`, [SAHM])).rows[0].id as string;
    const draft = await draftId();
    await as(U.lead, (c) => c.query(`SELECT app_publish_org_chart($1, $2, $3::date, $4)`, [chart, draft, plus(7), DOC_DRAFT]));
  });

  it("a head confirmation for another client, or by another client's admin, is a 404", async () => {
    expect(await svc(U.oadmin, (tx, p) => OC.headSuggestions(tx, p, SAHM))).toEqual([]);
    await expect(svc(U.oadmin, (tx, p) => OC.confirmHeadSuggestion(tx, p, SAHM, { departmentId: FIN, userId: U.mgr }))).rejects.toThrow(REFUSED);
    await expect(svc(U.cadmin, (tx, p) => OC.confirmHeadSuggestion(tx, p, OTHER, { departmentId: FIN, userId: U.mgr }))).rejects.toThrow(REFUSED);
  });

  it("an answer to a suggestion reaches nobody once its author is switched off", async () => {
    const asked = (await svc(U.suggester, (tx, p) => OC.suggestChange(tx, p, SAHM, { what: "Rename the board's secretariat" }), true)).id;
    await svc(U.cadmin, (tx, p) => AC.setActive(tx, p, U.suggester, { active: false, reason: "Left the company" }), true);
    expect((await q(`SELECT active FROM org_memberships WHERE user_id = $1`, [U.suggester])).rows).toEqual([{ active: false }]);
    await q(`DELETE FROM notifications`);
    await svc(U.lead, (tx, p) => OC.closeChangeRequest(tx, p, asked, "done"), true);
    expect((await q(`SELECT user_id FROM notifications WHERE kind LIKE 'org_chart.request_%'`)).rows).toEqual([]);
  });
});

describe("the review's notes", () => {
  it("refuses a publish when the draft changed after the screen showed it (N2); the answer is what the database did (N1)", async () => {
    const before = await svc(U.lead, (tx, p) => OC.publishPreview(tx, p, SAHM, plus(7)));
    expect(before.revision).toMatch(/^[0-9a-f]{32}$/);
    // Nobody but the draft's editors gets a revision.
    for (const who of [U.cadmin, U.obs]) {
      const { rows } = await as(who, (c) => c.query(`SELECT app_org_chart_draft_revision($1) AS r`, [before.draftId]));
      expect(rows[0].r, who).toBeNull();
    }
    // Someone plans a person for the draft meanwhile: the screen's revision no longer matches.
    await plan((await draftPosition("2.1.2")).id, { name: "Carl Typed" });
    const err = await svc(U.lead, (tx, p) => OC.publish(tx, p, SAHM, { draftId: before.draftId, revision: before.revision!, effectiveOn: plus(7) })).catch((e: Error) => e);
    expect(orgChartError((err as Error).message)).toBe("draftEdited");
    const fresh = await svc(U.lead, (tx, p) => OC.publishPreview(tx, p, SAHM, plus(7)));
    expect(fresh.revision).not.toBe(before.revision);
    expect(fresh.plans.map((x) => [x.name, x.outcome, x.leaving])).toEqual([["Carl Typed", "place", ["Owner Person"]]]);
    await truncateAuditLog(owner);
    const done = await svc(U.lead, (tx, p) => OC.publish(tx, p, SAHM, { draftId: fresh.draftId, revision: fresh.revision!, effectiveOn: plus(7) }), true);
    expect(done.placed.map((x) => [x.name, x.leaving])).toEqual([["Carl Typed", ["Owner Person"]]]);
    const audits = (await q(`SELECT action, meta FROM audit_log WHERE action IN ('org_chart.plan', 'org_chart.publish') ORDER BY action`)).rows;
    expect(audits.map((a) => [a.action, a.meta.placed, a.meta.skipped])).toEqual([
      ["org_chart.plan", 1, 0],
      ["org_chart.publish", 1, 0],
    ]);
  });
});
