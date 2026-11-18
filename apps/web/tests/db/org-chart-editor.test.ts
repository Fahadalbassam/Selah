// The organisation structure, part 3 (migration 0160): the outline editor's
// own calls (starting from nothing, starting again from the current version,
// moving units with their levels), holders and vacancies, removing a holding
// entered by mistake, the leaving and invite hooks, and a person's work card.
// Allow and deny for every rule, through the services and straight in the
// database.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { firmToday } from "@/lib/dates";
import { invite, personHoldings, setActive } from "@/services/accounts";
import { getEngagement, setEngagement } from "@/services/engagement";
import * as OC from "@/services/org-chart";
import { loadPrincipal } from "@/services/principal";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-0c0e-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2); // full, departments on: the chart under test
const OTHER = id(3); // another client of the firm
const FAMILY = id(4); // consultant-managed: switched to minimal records once its names are removed
const FRESH = id(5); // no structure yet
const P = id(6);
const P_OTHER = id(7);
const P_FAMILY = id(8);
const P_FRESH = id(9);
const DEPT = { fin: id(10), hr: id(11) };
const U = {
  admin: id(21), // firm admin
  lead: id(22), // the lead of Acme, Family and Fresh
  deputy: id(23), // Acme's deputy
  cons: id(24), // staffed on Acme's and Fresh's projects
  obs: id(25), // observer on Acme's project
  team: id(26), // on Acme's team, staffed on nothing
  cadmin: id(27),
  mgr: id(28), // Acme manager in Finance
  mgr2: id(29), // Acme manager in HR; holds the HR director position
  owner: id(30), // Acme action owner in Finance; holds the analyst position: the person whose card is read
  leaver: id(31), // Acme manager, holds the HR officer position, owns nothing
  leaver2: id(32), // Acme action owner, holds the clerk position, owns nothing
  next: id(33), // Acme action owner who takes over
  oadmin: id(34),
  omgr: id(35),
  fresh: id(36), // Fresh's admin
};

const REFUSED = /forbidden|row-level security|insufficient|not allowed|not found|no such/i;
const PAST = "2025-01-01";

async function as<T>(userId: string | null, fn: (c: PoolClient) => Promise<T>, commit = false): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    if (userId) await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
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

const draftIdOf = async (client: string) =>
  (await owner.query(`SELECT v.id FROM org_chart_versions v JOIN org_charts c ON c.id = v.chart_id WHERE c.org_id = $1 AND v.state = 'draft'`, [client])).rows[0]
    ?.id as string;
const publishAs = async (who: string, client: string) => {
  const draftId = await draftIdOf(client);
  return svc(who, (tx, p) => OC.publish(tx, p, client, { draftId, effectiveOn: firmToday() }), true);
};
const today = () => firmToday();
const tomorrow = () => OC.dayAfter(firmToday());

/** Acme's positions on the current version, by English title. */
const POS: Record<string, string> = {};
const UNIT: Record<string, string> = {};
let V1 = "";
/** Acme's work owned or uploaded by the action owner whose card is read. */
const ACT = { fin: id(41), late: id(42), hr: id(43), draft: id(44), done: id(45), other: id(46) };
const DOC = { fin: id(51), hr: id(52), mine: id(53), cadmin: id(54), narrow: id(55) };
const REC = { all: id(47), hr: id(48), draft: id(49) };

