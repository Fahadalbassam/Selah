// Batch 3 (page audit 4.3, U02, U06, U13; decision D2: Trace goes): the
// project page for every reader and every kind of project, against a real
// Postgres. Each reader gets the tabs that hold something they may open; what
// each old tab held still has a place; the status line's counts and the rule
// chips' counts equal the Actions lists they stand for; the evidence and the
// review result on an opened action row, and the firm's consultants on a
// client's People tab, are only what the reader may open (D6 drafts, D8
// departments, 1b owners). Nothing here reads for anyone else.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { parseActionsQuery, type ActionsQuery } from "@/lib/action-filters";
import { ACTION_RULES } from "@/lib/plan-rules";
import { OLD_TABS, oldTabTarget, openTab } from "@/lib/project-tabs";
import { actionBoard } from "@/services/action-board";
import { projectProgress } from "@/services/follow-through";
import { loadPrincipal } from "@/services/principal";
import { loadProjectPage } from "@/services/project-page";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-b3a0-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2); // full, departments on: Legal and Finance
const U = {
  admin: id(11), // firm admin
  lead: id(12), // Acme's lead consultant, staffed on the main project
  cons: id(13), // staffed on the main project
  obs: id(14), // observes the main project
  cadmin: id(15), // Acme's client admin
  mgr: id(16), // Acme manager, Legal only, on the main project
  own: id(17), // Acme action owner, Legal, on the main project
};
const P = { main: id(21), internal: id(22), pitch: id(23), closing: id(24) };
const DEPT = { legal: id(25), fin: id(26) };
const R = { plan: id(31), disputed: id(32), closing: id(33) };
const A = {
  late: id(41), // own, in progress, late (Legal)
  review: id(42), // own, waiting for review for 10 days, one file sent (Legal)
  done: id(43), // own, verified, one file, accepted (Legal)
  blocked: id(44), // mgr, blocked (Legal)
  finance: id(45), // cadmin, blocked and late (Finance): no Legal reader sees it
  draft: id(46), // own, the firm's draft (D6)
  churn: id(47), // own, sent back twice (Legal)
  closingOpen: id(48), // on the closing project
};
const DOC = { review: id(51), done: id(52), finance: id(53), firmOnly: id(54) };
const FAR = id(18); // a consultant on Acme's team, staffed on the closing project only
const NAME = Object.fromEntries(Object.entries(A).map(([k, v]) => [v, k]));

async function as<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    return await fn(c);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}
const svc = <T>(userId: string, fn: (tx: Tx, p: Principal) => Promise<T>) =>
  as(userId, async (c) => {
    const tx = drizzle(c, { schema }) as unknown as Tx;
    return fn(tx, (await loadPrincipal(tx, userId))!);
  });
const page = (userId: string, projectId = P.main) => svc(userId, (tx, p) => loadProjectPage(tx, p, projectId));
const q = (over: Partial<ActionsQuery>): ActionsQuery => ({ ...parseActionsQuery({}), ...over });
const names = (ids: string[]) => ids.map((x) => NAME[x] ?? x).sort();

