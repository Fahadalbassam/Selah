// The home page per role (page audit 4.2, batch 2; decision D2: Today became
// the home) against a real Postgres: each home lists exactly what its reader
// may open, firm admin, lead, staffed consultant, observer, client admin,
// department-limited manager and action owner; the firm's counters equal the
// lists their Actions filters stand for; and nothing hidden is named or
// counted (D6 drafts, D8 departments, 1b action owners, the picker).
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { clientHome, firmCounters, firmHome, home, ownerHome } from "@/services/home";
import { loadPrincipal } from "@/services/principal";
import { listActions } from "@/services/queries";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-b02e-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2); // full, departments on: HR and Finance
const OTHER = id(3);
const U = {
  admin: id(11), // firm admin, follows nothing
  lead: id(12), // Acme's lead consultant: every Acme project
  cons: id(13), // staffed on Acme's first project; gave the first sign-off on one review
  observer: id(14), // observes Acme's first project
  stranger: id(15), // staffed on the other client only; asks to join Acme
  cadmin: id(16), // Acme's client admin
  mgr: id(17), // Acme's client manager, in HR only, on the first project
  doer: id(18), // Acme's action owner, on the first project, in HR
  doer2: id(19), // another action owner, in Finance
};
const DEPT = { hr: id(21), fin: id(22) };
const P = { one: id(31), two: id(32), other: id(33) };
const R = { shared: id(41), disputed: id(42), firm: id(43), other: id(44) };
const A = {
  late: id(51), // doer, in progress, late (HR)
  sentBack: id(52), // doer, revision requested (HR)
  waiting: id(53), // doer, awaiting review (HR)
  done: id(54), // doer, verified (HR)
  fresh: id(55), // doer, assigned, due later (HR)
  draft: id(56), // doer, the firm's draft (D6)
  finance: id(57), // doer2, blocked and late (Finance): no HR reader sees it
  mgrStopped: id(58), // mgr, blocked (HR)
  signed: id(59), // doer, awaiting review; cons gave the first of two sign-offs
  other: id(60), // the other client, late
  slow: id(65), // doer, awaiting review for ten days
};
const DOC = { doer: id(61), mgr: id(62), cadmin: id(63), finance: id(64) };
const M = { whole: id(71), hr: id(72), finance: id(73) };
let n = 100;
const next = () => id(++n);

async function svc<R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>): Promise<R> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    const tx = drizzle(c, { schema }) as unknown as Tx;
    return await fn(tx, (await loadPrincipal(tx, userId))!);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