beforeAll(async () => {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await truncateAuditLog(owner);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode, departments_enabled) VALUES
      ($1,'firm','firm',NULL,false), ($2,'client','Acme','full',true), ($3,'client','Other','full',false),
      ($4,'client','Family','consultant_managed',false), ($5,'client','Fresh','full',false)`,
    [FIRM, ACME, OTHER, FAMILY, FRESH],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, `${name} person`, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$17,'firm_admin'), ($2,$17,'consultant'), ($3,$17,'consultant'), ($4,$17,'consultant'), ($5,$17,'consultant'), ($6,$17,'consultant'),
      ($7,$18,'client_admin'), ($8,$18,'client_manager'), ($9,$18,'client_manager'), ($10,$18,'action_owner'),
      ($11,$18,'client_manager'), ($12,$18,'action_owner'), ($13,$18,'action_owner'),
      ($14,$19,'client_admin'), ($15,$19,'client_manager'), ($16,$20,'client_admin')`,
    [U.admin, U.lead, U.deputy, U.cons, U.obs, U.team, U.cadmin, U.mgr, U.mgr2, U.owner, U.leaver, U.leaver2, U.next, U.oadmin, U.omgr, U.fresh, FIRM, ACME, OTHER, FRESH],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$2,$9,'Acme governance','active',$10), ($3,'client',$4,$9,'Other governance','active',$10),
      ($5,'client',$6,$9,'Family charter','active',$10), ($7,'client',$8,$9,'Fresh start','active',$10)`,
    [P, ACME, P_OTHER, OTHER, P_FAMILY, FAMILY, P_FRESH, FRESH, FIRM, U.admin],
  );
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES
      ($1,$2,true,false), ($1,$3,false,true), ($1,$4,false,false), ($1,$5,false,false), ($1,$6,false,false),
      ($7,$2,true,false), ($8,$2,true,false), ($8,$4,false,false)`,
    [ACME, U.lead, U.deputy, U.cons, U.obs, U.team, FAMILY, FRESH],
  );
  await q(
    `INSERT INTO project_members (project_id, user_id, observer) VALUES
      ($1,$3,false), ($1,$4,true), ($1,$5,false), ($1,$6,false), ($1,$7,false), ($1,$8,false), ($2,$9,false)`,
    [P, P_FRESH, U.cons, U.obs, U.mgr, U.mgr2, U.owner, U.next, U.cons],
  );
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$3,'المالية','Finance'), ($2,$3,'الموارد البشرية','Human resources')`, [
    DEPT.fin,
    DEPT.hr,
    ACME,
  ]);
  await q(`INSERT INTO department_members (department_id, user_id) VALUES ($1,$3), ($1,$4), ($2,$5)`, [DEPT.fin, DEPT.hr, U.mgr, U.owner, U.mgr2]);

  // The action owner's work at Acme: Finance's (one late), HR's, a firm draft, one already verified, and one of someone else.
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, department_id, created_by) VALUES
      ($1,$4,$5,'Strengthen controls','shared',NULL,$6), ($2,$4,$5,'Review HR policies','shared',$7,$6), ($3,$4,$5,'Draft idea','shared',NULL,$6)`,
    [REC.all, REC.hr, REC.draft, P, ACME, U.lead, DEPT.hr],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, department_id, created_by) VALUES
      ($1,$7,$8,$9,'Finance reconciliation',$11,'in_progress',app_firm_today() + 30,$13,$12),
      ($2,$7,$8,$9,'Late budget memo',$11,'in_progress',app_firm_today() - 10,$13,$12),
      ($3,$7,$8,$10,'HR handbook review',$11,'in_progress',app_firm_today() + 20,$14,$12),
      ($4,$7,$8,$15,'Not yet released',$11,'draft',app_firm_today() + 5,$13,$12),
      ($5,$7,$8,$9,'Already verified',$11,'verified_complete',app_firm_today() - 40,$13,$12),
      ($6,$7,$8,$9,'Someone else''s task',$16,'in_progress',app_firm_today() + 3,$13,$12)`,
    [ACT.fin, ACT.late, ACT.hr, ACT.draft, ACT.done, ACT.other, P, ACME, REC.all, REC.hr, U.owner, U.lead, DEPT.fin, DEPT.hr, REC.draft, U.next],
  );
  // The action owner's uploads: Finance's, HR's, one private to them, one Finance file the client's admin
  // narrowed to "everyone except" the Finance manager (who sees every other Finance file); and one the
  // client admin uploaded.
  for (const [doc, dept, title, by, label] of [
    [DOC.fin, DEPT.fin, "Finance procedures", U.owner, "shared"],
    [DOC.hr, DEPT.hr, "Salary scale draft", U.owner, "shared"],
    [DOC.mine, null, "My private notes", U.owner, "user_private"],
    [DOC.cadmin, null, "Company policy", U.cadmin, "shared"],
    [DOC.narrow, DEPT.fin, "Finance restructuring note", U.owner, "shared"],
  ] as const) {
    await q(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, department_id, storage_key, content_type, size_bytes, sha256, scan_status)
       VALUES ($1,$2,$3,$3,$4,'client_document','submitted',$5,$6,$7,$8,'application/pdf',1,'s','clean')`,
      [doc, P, ACME, by, title, label, dept, `k-${doc}`],
    );
  }
  // Who sees an item (feature A): the narrowed file keeps the Finance manager out.
  await q(`INSERT INTO item_audiences (org_id, item_type, item_id, mode, set_by) VALUES ($1,'document',$2,'except',$3)`, [ACME, DOC.narrow, U.cadmin]);
  await q(`INSERT INTO item_audience_people (item_type, item_id, user_id) VALUES ('document',$1,$2)`, [DOC.narrow, U.mgr]);

  // Acme's structure: the lead builds it and publishes it; the client's admin puts the people in.
  await svc(U.lead, (tx, p) => OC.startChart(tx, p, ACME), true);
  const unit = async (key: string, input: OC.UnitInput, parent?: string) => {
    UNIT[key] = (await svc(U.lead, (tx, p) => OC.addUnit(tx, p, ACME, { ...input, parentId: parent ? UNIT[parent] : null }), true)).id;
  };
  await unit("board", { kind: "board", nameEn: "Board" });
  await unit("ceo", { kind: "executive", nameEn: "Chief executive" }, "board");
  await unit("fin", { kind: "department", nameEn: "Finance", departmentId: DEPT.fin }, "ceo");
  await unit("hr", { kind: "department", nameEn: "Human resources", departmentId: DEPT.hr }, "ceo");
  const position = async (key: string, unitKey: string, input: OC.PositionInput) => {
    POS[key] = (await svc(U.lead, (tx, p) => OC.addPosition(tx, p, UNIT[unitKey]!, input), true)).id;
  };
  await position("chair", "board", { titleEn: "Chair", isHead: true });
  await position("ceo", "ceo", { titleEn: "CEO", isHead: true, reportsToId: POS.chair });
  await position("cfo", "fin", { titleEn: "CFO", isHead: true, reportsToId: POS.ceo });
  await position("analyst", "fin", { titleEn: "Analyst", reportsToId: POS.cfo });
  await position("clerk", "fin", { titleEn: "Clerk", reportsToId: POS.cfo });
  await position("hrd", "hr", { titleEn: "HR director", isHead: true, reportsToId: POS.ceo });
  await position("hro", "hr", { titleEn: "HR officer", reportsToId: POS.hrd });
  await position("recruiter", "hr", { titleEn: "Recruiter", reportsToId: POS.hrd, plannedCount: 2 });
  await position("counsel", "ceo", { titleEn: "Legal counsel", reportsToId: POS.ceo });
  V1 = (await publishAs(U.lead, ACME)).versionId;
  const hold = (key: string, start: OC.HolderChange["start"]) => svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, POS[key]!, { start }), true);
  await hold("chair", { name: "Hessa Chair", from: PAST });
  await hold("ceo", { name: "Nasser Ceo", from: PAST });
  await hold("cfo", { name: "Cfo Person", from: PAST });
  await hold("analyst", { userId: U.owner, from: PAST });
  await hold("clerk", { userId: U.leaver2, from: PAST });
  await hold("hrd", { userId: U.mgr2, from: PAST });
  await hold("hro", { userId: U.leaver, from: PAST });
  // Recruiter and Legal counsel stay vacant.
});