beforeAll(async () => {
  const x = (text: string, params: unknown[] = []) => owner.query(text, params);
  await x(`TRUNCATE "user", organizations CASCADE`);
  await x(`INSERT INTO organizations (id, kind, name, engagement_mode, departments_enabled) VALUES ($1,'firm','Mizan Advisory',NULL,false), ($2,'client','Acme','full',true)`, [FIRM, ACME]);
  await x(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await x(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await x(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$8,'firm_admin'), ($2,$8,'consultant'), ($3,$8,'consultant'), ($4,$8,'consultant'),
      ($5,$9,'client_admin'), ($6,$9,'client_manager'), ($7,$9,'action_owner')`,
    [U.admin, U.lead, U.cons, U.obs, U.cadmin, U.mgr, U.own, FIRM, ACME],
  );
  await x(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($1,$3,false), ($1,$4,false)`, [ACME, U.lead, U.cons, U.obs]);
  await x(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$3,'الشؤون القانونية','Legal'), ($2,$3,'المالية','Finance')`, [DEPT.legal, DEPT.fin, ACME]);
  await x(`INSERT INTO department_members (department_id, user_id) VALUES ($1,$2), ($1,$3)`, [DEPT.legal, U.mgr, U.own]);
  await x(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$5,$6,'Acme governance','active',$7), ($2,'internal',$6,$6,'Firm methodology','active',$7),
      ($3,'client',$5,$6,'Acme pitch','draft',$7), ($4,'client',$5,$6,'Acme phase one','closing',$7)`,
    [P.main, P.internal, P.pitch, P.closing, ACME, FIRM, U.admin],
  );
  await x(
    `INSERT INTO project_members (project_id, user_id, observer, is_lead) VALUES
      ($1,$3,false,true), ($1,$4,false,false), ($1,$5,true,false), ($1,$6,false,false), ($1,$7,false,false),
      ($2,$3,false,true), ($8,$3,false,true), ($8,$7,false,false)`,
    [P.main, P.internal, U.lead, U.cons, U.obs, U.mgr, U.own, P.closing],
  );
  await x(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES
      ($1,$4,$6,'Adopt a board charter','shared',$7), ($2,$4,$6,'Publish a conflicts register','shared',$7), ($3,$5,$6,'Phase one plan','shared',$7)`,
    [R.plan, R.disputed, R.closing, P.main, P.closing, ACME, U.lead],
  );
  // The company disagrees with one recommendation.
  await x(`INSERT INTO recommendation_responses (project_id, org_id, recommendation_id, stance, reason, recorded_by) VALUES ($1,$2,$3,'disagree','Not now',$4)`, [
    P.main,
    ACME,
    R.disputed,
    U.cadmin,
  ]);
  const act = (aid: string, title: string, who: string, status: string, due: number, dept: string | null, rec = R.plan, pid = P.main) =>
    x(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, created_by, due_date, department_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,app_firm_today() + $9::int,$10)`,
      [aid, pid, ACME, rec, title, who, status, U.lead, due, dept],
    );
  await act(A.late, "Late canary", U.own, "in_progress", -10, DEPT.legal);
  await act(A.review, "Review canary", U.own, "awaiting_review", 10, DEPT.legal);
  await act(A.done, "Verified canary", U.own, "verified_complete", -20, DEPT.legal);
  await act(A.blocked, "Blocked canary", U.mgr, "blocked", 10, DEPT.legal);
  await act(A.finance, "Finance canary", U.cadmin, "blocked", -3, DEPT.fin);
  await act(A.draft, "Draft canary", U.own, "draft", -10, DEPT.legal);
  await act(A.churn, "Churn canary", U.own, "revision_requested", 10, DEPT.legal, R.disputed);
  await act(A.closingOpen, "Closing canary", U.own, "in_progress", 10, DEPT.legal, R.closing, P.closing);
  await x(`UPDATE actions SET awaiting_review_at = now() - interval '10 days' WHERE id = $1`, [A.review]);
  // Files sent: one waiting for review, one accepted, one in Finance.
  for (const [doc, aid, title] of [
    [DOC.review, A.review, "Signed charter"],
    [DOC.done, A.done, "Board minutes"],
    [DOC.finance, A.finance, "Finance canary file"],
  ] as const) {
    await x(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, title, storage_key, content_type, size_bytes, sha256, visibility, state, department_id)
       VALUES ($1,$2,$3,$3,$4,'evidence',$5,$7,'text/plain',1,$7,'shared','submitted',$6)`,
      [doc, P.main, ACME, U.own, title, aid === A.finance ? DEPT.fin : DEPT.legal, `k-${doc}`],
    );
    await x(`INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by) VALUES ($1,$2,$3,$4,$5)`, [P.main, ACME, aid, doc, U.own]);
  }
  // A firm-only file sent for an action every Legal reader may open: the action shows, the file does not (review item 6).
  await x(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, title, storage_key, content_type, size_bytes, sha256, visibility, state, department_id)
     VALUES ($1,$2,$3,$4,$5,'evidence','Firm-only file canary',$6,'text/plain',1,$6,'firm_private','submitted',$7)`,
    [DOC.firmOnly, P.main, ACME, FIRM, U.lead, `k-${DOC.firmOnly}`, DEPT.legal],
  );
  await x(`INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by) VALUES ($1,$2,$3,$4,$5)`, [P.main, ACME, A.late, DOC.firmOnly, U.own]);
  // A consultant on the client's team, staffed on the closing project only (review item 6).
  await x(`INSERT INTO "user" (id, name, email) VALUES ($1,'elsewhere','elsewhere@example.test')`, [FAR]);
  await x(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,'consultant')`, [FAR, FIRM]);
  await x(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,false)`, [ACME, FAR]);
  await x(`INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,false)`, [P.closing, FAR]);
  await x(`INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'accept')`, [P.main, ACME, A.done, U.lead]);
  for (let i = 0; i < 2; i++)
    await x(`INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome, reason) VALUES ($1,$2,$3,$4,'revise','Again')`, [P.main, ACME, A.churn, U.lead]);
  // The closing project has its closing record.
  await x(`INSERT INTO project_closures (project_id, org_id, started_by) VALUES ($1,$2,$3)`, [P.closing, ACME, U.admin]);
});
afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("the tabs, per reader and kind of project", () => {
  const FIVE = ["plan", "files", "meetings", "progress", "people"];

  it("an active client project: the five for the firm, the client admin and a manager; no Closing before it is needed", async () => {
    for (const who of [U.admin, U.lead, U.cons, U.obs, U.cadmin, U.mgr]) expect((await page(who)).tabs, NAME[who] ?? who).toEqual(FIVE);
  });

  it("an action owner reads no project numbers, so has no Progress; Plan, files and People are theirs", async () => {
    const t = (await page(U.own)).tabs;
    expect(t).not.toContain("progress");
    expect(t).not.toContain("closing");
    for (const tab of ["plan", "files", "people"]) expect(t).toContain(tab);
  });

  it("an internal project: no requests (files only), no Closing until it closes", async () => {
    const p = await page(U.lead, P.internal);
    expect(p.requests).toBeNull();
    expect(p.tabs).toEqual(["plan", "files", "meetings", "progress", "people"]);
  });

  it("a pitch has no Closing, and no client reader opens it", async () => {
    const p = await page(U.admin, P.pitch);
    expect(p.closure).toBeNull();
    expect(p.tabs).not.toContain("closing");
    await expect(page(U.cadmin, P.pitch)).rejects.toThrow();
  });

  it("a closing project gets Closing for the firm and for the client's people on it", async () => {
    for (const who of [U.admin, U.lead, U.cadmin, U.own]) expect((await page(who, P.closing)).tabs, NAME[who] ?? who).toContain("closing");
  });

  it("a declined request to close on an active project gives nobody a Closing tab; its history is in the activity record", async () => {
    await owner.query(
      `INSERT INTO project_closure_requests (project_id, org_id, requested_by, note, status, decided_by, decided_at, reply)
       VALUES ($1,$2,$3,'We are done','declined',$4, now(),'Two actions are still open')`,
      [P.main, ACME, U.cadmin, U.admin],
    );
    try {
      for (const who of [U.admin, U.lead, U.cadmin, U.mgr, U.own]) expect((await page(who)).tabs, NAME[who] ?? who).not.toContain("closing");
      for (const who of [U.admin, U.cadmin]) {
        const events = (await page(who)).data.activity!.filter((e) => e.entityType === "closure_request").map((e) => e.event);
        expect(events.sort(), NAME[who] ?? who).toEqual(["declined", "requested"]);
      }
    } finally {
      await owner.query(`DELETE FROM project_closure_requests WHERE project_id = $1`, [P.main]);
    }
  });

  it("an active project offers the closing steps from the page's menu instead of a tab", async () => {
    expect((await page(U.admin)).closure?.can.start).toBe(true);
    expect((await page(U.cadmin)).closure?.can.request).toBe(true);
  });
});