/** Every action id a home names, wherever it is. */
const titles = (x: unknown) => JSON.stringify(x);

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`TRUNCATE support_requests, inquiries CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode, departments_enabled) VALUES ($1,'firm','firm',NULL,false), ($2,'client','Acme','full',true), ($3,'client','Other','full',false)`,
    [FIRM, ACME, OTHER],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$10,'firm_admin'), ($2,$10,'consultant'), ($3,$10,'consultant'), ($4,$10,'consultant'), ($5,$10,'consultant'),
      ($6,$11,'client_admin'), ($7,$11,'client_manager'), ($8,$11,'action_owner'), ($9,$11,'action_owner')`,
    [U.admin, U.lead, U.cons, U.observer, U.stranger, U.cadmin, U.mgr, U.doer, U.doer2, FIRM, ACME],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($1,$3,false), ($1,$4,false), ($5,$6,true)`, [
    ACME,
    U.lead,
    U.cons,
    U.observer,
    OTHER,
    U.stranger,
  ]);
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$3,'الموارد البشرية','HR'), ($2,$3,'المالية','Finance')`, [DEPT.hr, DEPT.fin, ACME]);
  await q(`INSERT INTO department_members (department_id, user_id) VALUES ($1,$3), ($1,$4), ($2,$5)`, [DEPT.hr, DEPT.fin, U.mgr, U.doer, U.doer2]);
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$4,$6,'Acme phase 1','active',$7), ($2,'client',$4,$6,'Acme phase 2','closing',$7), ($3,'client',$5,$6,'Other work','active',$7)`,
    [P.one, P.two, P.other, ACME, OTHER, FIRM, U.admin],
  );
  await q(
    `INSERT INTO project_members (project_id, user_id, observer) VALUES
      ($1,$3,false), ($1,$4,true), ($1,$5,false), ($1,$6,false), ($1,$7,false), ($2,$8,false)`,
    [P.one, P.other, U.cons, U.observer, U.mgr, U.doer, U.doer2, U.stranger],
  );
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES
      ($1,$5,$6,'Form the audit committee','shared',$8), ($2,$5,$6,'Publish a conflicts register','shared',$8),
      ($3,$5,$6,'Firm working note','firm_private',$8), ($4,$7,$9,'Other plan','shared',$8)`,
    [R.shared, R.disputed, R.firm, R.other, P.one, ACME, P.other, U.lead, OTHER],
  );
  // The company disagreed with one recommendation; the other still waits for its answer.
  await q(`INSERT INTO recommendation_responses (project_id, org_id, recommendation_id, stance, reason, recorded_by) VALUES ($1,$2,$3,'disagree','Not now',$4)`, [
    P.one,
    ACME,
    R.disputed,
    U.cadmin,
  ]);
  const action = (aid: string, title: string, ownerId: string, status: string, due: string, dept: string | null, project = P.one, org = ACME, rec = R.shared) =>
    q(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, department_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,${due},$8,$9)`,
      [aid, project, org, rec, title, ownerId, status, dept, U.lead],
    );
  await action(A.late, "Draft the HR policy", U.doer, "in_progress", "app_firm_today() - 5", DEPT.hr);
  await action(A.sentBack, "Upload the signed charter", U.doer, "revision_requested", "app_firm_today() + 20", DEPT.hr);
  await action(A.waiting, "Collect the job descriptions", U.doer, "awaiting_review", "app_firm_today() + 30", DEPT.hr);
  await action(A.done, "Name the HR lead", U.doer, "verified_complete", "app_firm_today() - 30", DEPT.hr);
  await action(A.fresh, "Plan the training", U.doer, "assigned", "app_firm_today() + 40", DEPT.hr);
  await action(A.draft, "Secret draft for HR", U.doer, "draft", "app_firm_today() - 2", DEPT.hr);
  await action(A.finance, "Finance canary title", U.doer2, "blocked", "app_firm_today() - 3", DEPT.fin);
  await action(A.mgrStopped, "Agree the pay scales", U.mgr, "blocked", "app_firm_today() + 10", DEPT.hr);
  await action(A.signed, "Review the org design", U.doer, "awaiting_review", "app_firm_today() + 15", DEPT.hr);
  await action(A.other, "Other client's late work", U.stranger, "in_progress", "app_firm_today() - 4", null, P.other, OTHER, R.other);
  await action(A.slow, "Map the salary bands", U.doer, "awaiting_review", "app_firm_today() + 12", DEPT.hr);
  await q(`UPDATE actions SET awaiting_review_at = now() - interval '10 days' WHERE id = $1`, [A.slow]);
  // Two sign-offs on one review; cons gave the first.
  await q(`INSERT INTO review_signoffs (project_id, org_id, action_id, reviewer_id) VALUES ($1,$2,$3,$4)`, [P.one, ACME, A.signed, U.cons]);
  await q(`UPDATE actions SET second_review = true WHERE id = $1`, [A.signed]);

  // Date requests: one waiting (beside the due date), one the manager's, answered yesterday.
  await q(`INSERT INTO deadline_change_requests (project_id, org_id, action_id, requested_by, proposed_due_date, reason) VALUES ($1,$2,$3,$4,app_firm_today() + 25,'Board')`, [
    P.one,
    ACME,
    A.late,
    U.doer,
  ]);
  await q(
    `INSERT INTO deadline_change_requests (project_id, org_id, action_id, requested_by, proposed_due_date, reason, status, decided_by, decided_at)
     VALUES ($1,$2,$3,$4,app_firm_today() + 30,'Budget','approved',$5, now() - interval '1 day')`,
    [P.one, ACME, A.mgrStopped, U.mgr, U.lead],
  );

  // Files asked of each person by name; one in Finance's name.
  for (const [rid, who, title] of [
    [DOC.doer, U.doer, "HR org chart"],
    [DOC.mgr, U.mgr, "Pay scale sheet"],
    [DOC.cadmin, U.cadmin, "Commercial register"],
    [DOC.finance, U.doer2, "Finance canary file"],
  ] as const) {
    await q(`INSERT INTO info_requests (id, project_id, org_id, area, title, owner_user_id, due_date, created_by) VALUES ($1,$2,$3,'people',$4,$5,app_firm_today() + 7,$6)`, [
      rid,
      P.one,
      ACME,
      title,
      who,
      U.lead,
    ]);
  }

  // Meetings to come: the whole project (the owner, the manager and the admin invited), HR's, Finance's.
  for (const [mid, title, dept, at] of [
    [M.whole, "Steering committee", null, "2 days"],
    [M.hr, "HR workshop", DEPT.hr, "3 days"],
    [M.finance, "Finance canary meeting", DEPT.fin, "4 days"],
  ] as const) {
    await q(
      `INSERT INTO meetings (id, project_id, org_id, kind, title, starts_at, ends_at, location, organizer_id, ics_uid, department_id)
       VALUES ($1,$2,$3,'status',$4, now() + $5::interval, now() + $5::interval + interval '1 hour','in_person',$6,$8,$7)`,
      [mid, P.one, ACME, title, at, U.lead, dept, `home-${mid}`],
    );
  }
  await q(
    `INSERT INTO meeting_attendees (meeting_id, user_id, response) VALUES
      ($1,$4,'needs_action'), ($1,$5,'needs_action'), ($1,$6,'accepted'), ($2,$5,'needs_action'), ($3,$7,'needs_action'), ($1,$8,'needs_action')`,
    [M.whole, M.hr, M.finance, U.doer, U.mgr, U.cadmin, U.doer2, U.cons],
  );
  // The client admin has already said she will attend.
  await q(`UPDATE meeting_attendees SET response = 'accepted' WHERE meeting_id = $1 AND user_id = $2`, [M.whole, U.cadmin]);
  await q(`INSERT INTO follow_ups (project_id, org_id, meeting_id, title, due_at, assignee_user_id, created_by) VALUES ($1,$2,$3,'Send the HR minutes', now() - interval '1 day',$4,$5)`, [
    P.one,
    ACME,
    M.hr,
    U.doer,
    U.lead,
  ]);
  await q(`INSERT INTO follow_ups (project_id, org_id, meeting_id, title, due_at, assignee_user_id, created_by) VALUES ($1,$2,$3,'Share the pay data', now() + interval '3 days',$4,$5)`, [
    P.one,
    ACME,
    M.hr,
    U.mgr,
    U.lead,
  ]);

  // Phase 2 is closing with every step done: it waits for the admin's final close.
  const closure = next();
  await q(`INSERT INTO project_closures (id, project_id, org_id, started_by) VALUES ($1,$2,$3,$4)`, [closure, P.two, ACME, U.admin]);
  await q(`INSERT INTO project_closure_lessons (closure_id, project_id, org_id, went_well, to_improve) VALUES ($1,$2,$3,'Pace','Scope')`, [closure, P.two, ACME]);

  // The firm admin's: a join request, a message from a client, a new inquiry.
  await q(`INSERT INTO join_requests (client_org_id, user_id, reason) VALUES ($1,$2,'I know the sector')`, [ACME, U.stranger]);
  await q(`INSERT INTO support_requests (firm_org_id, org_id, user_id, body) VALUES ($1,$2,$3,'The upload button does nothing')`, [FIRM, ACME, U.cadmin]);
  await q(
    `INSERT INTO inquiries (firm_org_id, public_ref, org_name, org_name_ar, cr_number, contact_name, contact_role, contact_email, contact_phone, message,
       sector_id, employee_band, ownership_type, self_check, privacy_notice_version, consented_at, preferred_language)
     VALUES ($1,'INQ-HOME-1','Najd Trading','نجد للتجارة','1010999999','Majed','CEO','majed@example.test','+966 55 111 1111','We need a board',
       (SELECT id FROM sectors LIMIT 1),'50-249','family_multi_partner','{}','2026-10-20',now(),'ar')`,
    [FIRM],
  );
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("the firm home", () => {
  it("gives the firm admin the decisions only an admin takes from every client, the messages from clients and the new inquiries", async () => {
    const h = await svc(U.admin, (tx, p) => firmHome(tx, p));
    expect(new Set(h.decisions.map((d) => d.kind))).toEqual(new Set(["join_request", "ready_to_close"]));
    expect(h.decisions.find((d) => d.kind === "ready_to_close")).toMatchObject({ id: P.two, href: `/projects/${P.two}?tab=closing` });
    expect(h.problems.map((r) => r.body)).toEqual(["The upload button does nothing"]);
    expect(h.inquiries.map((r) => r.publicRef)).toEqual(["INQ-HOME-1"]);
    // Late work and reviews come from the clients the admin follows: none yet.
    expect(h.reviews).toEqual([]);
    expect(h.due).toEqual([]);
  });

  it("gives the client's lead the reviews he may give, the late work, and the disputed recommendation; not the admin's", async () => {
    const h = await svc(U.lead, (tx, p) => firmHome(tx, p));
    expect(new Set(h.reviews.map((r) => r.id))).toEqual(new Set([A.waiting, A.signed, A.slow]));
    expect(h.due.map((r) => r.id)).toEqual(expect.arrayContaining([A.late, A.finance]));
    expect(h.due.map((r) => r.id)).not.toContain(A.draft);
    // The owner's date request is the lead's to decide too.
    expect(new Set(h.decisions.map((d) => d.kind))).toEqual(new Set(["join_request", "deadline_request", "disputed"]));
    expect(h.decisions.find((d) => d.kind === "disputed")).toMatchObject({ id: R.disputed, href: `/recommendations/${R.disputed}` });
    expect(h.problems).toEqual([]);
    expect(h.inquiries).toEqual([]);
  });

  it("gives a staffed consultant the late work on his project, and not the review whose first sign-off he gave", async () => {
    const h = await svc(U.cons, (tx, p) => firmHome(tx, p));
    expect(new Set(h.reviews.map((r) => r.id))).toEqual(new Set([A.waiting, A.slow]));
    expect(h.due.map((r) => r.id)).toEqual(expect.arrayContaining([A.late, A.finance]));
    expect(h.decisions.map((d) => d.kind)).toEqual(["disputed"]);
    expect(h.meetings.map((m) => m.id)).toEqual([M.whole]);
    expect(h.inquiries).toEqual([]);
  });

  it("gives an observer nothing to review or decide, and nothing from projects he does not observe", async () => {
    const h = await svc(U.observer, (tx, p) => firmHome(tx, p));
    expect(h.reviews).toEqual([]);
    expect(h.decisions.filter((d) => d.kind !== "disputed")).toEqual([]);
    for (const row of [...h.due, ...h.followUps, ...h.meetings, ...h.visits]) expect(row.projectId).toBe(P.one);
  });

  it("gives a consultant of another client nothing of Acme", async () => {
    const h = await svc(U.stranger, (tx, p) => firmHome(tx, p));
    expect(titles(h)).not.toMatch(/Acme|HR policy|canary|audit committee/);
    expect(h.due.map((r) => r.id)).toEqual([A.other]);
  });

  it("counts each counter by the rule of the Actions filter it opens, over every action the reader may open", async () => {
    const day = (await owner.query(`SELECT app_firm_today()::text AS d`)).rows[0].d as string;
    const states = new Map((await owner.query(`SELECT id, state::text AS state FROM projects`)).rows.map((r) => [r.id, r.state]));
    const since = new Map((await owner.query(`SELECT id, awaiting_review_at FROM actions`)).rows.map((r) => [r.id, r.awaiting_review_at as Date | null]));
    const open = ["assigned", "in_progress", "blocked", "awaiting_review", "revision_requested"];
    for (const who of [U.admin, U.lead, U.cons, U.observer, U.stranger]) {
      const [counters, rows] = await svc(who, async (tx, p) => [await firmCounters(tx, p), await listActions(tx, p)] as const);
      // The Actions list's own reader, then each filter's rule.
      const live = rows.filter((r) => open.includes(r.status) && states.get(r.projectId) !== "closed");
      const review = live.filter((r) => r.status === "awaiting_review");
      const long = (aid: string) => {
        const at = since.get(aid);
        return !!at && Math.floor((Date.now() - at.getTime()) / 86_400_000) > 7;
      };
      expect(counters, who).toEqual({
        late: live.filter((r) => r.dueDate !== null && r.dueDate < day).length,
        awaitingReview: review.length,
        reviewWaiting: review.filter((r) => long(r.id)).length,
        blocked: live.filter((r) => r.status === "blocked").length,
      });
    }
    // The admin's counters cover every client and leave the draft out; the stranger's only his own client.
    expect(await svc(U.admin, (tx, p) => firmCounters(tx, p))).toEqual({ late: 3, awaitingReview: 3, reviewWaiting: 1, blocked: 2 });
    expect(await svc(U.stranger, (tx, p) => firmCounters(tx, p))).toEqual({ late: 1, awaitingReview: 0, reviewWaiting: 0, blocked: 0 });
  });
});