beforeEach(async () => {
  await owner.query(`UPDATE org_chart_versions SET show_names = true WHERE id = $1`, [V1]);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("starting a structure from nothing", () => {
  it("the Structure tab is there for the firm's editors before anything exists, and for nobody else", async () => {
    const tab = (who: string) => svc(who, (tx, p) => OC.hasStructure(tx, p, FRESH));
    expect(await tab(U.lead)).toBe(true);
    expect(await tab(U.cons)).toBe(true);
    expect(await tab(U.admin)).toBe(true);
    expect(await tab(U.fresh)).toBe(false);
    expect(await tab(U.obs)).toBe(false);
    expect(await tab(U.team)).toBe(false);
    // An editor of another client sees no tab here either.
    expect(await svc(U.deputy, (tx, p) => OC.hasStructure(tx, p, FRESH))).toBe(false);
  });

  it("the first unit starts the structure (as the units route does); a reader who does not edit cannot", async () => {
    const first = async (who: string) =>
      svc(who, async (tx, p) => {
        await OC.startChart(tx, p, FRESH);
        return OC.addUnit(tx, p, FRESH, { kind: "board", nameAr: "مجلس الإدارة", nameEn: "Board" });
      });
    await expect(first(U.fresh)).rejects.toThrow(REFUSED);
    await expect(first(U.deputy)).rejects.toThrow(REFUSED);
    const made = await first(U.cons);
    expect(made.code).toBe("1");
    // Rolled back: Fresh still has nothing.
    expect((await owner.query(`SELECT count(*)::int AS n FROM org_charts WHERE org_id = $1`, [FRESH])).rows[0].n).toBe(0);
  });
});

describe("the outline editor", () => {
  it("moving a unit under another keeps the levels in step with the tree", async () => {
    const d = await svc(U.lead, (tx, p) => OC.getDraft(tx, p, ACME));
    const u = Object.fromEntries(d.units.map((x) => [x.nameEn!, x])) as Record<string, OC.OrgUnit>;
    const section = await svc(U.lead, (tx, p) => OC.addUnit(tx, p, ACME, { kind: "section", nameEn: "Payroll", parentId: u["Human resources"]!.id }), true);
    const levels = async () =>
      Object.fromEntries(
        (await owner.query(`SELECT name_en, level FROM org_units WHERE version_id = $1 AND name_en IN ('Human resources', 'Payroll')`, [d.draft!.id])).rows.map((r) => [
          r.name_en,
          r.level,
        ]),
      );
    expect(await levels()).toEqual({ "Human resources": 3, Payroll: 4 });
    // Outdent Human resources to the top: it and its section move up two levels.
    await svc(U.lead, (tx, p) => OC.moveUnit(tx, p, u["Human resources"]!.id, { parentId: null }), true);
    expect(await levels()).toEqual({ "Human resources": 1, Payroll: 2 });
    // Indent it back under the chief executive.
    await svc(U.lead, (tx, p) => OC.moveUnit(tx, p, u["Human resources"]!.id, { parentId: u["Chief executive"]!.id, index: 1 }), true);
    expect(await levels()).toEqual({ "Human resources": 3, Payroll: 4 });
    // Moving among the same siblings changes no level.
    await svc(U.lead, (tx, p) => OC.moveUnit(tx, p, u["Human resources"]!.id, { parentId: u["Chief executive"]!.id, index: 0 }), true);
    expect(await levels()).toEqual({ "Human resources": 3, Payroll: 4 });
    await svc(U.lead, (tx, p) => OC.deleteUnit(tx, p, section.id), true);
  });

  it("starts the draft again from the current version: the firm's editors only, and only the draft they looked at", async () => {
    const draftId = await draftIdOf(ACME);
    const d = await svc(U.lead, (tx, p) => OC.getDraft(tx, p, ACME));
    const finance = d.units.find((x) => x.nameEn === "Finance")!;
    await svc(U.cons, (tx, p) => OC.updateUnit(tx, p, finance.id, { nameEn: "Money" }), true);
    const extra = await svc(U.cons, (tx, p) => OC.addUnit(tx, p, ACME, { kind: "office", nameEn: "Projects office", parentId: finance.id }), true);
    await svc(U.cons, (tx, p) => OC.addPosition(tx, p, extra.id, { titleEn: "Planner", isHead: true }), true);
    // Refused: the client's admin, an observer, a consultant on the team only, another client's admin, a stale draft.
    for (const who of [U.cadmin, U.obs, U.team, U.oadmin]) {
      await expect(svc(who, (tx, p) => OC.resetDraft(tx, p, ACME, { draftId }))).rejects.toThrow(REFUSED);
    }
    await expect(svc(U.lead, (tx, p) => OC.resetDraft(tx, p, ACME, { draftId: V1 }))).rejects.toThrow(/no longer the current one/);
    await expect(attempt(U.cadmin, `SELECT app_reset_org_chart_draft((SELECT id FROM org_charts WHERE org_id = $1), $2)`, [ACME, draftId])).rejects.toThrow(
      /no such structure/,
    );
    // The lead starts again: the draft is the published structure once more, the same draft.
    await svc(U.lead, (tx, p) => OC.resetDraft(tx, p, ACME, { draftId }), true);
    const again = await svc(U.lead, (tx, p) => OC.getDraft(tx, p, ACME));
    const published = await svc(U.lead, (tx, p) => OC.getPublishedChart(tx, p, ACME));
    expect(again.draft!.id).toBe(draftId);
    const shape = (x: { units: OC.OrgUnit[]; positions: OC.OrgPosition[] }) => ({
      units: x.units.map((u) => [u.code, u.nameEn, u.level]).sort(),
      positions: x.positions.map((p) => [p.code, p.titleEn, p.lineageId]).sort(),
    });
    expect(shape(again)).toEqual(shape(published));
    // The reporting lines are rebuilt inside the draft.
    const analyst = again.positions.find((p) => p.titleEn === "Analyst")!;
    expect(again.positions.find((p) => p.id === analyst.reportsToId)?.titleEn).toBe("CFO");
    expect((await owner.query(`SELECT 1 FROM audit_log WHERE action = 'org_chart.draft_reset' AND actor_id = $1`, [U.lead])).rowCount).toBe(1);
  });
});

describe("holders and vacancies", () => {
  it("the people who change holders read every holding with its dates; nobody else", async () => {
    const list = await svc(U.cadmin, (tx, p) => OC.listHoldings(tx, p, POS.analyst!));
    expect(list.holdings).toEqual([expect.objectContaining({ userId: U.owner, name: "owner person", typed: false, from: PAST, to: null, current: true })]);
    expect((await svc(U.lead, (tx, p) => OC.listHoldings(tx, p, POS.cfo!))).holdings[0]).toMatchObject({ name: "Cfo Person", typed: true });
    for (const who of [U.mgr, U.owner, U.obs, U.team, U.oadmin]) {
      await expect(svc(who, (tx, p) => OC.listHoldings(tx, p, POS.cfo!))).rejects.toThrow(REFUSED);
    }
    // The people they can pick: the client's own active people with an account.
    const picks = await svc(U.cadmin, (tx, p) => OC.holderCandidates(tx, p, ACME));
    expect(picks.map((x) => x.userId)).toEqual(expect.arrayContaining([U.cadmin, U.mgr, U.owner, U.next]));
    expect(picks.map((x) => x.userId)).not.toContain(U.oadmin);
    await expect(svc(U.mgr, (tx, p) => OC.holderCandidates(tx, p, ACME))).rejects.toThrow(REFUSED);
  });

  it("the vacancy list: positions nobody holds today", async () => {
    const vac = await svc(U.cadmin, (tx, p) => OC.listVacancies(tx, p, ACME));
    expect(vac.map((v) => v.titleEn).sort()).toEqual(["Legal counsel", "Recruiter"]);
  });
});

describe("removing a holding entered by mistake", () => {
  beforeEach(async () => {
    await owner.query(`DELETE FROM notifications`);
  });

  it("the client's admin removes one on the published structure: the row is gone, the audit row has no name, and the lead is told", async () => {
    const typo = await svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, POS.recruiter!, { start: { name: "Typo Mistakename", from: today() } }), true);
    await truncateHolderNotices();
    await svc(U.cadmin, (tx, p) => OC.removeHolder(tx, p, POS.recruiter!, typo.started!), true);
    expect((await owner.query(`SELECT count(*)::int AS n FROM position_holders WHERE id = $1`, [typo.started])).rows[0].n).toBe(0);
    const logged = (await owner.query(`SELECT actor_id, resource_id, meta, created_at IS NOT NULL AS dated FROM audit_log WHERE action = 'org_chart.holder_remove'`)).rows;
    expect(logged).toEqual([{ actor_id: U.cadmin, resource_id: POS.recruiter, meta: { client: ACME, holder: typo.started }, dated: true }]);
    // Nowhere in the audit log is the name written, not even for the holding's start.
    expect((await owner.query(`SELECT count(*)::int AS n FROM audit_log WHERE audit_log::text ILIKE '%Mistakename%'`)).rows[0].n).toBe(0);
    // Gone from the masking list too.
    expect((await owner.query(`SELECT count(*)::int AS n FROM app_mask_names($1) WHERE term ILIKE '%Mistakename%'`, [P])).rows[0].n).toBe(0);
    expect((await owner.query(`SELECT user_id FROM notifications WHERE kind = 'org_chart.holder_changed' ORDER BY user_id`)).rows.map((r) => r.user_id)).toEqual(
      [U.lead, U.deputy].sort(),
    );
  });

  it("only the people who change holders: a manager, an action owner, an observer, the team, another client are refused, and the row stays", async () => {
    const typo = await svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, POS.recruiter!, { start: { name: "Wrong Person", from: today() } }), true);
    for (const who of [U.mgr, U.owner, U.obs, U.team, U.oadmin, U.omgr]) {
      await expect(svc(who, (tx, p) => OC.removeHolder(tx, p, POS.recruiter!, typo.started!))).rejects.toThrow(REFUSED);
      await expect(attempt(who, `SELECT app_remove_position_holder($1, $2)`, [POS.recruiter, typo.started])).rejects.toThrow(/no such holding/);
    }
    // Straight in the database, nobody deletes a holding: the app may not.
    await expect(attempt(U.cadmin, `DELETE FROM position_holders WHERE id = $1`, [typo.started])).rejects.toThrow(/permission denied/);
    await expect(attempt(U.lead, `DELETE FROM position_holders WHERE id = $1`, [typo.started])).rejects.toThrow(/permission denied/);
    // A holding of another position is not this one's to remove.
    await expect(svc(U.cadmin, (tx, p) => OC.removeHolder(tx, p, POS.counsel!, typo.started!))).rejects.toThrow(REFUSED);
    expect((await owner.query(`SELECT count(*)::int AS n FROM position_holders WHERE id = $1`, [typo.started])).rows[0].n).toBe(1);
    // The firm's editors may.
    await svc(U.cons, (tx, p) => OC.removeHolder(tx, p, POS.recruiter!, typo.started!), true);
    expect((await owner.query(`SELECT count(*)::int AS n FROM position_holders WHERE id = $1`, [typo.started])).rows[0].n).toBe(0);
  });

  it("the client's admin cannot remove one placed in the firm's draft; the firm's editors can", async () => {
    const d = await svc(U.lead, (tx, p) => OC.getDraft(tx, p, ACME));
    const hr = d.units.find((u) => u.nameEn === "Human resources")!;
    const newPos = await svc(U.lead, (tx, p) => OC.addPosition(tx, p, hr.id, { titleEn: "Draft-only trainer" }), true);
    const placed = await svc(U.lead, (tx, p) => OC.changeHolder(tx, p, newPos.id, { start: { name: "Draft Trainer", from: today() } }), true);
    await expect(svc(U.cadmin, (tx, p) => OC.removeHolder(tx, p, newPos.id, placed.started!))).rejects.toThrow(REFUSED);
    await expect(attempt(U.cadmin, `SELECT app_remove_position_holder($1, $2)`, [newPos.id, placed.started])).rejects.toThrow(/no such holding/);
    await svc(U.lead, (tx, p) => OC.removeHolder(tx, p, newPos.id, placed.started!), true);
    await svc(U.lead, (tx, p) => OC.deletePosition(tx, p, newPos.id), true);
  });

  it("once no holding names anyone, the client may switch to minimal records", async () => {
    await svc(U.lead, (tx, p) => OC.startChart(tx, p, FAMILY), true);
    const u = await svc(U.lead, (tx, p) => OC.addUnit(tx, p, FAMILY, { kind: "board", nameEn: "Family council" }), true);
    const pos = await svc(U.lead, (tx, p) => OC.addPosition(tx, p, u.id, { titleEn: "Council head", isHead: true }), true);
    await publishAs(U.lead, FAMILY);
    const { started } = await svc(U.lead, (tx, p) => OC.changeHolder(tx, p, pos.id, { start: { name: "Family Elder", from: PAST } }), true);
    // Ended, it still names someone: the switch is refused.
    await svc(U.lead, (tx, p) => OC.changeHolder(tx, p, pos.id, { end: { holderId: started!, on: today() } }), true);
    const switchOn = () => svc(U.admin, (tx, p) => setEngagement(tx, p, FAMILY, { minimalRecords: true, displayAlias: "Family office C" }), true);
    await expect(switchOn()).rejects.toThrow(/remove the names of people from the client's structure/);
    // Removed, it names nobody: allowed.
    await svc(U.lead, (tx, p) => OC.removeHolder(tx, p, pos.id, started!), true);
    expect((await svc(U.admin, (tx, p) => getEngagement(tx, p, FAMILY))).fit).toMatchObject({ hasStructureNames: false });
    await switchOn();
    expect((await owner.query(`SELECT minimal_records AS on FROM organizations WHERE id = $1`, [FAMILY])).rows[0].on).toBe(true);
    expect((await owner.query(`SELECT count(*)::int AS n FROM audit_log WHERE audit_log::text ILIKE '%Family Elder%'`)).rows[0].n).toBe(0);
  });
});