describe("nothing moved is lost: each old tab's content has its new place", () => {
  it("Activity is on Progress for the firm and the client admin, and nobody else gets it", async () => {
    for (const who of [U.admin, U.cadmin]) {
      const p = await page(who);
      expect(p.data.activity, NAME[who]).not.toBeNull();
      expect(p.tabs).toContain("progress");
    }
    for (const who of [U.mgr, U.own]) expect((await page(who)).data.activity).toBeNull();
  });

  it("Assessments: the firm's on Plan (Sources), the client's shared ones on Requests and files", async () => {
    expect((await page(U.lead)).assessments).not.toBeNull();
    expect((await page(U.cadmin)).assessments).not.toBeNull();
  });

  it("Requests and Documents are one tab every reader has", async () => {
    for (const who of [U.admin, U.cadmin, U.mgr, U.own]) {
      const p = await page(who);
      expect(p.tabs).toContain("files");
      expect(p.requests, NAME[who]).not.toBeNull();
    }
  });

  it("Team is People for both sides; a client reader also reads the firm's consultants on the project, never an observer", async () => {
    const firm = await page(U.admin);
    expect(firm.team).not.toBeNull();
    expect(firm.consultants).toBeNull();
    for (const who of [U.cadmin, U.mgr, U.own]) {
      const c = (await page(who)).consultants!;
      expect(c.lead?.userId, NAME[who]).toBe(U.lead);
      expect(c.staffed.map((s) => s.userId)).toEqual([U.cons]);
    }
  });

  it("Needs attention is the firm's rule chips on Plan; a client reader gets late and blocked only", async () => {
    expect(Object.keys((await page(U.lead)).attention.rules).sort()).toEqual(
      ["late", "blocked", "no-activity", "date-moved", "sent-back", "no-owner", "waiting-long", "disputed"].sort(),
    );
    for (const who of [U.cadmin, U.mgr, U.own]) expect(Object.keys((await page(who)).attention.rules).sort(), NAME[who]).toEqual(["blocked", "late"]);
  });

  it("Trace's evidence and review result are on the opened action row, for whoever may open the action", async () => {
    for (const who of [U.lead, U.cadmin, U.mgr, U.own]) {
      const ev = (await page(who)).evidence;
      expect(ev[A.review]!.evidence.map((e) => e.title), NAME[who]).toEqual(["Signed charter"]);
      expect(ev[A.review]!.review).toBeNull();
      expect(ev[A.done]!.review?.outcome).toBe("accept");
      expect(ev[A.churn]!.review?.outcome).toBe("revise");
    }
  });
});