describe("the client admin's and client manager's home", () => {
  it("gives the client admin the recommendation waiting for the company's answer, the file asked of her, and her next meeting", async () => {
    const h = await svc(U.cadmin, (tx, p) => clientHome(tx, p));
    expect(h.answers.map((r) => r.id)).toEqual([R.shared]);
    expect(h.documents.map((r) => r.id)).toEqual([DOC.cadmin]);
    expect(h.replies).toEqual([]);
    expect(h.nextMeeting?.id).toBe(M.whole);
    expect(h.sentBack).toEqual([]);
    expect(h.lateOrStopped).toEqual([]);
    // The firm's own recommendation and its draft never reach the client (D6).
    expect(titles(h)).not.toMatch(/Firm working note|Secret draft/);
  });

  it("gives a department-limited manager her own work and HR's meeting, and no title from Finance anywhere (D8)", async () => {
    const h = await svc(U.mgr, (tx, p) => clientHome(tx, p));
    expect(h.answers).toEqual([]);
    expect(h.documents.map((r) => r.id)).toEqual([DOC.mgr]);
    expect(h.lateOrStopped.map((r) => r.id)).toEqual([A.mgrStopped]);
    expect(h.dates.map((r) => [r.href, r.approved])).toEqual([[`/actions/${A.mgrStopped}`, true]]);
    expect(h.followUps.map((f) => f.title)).toEqual(["Share the pay data"]);
    // Invited to the whole-project meeting, she cannot open it: it is not listed. HR's is.
    expect(h.replies.map((m) => m.id)).toEqual([M.hr]);
    expect(h.nextMeeting).toBeNull();
    expect(titles(h)).not.toMatch(/canary|Steering committee|Secret draft/);
  });
});