async function truncateHolderNotices() {
  await owner.query(`DELETE FROM notifications`);
  await owner.query(`DELETE FROM outbound_emails`);
}

describe("when someone leaves", () => {
  it("their positions are listed on the leaving report, and switching them off leaves each vacant from the next day", async () => {
    const held = await svc(U.cadmin, (tx, p) => personHoldings(tx, p, U.leaver));
    expect(held.positions.map((x) => [x.positionId, x.titleEn])).toEqual([[POS.hro, "HR officer"]]);
    expect(held.blocking).toBe(0);
    await truncateHolderNotices();
    await svc(U.cadmin, (tx, p) => setActive(tx, p, U.leaver, { active: false, reason: "Left the company" }), true);
    const row = (await owner.query(`SELECT to_date::text AS d, ended_by FROM position_holders WHERE user_id = $1`, [U.leaver])).rows;
    expect(row).toEqual([{ d: today(), ended_by: U.cadmin }]);
    // Held today (the leaving day), vacant tomorrow; the position itself stays.
    const chartTomorrow = await svc(U.cadmin, (tx, p) => OC.getPublishedChart(tx, p, ACME, tomorrow()));
    expect(chartTomorrow.positions.find((p) => p.id === POS.hro)).toMatchObject({ vacant: true, holders: [] });
    const logged = (await owner.query(`SELECT actor_id, meta FROM audit_log WHERE action = 'org_chart.holder_end' AND meta->>'leaving' = 'true'`)).rows;
    expect(logged).toEqual([{ actor_id: U.cadmin, meta: expect.objectContaining({ client: ACME, on: today(), leaving: true }) }]);
    expect((await owner.query(`SELECT count(*)::int AS n FROM notifications WHERE kind = 'org_chart.holder_changed'`)).rows[0].n).toBeGreaterThan(0);
  });

  it("a replacement takes the position over from the next day; a position they do not hold, or themselves, is refused", async () => {
    const held = await svc(U.cadmin, (tx, p) => personHoldings(tx, p, U.leaver2));
    expect(held.positions.map((x) => x.positionId)).toEqual([POS.clerk]);
    await expect(
      svc(U.cadmin, (tx, p) => setActive(tx, p, U.leaver2, { active: false, reason: "Moved on", replacements: [{ positionId: POS.cfo!, userId: U.next }] })),
    ).rejects.toThrow(/position/);
    await expect(
      svc(U.cadmin, (tx, p) => setActive(tx, p, U.leaver2, { active: false, reason: "Moved on", replacements: [{ positionId: POS.clerk!, userId: U.leaver2 }] })),
    ).rejects.toThrow(/replacement/);
    await svc(U.cadmin, (tx, p) => setActive(tx, p, U.leaver2, { active: false, reason: "Moved on", replacements: [{ positionId: POS.clerk!, userId: U.next }] }), true);
    const rows = (
      await owner.query(`SELECT user_id, from_date::text AS f, to_date::text AS t FROM position_holders WHERE position_lineage_id = $1 ORDER BY from_date`, [POS.clerk])
    ).rows;
    expect(rows).toEqual([
      { user_id: U.leaver2, f: PAST, t: today() },
      { user_id: U.next, f: tomorrow(), t: null },
    ]);
  });

  it("a typed name can take over too; someone who may not manage the people cannot switch them off", async () => {
    await expect(svc(U.mgr, (tx, p) => setActive(tx, p, U.mgr2, { active: false, reason: "x" }))).rejects.toThrow(REFUSED);
    await expect(svc(U.lead, (tx, p) => setActive(tx, p, U.mgr2, { active: false, reason: "x" }))).rejects.toThrow(REFUSED);
    // The firm admin switches the HR director off and names her successor, who has no account yet.
    await svc(U.admin, (tx, p) => setActive(tx, p, U.mgr2, { active: false, reason: "Retired", replacements: [{ positionId: POS.hrd!, name: "Incoming Director" }] }), true);
    const chart = await svc(U.cadmin, (tx, p) => OC.getPublishedChart(tx, p, ACME, tomorrow()));
    expect(chart.positions.find((p) => p.id === POS.hrd)!.holders.map((h) => h.name)).toEqual(["Incoming Director"]);
    await owner.query(`UPDATE org_memberships SET active = true WHERE user_id = $1`, [U.mgr2]);
  });
});