describe("old tab addresses, per reader", () => {
  it("each old tab goes to a tab this reader has; Assessments by side (Sources for the firm, Requests and files for the client)", async () => {
    for (const who of [U.admin, U.lead, U.obs, U.cadmin, U.mgr, U.own]) {
      const firm = (await svc(who, async (_tx, p) => p.orgKind)) === "firm";
      const tabs = (await page(who)).tabs;
      for (const old of Object.keys(OLD_TABS)) {
        const to = oldTabTarget(old, firm)!;
        // Activity goes to Progress, which an action owner does not have: the page then opens Plan.
        expect(openTab(to, tabs), `${who} ${old}`).toBe(tabs.includes(to) ? to : "plan");
      }
      expect(oldTabTarget("assessments", firm), who).toBe(firm ? "plan" : "files");
    }
  });
});

describe("the status line and the rule chips equal their lists", () => {
  it("count this project only: the closing project's open action is not in the main project's numbers", async () => {
    const p = await page(U.lead);
    expect(JSON.stringify(p.attention)).not.toContain(A.closingOpen);
    expect(JSON.stringify((await page(U.lead, P.closing)).attention.reasons)).not.toContain(A.late);
  });

  it("late and waiting for review are the Actions lists for this project, for every reader", async () => {
    for (const who of [U.admin, U.lead, U.obs, U.cadmin, U.mgr, U.own]) {
      const s = (await page(who)).attention.status;
      const late = await svc(who, (tx, p) => actionBoard(tx, p, q({ filter: "late", project: P.main })));
      const waiting = await svc(who, (tx, p) => actionBoard(tx, p, q({ filter: "awaiting-review", project: P.main })));
      expect(s.late.n, NAME[who]).toBe(late.total);
      expect(s.waiting.n, NAME[who]).toBe(waiting.total);
      expect(s.late.href).toBe(`/actions?filter=late&project=${P.main}`);
      expect(s.waiting.href).toBe(`/actions?filter=awaiting-review&project=${P.main}`);
    }
  });

  it("the share verified is the Progress tab's own number", async () => {
    for (const who of [U.admin, U.cadmin]) {
      const s = (await page(who)).attention.status;
      const pr = await svc(who, (tx, p) => projectProgress(tx, p, P.main));
      expect(s.verified).toBe(pr.verified);
      expect(s.pct).toBe(pr.implementedPct);
    }
  });

  it("each chip holds exactly the actions of its Actions filter", async () => {
    for (const who of [U.lead, U.cadmin, U.mgr, U.own]) {
      const rules = (await page(who)).attention.rules;
      for (const rule of ACTION_RULES) {
        if (!rules[rule]) continue;
        const b = await svc(who, (tx, p) => actionBoard(tx, p, q({ filter: rule, project: P.main })));
        expect(names(rules[rule]!), `${NAME[who]} ${rule}`).toEqual(names(b.rows.map((r) => r.id)));
      }
      if (rules["waiting-long"]) {
        const b = await svc(who, (tx, p) => actionBoard(tx, p, q({ filter: "awaiting-review", waitingLong: true, project: P.main })));
        expect(names(rules["waiting-long"])).toEqual(names(b.rows.map((r) => r.id)));
      }
    }
  });

  it("names the firm's rules for the firm: sent back twice, a review waiting over 7 days, the disputed recommendation", async () => {
    const r = (await page(U.lead)).attention.rules;
    expect(names(r["sent-back"]!)).toEqual(["churn"]);
    expect(names(r["waiting-long"]!)).toEqual(["review"]);
    expect(r.disputed).toEqual([R.disputed]);
    expect(names(r.late!)).toEqual(["finance", "late"]);
  });
});

