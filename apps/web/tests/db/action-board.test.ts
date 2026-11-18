// Batch 2, part C (page audit 4.6, decisions D2 and D5): one Actions list
// with filters in the address, /review and /oversight folded into it, and the
// Projects table for the firm. Every filter returns exactly its rule's
// actions and only what the reader may open (row-level security, then
// authorize(): D6 drafts, D8 departments, 1b owners, firm-only labels); an
// action both late and blocked is one row; every count equals its list; the
// home's two counts equal the lists they link to; "Remind the owner" keeps
// its permission and its once-a-day limit.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { actionsHref, parseActionsQuery, type ActionFilterKey, type ActionsQuery } from "@/lib/action-filters";
import { actionBoard, attentionCounts, projectsTable, remindOwner } from "@/services/action-board";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-b2c0-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2); // departments on
const BETA = id(3);
const U = {
  admin: id(11),
  lead: id(12), // Acme's lead, staffed on both Acme projects
  obs: id(13), // observes the Acme project
  other: id(14), // Beta's lead
  cadmin: id(15), // Acme's admin
  mgr: id(16), // Acme manager, Legal only
  own: id(17), // Acme action owner, Legal
  own2: id(18), // Acme action owner, Finance
  gone: id(19), // an Acme action owner who has left
  bowner: id(20), // Beta action owner
};
const P = { acme: id(21), closed: id(22), beta: id(23) };
const DEPT = { legal: id(24), fin: id(25) };
const R = { acme: id(31), secret: id(32), closed: id(33), beta: id(34) };
const A = {
  late: id(41),
  lateBlocked: id(42),
  blocked: id(43),
  review: id(44),
  reviewNew: id(45),
  stale: id(46),
  slipped: id(47),
  churn: id(48),
  orphaned: id(49),
  draft: id(50),
  verified: id(51),
  secret: id(52),
  wide: id(53),
  closedLate: id(54),
  betaLate: id(55),
};
const NAME = Object.fromEntries(Object.entries(A).map(([k, v]) => [v, k]));

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
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    commit,
  );
const q = (over: Partial<ActionsQuery> = {}): ActionsQuery => ({ ...parseActionsQuery({}), ...over });
const board = (userId: string, over: Partial<ActionsQuery> = {}) => svc(userId, (tx, p) => actionBoard(tx, p, q(over)));
const names = (rows: { id: string }[]) => rows.map((r) => NAME[r.id] ?? r.id).sort();
/** What the database itself lets this person read, straight from the table. */
const readable = async (userId: string) =>
  (await as(userId, (c) => c.query<{ id: string }>(`SELECT id FROM actions`))).rows.map((r) => NAME[r.id] ?? r.id).sort();