describe("the invite form's position", () => {
  const accept = async (invitationId: string, email: string, uid: string) => {
    await owner.query(`UPDATE invitations SET token_hash = repeat('a', 63) || $2 WHERE id = $1`, [invitationId, uid.slice(-1)]);
    await owner.query(`INSERT INTO "user" (id, name, email) VALUES ($1, 'Newcomer', $2)`, [uid, email]);
    // As the public accept route: no one signed in.
    return as(null, (c) => c.query(`SELECT app_accept_invitation(repeat('a', 63) || $1, $2)`, [uid.slice(-1), uid]), true);
  };

  it("offers vacant positions only; accepting the invitation starts the holding from that day, and the lead is told", async () => {
    await expect(svc(U.cadmin, (tx, p) => invite(tx, p, { orgId: ACME, email: "taken@example.test", name: "X", role: "action_owner", positionId: POS.cfo! }))).rejects.toThrow(
      /position/,
    );
    // A position only the firm's draft has, or another client's, is refused as well.
    const d = await svc(U.lead, (tx, p) => OC.getDraft(tx, p, ACME));
    await expect(
      svc(U.cadmin, (tx, p) => invite(tx, p, { orgId: ACME, email: "draft@example.test", name: "X", role: "action_owner", positionId: d.positions[0]!.id })),
    ).rejects.toThrow(/position/);
    await expect(svc(U.oadmin, (tx, p) => invite(tx, p, { orgId: OTHER, email: "other@example.test", name: "X", role: "action_owner", positionId: POS.counsel! }))).rejects.toThrow(
      /position/,
    );
    // Straight in the database: a position of another company, or by someone who may not place people.
    await expect(
      attempt(U.oadmin, `INSERT INTO invitations (org_id, email, name, role, token_hash, invited_by, expires_at, position_lineage_id) VALUES ($1,'o2@example.test','X','action_owner',repeat('b',64),$2,now(),$3)`, [
        OTHER,
        U.oadmin,
        POS.counsel,
      ]),
    ).rejects.toThrow(/current structure/);

    const inv = await svc(U.cadmin, (tx, p) => invite(tx, p, { orgId: ACME, email: "counsel@example.test", name: "New Counsel", role: "client_manager", positionId: POS.counsel! }), true);
    expect((await owner.query(`SELECT position_lineage_id FROM invitations WHERE id = $1`, [inv.id])).rows[0].position_lineage_id).toBe(POS.counsel);
    await truncateHolderNotices();
    await accept(inv.id, "counsel@example.test", id(70));
    const held = (await owner.query(`SELECT user_id, from_date::text AS f, to_date, created_by FROM position_holders WHERE position_lineage_id = $1`, [POS.counsel])).rows;
    expect(held).toEqual([{ user_id: id(70), f: today(), to_date: null, created_by: U.cadmin }]);
    expect((await owner.query(`SELECT actor_id, meta->>'invitation' AS inv FROM audit_log WHERE action = 'org_chart.holder_start' AND meta->>'invitation' IS NOT NULL`)).rows).toEqual([
      { actor_id: id(70), inv: inv.id },
    ]);
    expect((await owner.query(`SELECT user_id FROM notifications WHERE kind = 'org_chart.holder_changed' ORDER BY user_id`)).rows.map((r) => r.user_id)).toEqual(
      [U.lead, U.deputy].sort(),
    );
    expect((await svc(U.cadmin, (tx, p) => OC.listVacancies(tx, p, ACME))).map((v) => v.titleEn)).toEqual(["Recruiter"]);
  });

  it("a position filled before the invitation is accepted: the person joins, and nobody is pushed out", async () => {
    // The firm admin invites too (they may place people in the client's positions).
    const inv = await svc(
      U.admin,
      (tx, p) => invite(tx, p, { orgId: ACME, email: "recruit@example.test", name: "Recruit", role: "action_owner", positionId: POS.recruiter! }),
      true,
    );
    // Two recruiters are planned; both places are taken before the link is used.
    await svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, POS.recruiter!, { start: { name: "First Recruiter", from: today() } }), true);
    await svc(U.cadmin, (tx, p) => OC.changeHolder(tx, p, POS.recruiter!, { start: { name: "Second Recruiter", from: today() } }), true);
    await accept(inv.id, "recruit@example.test", id(71));
    expect((await owner.query(`SELECT count(*)::int AS n FROM org_memberships WHERE user_id = $1 AND active`, [id(71)])).rows[0].n).toBe(1);
    expect((await owner.query(`SELECT count(*)::int AS n FROM position_holders WHERE user_id = $1`, [id(71)])).rows[0].n).toBe(0);
    expect((await owner.query(`SELECT count(*)::int AS n FROM position_holders WHERE position_lineage_id = $1 AND to_date IS NULL`, [POS.recruiter])).rows[0].n).toBe(2);
  });
});