describe("the action owner's home", () => {
  it("groups the owner's own actions, sent back and late first, and names nobody else's work", async () => {
    const h = await svc(U.doer, (tx, p) => ownerHome(tx, p));
    expect(h.waiting.map((a) => a.id)).toEqual([A.late, A.sentBack, A.fresh]);
    expect(h.waiting.find((a) => a.id === A.late)).toMatchObject({ overdue: true, dateAsked: expect.any(String) });
    expect(new Set(h.withConsultant.map((a) => a.id))).toEqual(new Set([A.waiting, A.signed, A.slow]));
    expect(h.finished.map((a) => a.id)).toEqual([A.done]);
    expect(h.documents.map((r) => r.id)).toEqual([DOC.doer]);
    // Invited to a whole-project meeting, an owner opens it (decided 17 Nov).
    expect(h.replies.map((m) => m.id)).toEqual([M.whole]);
    expect(h.followUps.map((f) => f.title)).toEqual(["Send the HR minutes"]);
    // No draft (D6), no colleague's action, file or meeting (1b): not even a count.
    expect(titles(h)).not.toMatch(/Secret draft|canary|pay scales|Pay scale|HR workshop/);
  });

  it("is the home an owner gets, and the other owner's home holds only her own", async () => {
    const mine = await svc(U.doer2, (tx, p) => home(tx, p));
    expect(mine.kind).toBe("owner");
    if (mine.kind !== "owner") return;
    expect(mine.data.waiting.map((a) => a.id)).toEqual([A.finance]);
    expect(mine.data.documents.map((r) => r.id)).toEqual([DOC.finance]);
    expect(mine.data.replies.map((m) => m.id)).toEqual([M.finance]);
    expect(titles(mine)).not.toMatch(/HR policy|signed charter|Steering committee|HR workshop/);
  });
});

describe("one home per role", () => {
  it("picks the firm, client or owner home by the reader's role", async () => {
    expect((await svc(U.admin, (tx, p) => home(tx, p))).kind).toBe("firm");
    expect((await svc(U.observer, (tx, p) => home(tx, p))).kind).toBe("firm");
    expect((await svc(U.cadmin, (tx, p) => home(tx, p))).kind).toBe("client");
    expect((await svc(U.mgr, (tx, p) => home(tx, p))).kind).toBe("client");
    expect((await svc(U.doer, (tx, p) => home(tx, p))).kind).toBe("owner");
  });
});