beforeAll(async () => {
  const x = (text: string, params: unknown[] = []) => owner.query(text, params);
  await x(`TRUNCATE "user", organizations CASCADE`);
  await x(
    `INSERT INTO organizations (id, kind, name, engagement_mode, departments_enabled) VALUES
      ($1,'firm','Mizan Advisory',NULL,false), ($2,'client','Acme','full',true), ($3,'client','Beta','full',false)`,
    [FIRM, ACME, BETA],
  );
  await x(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await x(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await x(
    `INSERT INTO org_memberships (user_id, org_id, role, active) VALUES
      ($1,$11,'firm_admin',true), ($2,$11,'consultant',true), ($3,$11,'consultant',true), ($4,$11,'consultant',true),
      ($5,$12,'client_admin',true), ($6,$12,'client_manager',true), ($7,$12,'action_owner',true), ($8,$12,'action_owner',true), ($9,$12,'action_owner',false),
      ($10,$13,'action_owner',true)`,
    [U.admin, U.lead, U.obs, U.other, U.cadmin, U.mgr, U.own, U.own2, U.gone, U.bowner, FIRM, ACME, BETA],
  );
  await x(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$4,$6,'Acme governance','active',$7), ($2,'client',$4,$6,'Acme phase one','active',$7), ($3,'client',$5,$6,'Beta plan','active',$7)`,
    [P.acme, P.closed, P.beta, ACME, BETA, FIRM, U.admin],
  );
  await x(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$3,true), ($2,$4,true)`, [ACME, BETA, U.lead, U.other]);
  await x(
    `INSERT INTO project_members (project_id, user_id, observer) VALUES
      ($1,$4,false), ($1,$5,true), ($1,$6,false), ($1,$7,false), ($1,$8,false), ($1,$9,false),
      ($2,$4,false), ($2,$7,false), ($3,$10,false), ($3,$11,false)`,
    [P.acme, P.closed, P.beta, U.lead, U.obs, U.mgr, U.own, U.own2, U.gone, U.other, U.bowner],
  );
  await x(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$3,'الشؤون القانونية','Legal'), ($2,$3,'المالية','Finance')`, [DEPT.legal, DEPT.fin, ACME]);
  await x(`INSERT INTO department_members (department_id, user_id, is_head) VALUES ($1,$3,false), ($1,$4,false), ($2,$5,false)`, [DEPT.legal, DEPT.fin, U.mgr, U.own, U.own2]);
  await x(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES
      ($1,$5,$8,'Adopt a board charter','shared',$9), ($2,$5,$8,'Replace the CFO','firm_private',$9),
      ($3,$6,$8,'Phase one plan','shared',$9), ($4,$7,$10,'Beta charter','shared',$9)`,
    [R.acme, R.secret, R.closed, R.beta, P.acme, P.closed, P.beta, ACME, U.lead, BETA],
  );
  const act = (aid: string, pid: string, org: string, rec: string, title: string, who: string | null, status: string, due: number, dept: string | null, idle = 0) =>
    x(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, created_by, due_date, department_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,app_firm_today() + $9::int,$10, now() - make_interval(days => $11::int))`,
      [aid, pid, org, rec, title, who, status, U.lead, due, dept, idle],
    );
  await act(A.late, P.acme, ACME, R.acme, "Late canary", U.own, "in_progress", -10, DEPT.legal);
  await act(A.lateBlocked, P.acme, ACME, R.acme, "Late and blocked canary", U.own2, "blocked", -5, DEPT.fin);
  await act(A.blocked, P.acme, ACME, R.acme, "Blocked canary", U.own, "blocked", 10, DEPT.legal);
  await act(A.review, P.acme, ACME, R.acme, "Long review canary", U.own, "awaiting_review", 10, DEPT.legal);
  await act(A.reviewNew, P.acme, ACME, R.acme, "New review canary", U.own2, "awaiting_review", 10, DEPT.fin);
  // Nobody has touched it for 40 days (the firm's stale period is 14).
  await act(A.stale, P.acme, ACME, R.acme, "Stale canary", U.own, "in_progress", 20, DEPT.legal, 40);
  await act(A.slipped, P.acme, ACME, R.acme, "Slipped canary", U.own, "assigned", 5, DEPT.legal);
  await act(A.churn, P.acme, ACME, R.acme, "Churn canary", U.own2, "revision_requested", 10, DEPT.fin);
  await act(A.orphaned, P.acme, ACME, R.acme, "Orphaned canary", U.gone, "in_progress", 10, null);
  await act(A.draft, P.acme, ACME, R.acme, "Draft canary", U.own, "draft", -10, DEPT.legal);
  await act(A.verified, P.acme, ACME, R.acme, "Verified canary", U.own, "verified_complete", -10, DEPT.legal);
  await act(A.secret, P.acme, ACME, R.secret, "Secret canary", U.own, "in_progress", -3, DEPT.legal);
  await act(A.wide, P.acme, ACME, R.acme, "Company-wide canary", U.own2, "in_progress", 30, null);
  await act(A.closedLate, P.closed, ACME, R.closed, "Closed project canary", U.own, "in_progress", -10, DEPT.legal);
  await act(A.betaLate, P.beta, BETA, R.beta, "Beta canary", U.bowner, "in_progress", -2, null);
  // How long each review has waited.
  await x(`UPDATE actions SET awaiting_review_at = now() - interval '10 days' WHERE id = $1`, [A.review]);
  await x(`UPDATE actions SET awaiting_review_at = now() - interval '1 day' WHERE id = $1`, [A.reviewNew]);
  // Moved later twice (the trigger records each move).
  await x(`UPDATE actions SET due_date = app_firm_today() + 15 WHERE id = $1`, [A.slipped]);
  await x(`UPDATE actions SET due_date = app_firm_today() + 25 WHERE id = $1`, [A.slipped]);
  // Sent back twice.
  for (let i = 0; i < 2; i++)
    await x(`INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome, reason) VALUES ($1,$2,$3,$4,'revise','Again')`, [P.acme, ACME, A.churn, U.lead]);
  await x(`UPDATE projects SET state = 'closed' WHERE id = $1`, [P.closed]);
});
afterAll(async () => {
  await owner.end();
  await app.end();
});

const RULES: [ActionFilterKey, string[]][] = [
  ["mine", []],
  ["awaiting-review", ["review", "reviewNew"]],
  ["late", ["late", "lateBlocked", "secret"]],
  ["blocked", ["blocked", "lateBlocked"]],
  ["no-activity", ["stale"]],
  ["date-moved", ["slipped"]],
  ["sent-back", ["churn"]],
  ["no-owner", ["orphaned"]],
];

describe("each filter returns exactly its rule's actions", () => {
  it("for the client's lead consultant", async () => {
    const all = await board(U.lead);
    expect(names(all.rows)).toEqual(
      ["late", "lateBlocked", "blocked", "review", "reviewNew", "stale", "slipped", "churn", "orphaned", "draft", "verified", "secret", "wide", "closedLate"].sort(),
    );
    for (const [filter, expected] of RULES) {
      const b = await board(U.lead, { filter });
      expect([filter, names(b.rows)]).toEqual([filter, [...expected].sort()]);
      expect(b.query.filter).toBe(filter);
    }
  });

  it("leaves out drafts, finished work and a closed project's actions from every rule", async () => {
    const late = await board(U.admin, { filter: "late" });
    expect(names(late.rows)).toEqual(["betaLate", "late", "lateBlocked", "secret"]);
    for (const f of ["late", "blocked", "awaiting-review", "no-activity", "date-moved", "sent-back", "no-owner"] as const) {
      const rows = names((await board(U.admin, { filter: f })).rows);
      expect(rows).not.toContain("draft");
      expect(rows).not.toContain("verified");
      expect(rows).not.toContain("closedLate");
    }
  });

  it("shows an action that is both late and blocked once, in each list and in all", async () => {
    for (const filter of ["all", "late", "blocked"] as const) {
      const ids = (await board(U.lead, { filter })).rows.map((r) => r.id);
      expect(ids.filter((x) => x === A.lateBlocked)).toHaveLength(1);
      expect(new Set(ids).size).toBe(ids.length);
    }
    // The row names both rules it breaks.
    const row = (await board(U.lead, { filter: "late" })).rows.find((r) => r.id === A.lateBlocked)!;
    expect(row.reasons.map((r) => r.rule).sort()).toEqual(["blocked", "late"]);
  });

  it("narrows by client, project, owner and department", async () => {
    expect(names((await board(U.admin, { client: BETA })).rows)).toEqual(["betaLate"]);
    expect(names((await board(U.admin, { filter: "late", client: ACME })).rows)).toEqual(["late", "lateBlocked", "secret"]);
    expect(names((await board(U.lead, { project: P.closed })).rows)).toEqual(["closedLate"]);
    expect(names((await board(U.lead, { owner: U.own2 })).rows)).toEqual(["churn", "lateBlocked", "reviewNew", "wide"]);
    expect(names((await board(U.lead, { filter: "late", department: DEPT.fin })).rows)).toEqual(["lateBlocked"]);
    // The address round-trips.
    expect(parseActionsQuery(Object.fromEntries(new URL(actionsHref({ filter: "late", project: P.acme }), "http://x").searchParams))).toMatchObject({
      filter: "late",
      project: P.acme,
    });
  });
});

describe("only what the reader may open", () => {
  it("a client admin: no draft (D6), no firm-only work, and no firm measures", async () => {
    const b = await board(U.cadmin);
    expect(names(b.rows)).toEqual(await readable(U.cadmin));
    expect(names(b.rows)).not.toContain("draft");
    expect(names(b.rows)).not.toContain("secret");
    expect(names(b.rows)).not.toContain("betaLate");
    expect(b.filters).toEqual(["all", "mine", "awaiting-review", "late", "blocked"]);
    expect(names((await board(U.cadmin, { filter: "late" })).rows)).toEqual(["late", "lateBlocked"]);
    // A firm filter in the address falls back to the whole list.
    const asked = await board(U.cadmin, { filter: "no-activity" });
    expect(asked.query.filter).toBe("all");
    expect(Object.keys(asked.counts)).not.toContain("no-activity");
    // No client facet, no sign-off stage, no reminder.
    expect(b.facets.clients).toBeNull();
    const review = await board(U.cadmin, { filter: "awaiting-review" });
    expect(review.rows.every((r) => r.review && r.review.stage === null)).toBe(true);
    expect((await board(U.cadmin, { filter: "late" })).rows.every((r) => r.remind === null)).toBe(true);
  });

  it("a manager limited to Legal sees nothing by title from Finance (D8)", async () => {
    const b = await board(U.mgr);
    expect(names(b.rows)).toEqual(await readable(U.mgr));
    for (const fin of ["lateBlocked", "reviewNew", "churn"]) expect(names(b.rows)).not.toContain(fin);
    expect(names((await board(U.mgr, { filter: "late" })).rows)).toEqual(["late"]);
    expect((b.facets.departments ?? []).map((d) => d.label)).not.toContain("Finance");
    expect((b.facets.departments ?? []).map((d) => d.label)).not.toContain("المالية");
    // Asking for Finance by its id finds nothing.
    expect((await board(U.mgr, { department: DEPT.fin })).rows).toEqual([]);
  });

  it("an action owner sees only their own actions (1b), and is not offered 'mine'", async () => {
    const b = await board(U.own);
    expect(names(b.rows)).toEqual(await readable(U.own));
    expect(b.rows.every((r) => !["lateBlocked", "reviewNew", "churn", "wide", "orphaned"].includes(NAME[r.id]!))).toBe(true);
    expect(b.filters).toEqual(["all", "awaiting-review", "late", "blocked"]);
    expect(names((await board(U.own, { filter: "late" })).rows)).toEqual(["late"]);
    expect(b.facets.owners).toBeNull();
    // Another person's id in the address is not a choice they have: dropped, and still only their own.
    const asked = await board(U.own, { owner: U.own2 });
    expect(asked.query.owner).toBeUndefined();
    expect(names(asked.rows)).toEqual(names(b.rows));
  });

  it("another consultant sees none of Acme; the client's other company sees none of it either", async () => {
    expect(names((await board(U.other)).rows)).toEqual(["betaLate"]);
    expect(names((await board(U.bowner)).rows)).toEqual(["betaLate"]);
  });
});

describe("every count equals its list", () => {
  it("for every reader, every filter, with and without a facet", { timeout: 180_000 }, async () => {
    for (const who of [U.admin, U.lead, U.obs, U.other, U.cadmin, U.mgr, U.own, U.own2]) {
      for (const facet of [{}, { department: DEPT.legal }]) {
        const b = await board(who, facet);
        for (const f of b.filters) {
          const list = await board(who, { ...facet, filter: f });
          expect([who, f, facet, b.counts[f]]).toEqual([who, f, facet, list.total]);
          expect(list.total).toBe(list.rows.length);
        }
        const long = await board(who, { ...facet, filter: "awaiting-review", waitingLong: true });
        expect(b.waitingLongCount).toBe(long.total);
      }
    }
  });

  it("the home's two counts equal the lists they open", async () => {
    for (const who of [U.admin, U.lead, U.cadmin, U.own]) {
      const c = await svc(who, (tx, p) => attentionCounts(tx, p));
      const late = await svc(who, (tx, p) => actionBoard(tx, p, parseActionsQuery(Object.fromEntries(new URL(c.late.href, "http://x").searchParams))));
      const waiting = await svc(who, (tx, p) =>
        actionBoard(tx, p, parseActionsQuery(Object.fromEntries(new URL(c.reviewsWaitingLong.href, "http://x").searchParams))),
      );
      expect(c.late.n).toBe(late.total);
      expect(c.reviewsWaitingLong.n).toBe(waiting.total);
    }
    const admin = await svc(U.admin, (tx, p) => attentionCounts(tx, p));
    expect(admin).toEqual({
      late: { n: 4, href: "/actions?filter=late" },
      reviewsWaitingLong: { n: 1, href: "/actions?filter=awaiting-review&waiting=long" },
    });
  });
});

describe("awaiting review", () => {
  it("adds the waiting days and, for the firm, the sign-off stage; 'long' keeps the reviews past 7 days", async () => {
    const b = await board(U.lead, { filter: "awaiting-review" });
    // Oldest wait first.
    expect(b.rows.map((r) => NAME[r.id])).toEqual(["review", "reviewNew"]);
    expect(b.rows[0]!.review).toMatchObject({ waitingDays: 10, stage: { required: false, signedBy: null, canAct: true } });
    expect(b.rows[1]!.review!.waitingDays).toBe(1);
    expect(names((await board(U.lead, { filter: "awaiting-review", waitingLong: true })).rows)).toEqual(["review"]);
    expect(b.waitingLongCount).toBe(1);
  });
});

describe("Remind the owner", () => {
  it("is offered on the rule lists to the firm on the project, not to an observer, and not where nobody can be reminded", async () => {
    const lead = await board(U.lead, { filter: "late" });
    expect(lead.rows.find((r) => r.id === A.late)!.remind).toMatchObject({ can: true, remindedToday: false });
    const orphan = await board(U.lead, { filter: "no-owner" });
    expect(orphan.rows[0]!.remind!.can).toBe(false);
    const obs = await board(U.obs, { filter: "late" });
    expect(obs.rows.length).toBeGreaterThan(0);
    expect(obs.rows.every((r) => !r.remind?.can)).toBe(true);
    // Not on "all", "mine" or "awaiting review".
    expect((await board(U.lead)).rows.every((r) => r.remind === null)).toBe(true);
    expect((await board(U.lead, { filter: "awaiting-review" })).rows.every((r) => r.remind === null)).toBe(true);
  });

  it("keeps its once-a-day limit and its permission", async () => {
    await svc(U.lead, (tx, p) => remindOwner(tx, p, A.late), true);
    const after = await board(U.lead, { filter: "late" });
    expect(after.rows.find((r) => r.id === A.late)!.remind).toMatchObject({ can: false, remindedToday: true });
    await expect(svc(U.admin, (tx, p) => remindOwner(tx, p, A.late))).rejects.toThrow();
    await expect(svc(U.obs, (tx, p) => remindOwner(tx, p, A.lateBlocked))).rejects.toThrow(/forbidden/i);
    await expect(svc(U.cadmin, (tx, p) => remindOwner(tx, p, A.lateBlocked))).rejects.toThrow(/forbidden/i);
    await expect(svc(U.other, (tx, p) => remindOwner(tx, p, A.lateBlocked))).rejects.toThrow(/not found|forbidden/i);
    const told = await owner.query(`SELECT user_id FROM notifications WHERE kind = 'follow_up.reminder' AND entity_id = $1`, [A.late]);
    expect(told.rows).toEqual([{ user_id: U.own }]);
  });
});

describe("the Projects table (firm)", () => {
  it("has Oversight's columns as counts, each equal to its list on Actions, and no health word (D5)", async () => {
    const rows = (await svc(U.lead, (tx, p) => projectsTable(tx, p)))!;
    expect(rows.map((r) => r.projectId).sort()).toEqual([P.acme, P.closed].sort());
    const acme = rows.find((r) => r.projectId === P.acme)!;
    expect(acme).toMatchObject({ open: 11, late: 3, blocked: 2, lead: "lead", mode: "full" });
    expect(acme.oldestReviewDays).toBe(10);
    expect(acme).not.toHaveProperty("signal");
    expect(acme.late).toBe((await board(U.lead, { filter: "late", project: P.acme })).total);
    expect(acme.blocked).toBe((await board(U.lead, { filter: "blocked", project: P.acme })).total);
    // A closed project has nothing open to count.
    expect(rows.find((r) => r.projectId === P.closed)).toMatchObject({ open: null, late: null, blocked: null, oldestReviewDays: null });
    // The client's last activity: one of its people did something.
    await owner.query(`INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event) VALUES ($1,$2,$3,'action',$4,'progress')`, [
      P.acme,
      ACME,
      U.own,
      A.late,
    ]);
    const again = (await svc(U.lead, (tx, p) => projectsTable(tx, p)))!.find((r) => r.projectId === P.acme)!;
    expect(again.clientLastActive).toBeInstanceOf(Date);
  });

  it("is the whole firm for the admin, only their own for another consultant, and nothing for a client", async () => {
    expect((await svc(U.admin, (tx, p) => projectsTable(tx, p)))!.map((r) => r.projectId).sort()).toEqual([P.acme, P.closed, P.beta].sort());
    const beta = (await svc(U.other, (tx, p) => projectsTable(tx, p)))!;
    expect(beta.map((r) => [r.projectId, r.late])).toEqual([[P.beta, 1]]);
    expect(await svc(U.cadmin, (tx, p) => projectsTable(tx, p))).toBeNull();
    expect(await svc(U.own, (tx, p) => projectsTable(tx, p))).toBeNull();
  });
});