describe("a person's work card", () => {
  const card = (who: string, person = U.owner, pick?: string | null) => svc(who, (tx, p) => OC.personWork(tx, p, ACME, person, pick));
  const ids = (c: OC.PersonWork) => ({
    late: c.late.map((a) => a.id),
    open: c.open.map((a) => a.id),
    uploads: c.uploads.map((f) => f.id),
  });
  /** What the reader may open at all, straight from row-level security. */
  const readable = async (who: string) => ({
    actions: new Set((await attempt(who, `SELECT id FROM actions`)).rows.map((r) => r.id as string)),
    files: new Set((await attempt(who, `SELECT id FROM documents`)).rows.map((r) => r.id as string)),
  });

  it("a manager of the person's department sees only what she could already open: no other department's action, no draft, no file kept from her", async () => {
    const c = await card(U.mgr);
    expect(c.person).toMatchObject({ userId: U.owner, name: "owner person", positions: [expect.objectContaining({ titleEn: "Analyst", unitNameEn: "Finance" })] });
    // Not the HR file, not the private notes, and not the Finance file she was left out of (feature A).
    expect(ids(c)).toEqual({ late: [ACT.late], open: [ACT.fin], uploads: [DOC.fin] });
    expect(c.uploads.map((f) => f.id)).not.toContain(DOC.narrow);
    const can = await readable(U.mgr);
    for (const a of [...c.late, ...c.open]) expect(can.actions.has(a.id)).toBe(true);
    for (const f of c.uploads) expect(can.files.has(f.id)).toBe(true);
    // Each links to the item.
    expect(c.uploads[0]).toMatchObject({ href: `/projects/${P}`, where: "Acme governance" });
  });

  it("the client's admin sees every department's work, never a firm draft or a file private to the person", async () => {
    const c = await card(U.cadmin);
    // Late first; then by due date; uploads newest first (the narrowed file too: only the Finance manager was left out).
    expect(ids(c)).toEqual({ late: [ACT.late], open: [ACT.hr, ACT.fin], uploads: [DOC.narrow, DOC.hr, DOC.fin] });
    expect(c.uploads.map((f) => f.id)).not.toContain(DOC.mine);
    expect(c.open.map((a) => a.id)).not.toContain(ACT.draft);
    // Done work and other people's work are not this card's.
    expect([...c.late, ...c.open].map((a) => a.id)).not.toContain(ACT.done);
    expect([...c.late, ...c.open].map((a) => a.id)).not.toContain(ACT.other);
    // The work only: no score, count or ranking anywhere on the card.
    expect(Object.keys(c).sort()).toEqual(["late", "more", "open", "person", "uploads"]);
    expect(JSON.stringify(c)).not.toMatch(/score|rank|percent|rate/i);
  });

  it("the firm reads it under its own rights, the same way", async () => {
    const c = await card(U.lead);
    expect(ids(c).late).toEqual([ACT.late]);
    expect(ids(c).open).toEqual(expect.arrayContaining([ACT.fin, ACT.hr]));
    expect(ids(c).uploads).not.toContain(DOC.mine);
    // The draft is drawn for the firm: its names have a card there too.
    expect((await card(U.lead, U.owner, "draft")).person.userId).toBe(U.owner);
  });

  it("a manager gets no card for a name she cannot see: outside her branch, or with names off", async () => {
    // The HR director is outside the Finance manager's branch: the client's admin has the card, she does not.
    expect((await card(U.cadmin, U.mgr2)).person.positions.map((p) => p.titleEn)).toEqual(["HR director"]);
    await expect(card(U.mgr, U.mgr2)).rejects.toThrow(REFUSED);
    // The HR manager, in that branch, does.
    expect((await card(U.mgr2, U.mgr2)).person.userId).toBe(U.mgr2);
    // Names off: no card for anyone, her own colleague included.
    await owner.query(`UPDATE org_chart_versions SET show_names = false WHERE id = $1`, [V1]);
    await expect(card(U.mgr)).rejects.toThrow(REFUSED);
    // The client's admin and the firm still get it.
    expect((await card(U.cadmin)).person.userId).toBe(U.owner);
    expect((await card(U.cons)).person.userId).toBe(U.owner);
  });

  it("an action owner has no tab and no card; a typed name and someone who holds no position have none", async () => {
    expect(await svc(U.owner, (tx, p) => OC.hasStructure(tx, p, ACME))).toBe(false);
    await expect(card(U.owner)).rejects.toThrow(REFUSED);
    await expect(card(U.next, U.owner)).rejects.toThrow(REFUSED);
    // A typed name has no account: no id to ask for. Someone without a position: nothing to open.
    await expect(card(U.cadmin, U.cadmin)).rejects.toThrow(REFUSED);
    await expect(card(U.cadmin, id(99))).rejects.toThrow(REFUSED);
  });

  it("another client's people and a consultant outside the client: 404", async () => {
    for (const who of [U.oadmin, U.omgr, U.team, U.fresh]) await expect(card(who)).rejects.toThrow(REFUSED);
    // Asking from one's own client for someone of another fails the same way.
    await expect(svc(U.oadmin, (tx, p) => OC.personWork(tx, p, OTHER, U.owner))).rejects.toThrow(REFUSED);
  });
});

describe("audit", () => {
  it("the new writes are in the audit log, with labels", async () => {
    const actions = (await owner.query(`SELECT DISTINCT action FROM audit_log WHERE action LIKE 'org_chart%' ORDER BY 1`)).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["org_chart.draft_reset", "org_chart.holder_remove", "org_chart.holder_end", "org_chart.holder_start"]));
  });
});