describe("only what the reader may open", () => {
  it("a manager limited to Legal: no Finance action, file or count anywhere on the page (D8)", async () => {
    const p = await page(U.mgr);
    const all = JSON.stringify(p);
    expect(all).not.toContain("Finance canary");
    expect(all).not.toContain(A.finance);
    expect(p.attention.status.late.n).toBe(1);
  });

  it("an action owner: only their own actions, counts and files (1b)", async () => {
    const p = await page(U.own);
    const shown = p.data.recommendations.flatMap((r) => r.actions.map((a) => a.id));
    expect(names(shown)).toEqual(["churn", "done", "late", "review"]);
    expect(JSON.stringify(p)).not.toContain("Blocked canary");
    expect(names(p.attention.rules.blocked!)).toEqual([]);
    expect(Object.keys(p.evidence).map((x) => NAME[x]).sort()).toEqual(["churn", "done", "late", "review"]);
  });

  it("no client reader sees the firm's draft (D6)", async () => {
    for (const who of [U.cadmin, U.mgr, U.own]) expect(JSON.stringify(await page(who)), NAME[who]).not.toContain("Draft canary");
    // The firm sees it on the plan, and it counts toward nothing.
    const firm = await page(U.lead);
    expect(JSON.stringify(firm.data)).toContain("Draft canary");
    expect(firm.attention.rules.late).not.toContain(A.draft);
  });

  it("an opened action row the reader may open lists only the files they may open (a firm-only file stays the firm's)", async () => {
    const firm = (await page(U.lead)).evidence[A.late]!.evidence.map((e) => e.title);
    expect(firm).toEqual(["Firm-only file canary"]);
    for (const who of [U.cadmin, U.mgr, U.own]) {
      const p = await page(who);
      expect(p.data.recommendations.flatMap((r) => r.actions.map((a) => a.id)), who).toContain(A.late);
      expect(p.evidence[A.late]!.evidence, who).toEqual([]);
      expect(JSON.stringify(p), who).not.toContain("Firm-only file canary");
    }
  });

  it("a consultant staffed on another project of the same client is named there, not here", async () => {
    for (const who of [U.cadmin, U.own]) {
      expect((await page(who)).consultants!.staffed.map((s) => s.userId), who).toEqual([U.cons]);
      expect((await page(who, P.closing)).consultants!.staffed.map((s) => s.userId), who).toEqual([FAR]);
    }
  });

  it("the client admin may add a file on the project's Requests and files tab", async () => {
    expect((await page(U.cadmin)).upload?.id).toBe(P.main);
  });
});
