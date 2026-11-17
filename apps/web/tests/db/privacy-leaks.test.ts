// Privacy batch 0 (page audit N1, N3, N5; decisions D4 and D8): a person
// never sees, by title, work they may not open. One fixture, a client with
// departments switched on, and one describe per leak. Every test here failed
// before its fix.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { getEngagement } from "@/services/engagement";
import { bookMeeting, getMeeting, listMeetings, meetingIcs, schedule } from "@/services/meetings";
import { loadPrincipal } from "@/services/principal";
import { getActionDetail, getProject } from "@/services/queries";
import { getRecommendation } from "@/services/responses";
import { reportPack, type StatusPack } from "@/services/status-pack";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 3 });

const id = (n: number) => `00000000-0000-4000-b0b0-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2); // departments on
const PLAIN = id(3); // departments off
const OTHER = id(4); // another client: nothing of Acme reaches it
const P = id(5); // Acme's project
const P_PLAIN = id(6);
const DEPT = { board: id(7), fin: id(8), legal: id(9) };
const U = {
  admin: id(11), // firm admin
  lead: id(12), // Acme's and Plain's lead consultant
  cons: id(13), // staffed on Acme's project
  obs: id(14), // observer on Acme's project
  cadmin: id(15), // Acme's admin
  mgr: id(16), // client manager, Board secretariat only
  sponsor: id(17), // client manager, Board secretariat and Finance
  owner: id(18), // action owner, Legal
  fin: id(19), // action owner, Finance
  pmgr: id(20), // Plain's manager: no department limits
  oadmin: id(21), // the other client's admin
};
const REC = { all: id(31), fin: id(32), board: id(33) };
const F = { matrix: id(41), charter: id(42) };
const A = {
  owners: id(51), // company-wide, owned by the Legal owner
  sponsors: id(52), // company-wide, owned by the sponsor
  draft: id(53), // company-wide, still the firm's draft
  finCanary: id(54), // Finance, under the company-wide recommendation, overdue
  finMatrix: id(55), // Finance, under Finance's recommendation
  board: id(56), // Board secretariat
  plain: id(57), // the other client's overdue action
};
const MEET = "https://meet.google.com/abc-defg-hij";

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
const rowsAs = async (userId: string, sql: string, params: unknown[] = []) => (await as(userId, (c) => c.query(sql, params))).rows;
async function svc<R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>, commit = false): Promise<R> {
  return as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      const p = await loadPrincipal(tx, userId);
      return fn(tx, p!).catch((e: Error & { cause?: Error }) => {
        throw new Error(e.cause ? `${e.message} | ${e.cause.message}` : e.message);
      });
    },
    commit,
  );
}
const hour = (h: number) => new Date(Date.now() + h * 3_600_000);
const book = (userId: string, projectId: string, extra: Partial<Parameters<typeof bookMeeting>[3]> = {}) =>
  svc(
    userId,
    (tx, p) =>
      bookMeeting(tx, p, projectId, {
        kind: "status",
        title: "Check-in",
        startsAt: hour(24),
        endsAt: hour(25),
        location: "online",
        joinUrl: MEET,
        ...extra,
      }),
    true,
  );
const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

let M = { fin: "", all: "", plain: "", finInvited: "" };

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, departments_enabled) VALUES
      ($1,'firm','firm',false), ($2,'client','Acme',true), ($3,'client','Plain',false), ($4,'client','Other',true)`,
    [FIRM, ACME, PLAIN, OTHER],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$12,'firm_admin'), ($2,$12,'consultant'), ($3,$12,'consultant'), ($4,$12,'consultant'),
      ($5,$13,'client_admin'), ($6,$13,'client_manager'), ($7,$13,'client_manager'), ($8,$13,'action_owner'), ($9,$13,'action_owner'),
      ($10,$14,'client_manager'), ($11,$15,'client_admin')`,
    [U.admin, U.lead, U.cons, U.obs, U.cadmin, U.mgr, U.sponsor, U.owner, U.fin, U.pmgr, U.oadmin, FIRM, ACME, PLAIN, OTHER],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$2,$5,'Acme governance','active',$6), ($3,'client',$4,$5,'Plain governance','active',$6)`,
    [P, ACME, P_PLAIN, PLAIN, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$3,true), ($2,$3,true), ($1,$4,false), ($1,$5,false)`, [
    ACME,
    PLAIN,
    U.lead,
    U.cons,
    U.obs,
  ]);
  await q(
    `INSERT INTO project_members (project_id, user_id, observer) VALUES
      ($1,$3,false), ($1,$4,true), ($1,$5,false), ($1,$6,false), ($1,$7,false), ($1,$8,false), ($2,$9,false)`,
    [P, P_PLAIN, U.cons, U.obs, U.mgr, U.sponsor, U.owner, U.fin, U.pmgr],
  );
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$4,'أمانة المجلس','Board secretariat'), ($2,$4,'المالية','Finance'), ($3,$4,'الشؤون القانونية','Legal')`, [
    DEPT.board,
    DEPT.fin,
    DEPT.legal,
    ACME,
  ]);
  await q(
    `INSERT INTO department_members (department_id, user_id, is_head) VALUES ($1,$4,true), ($1,$5,false), ($2,$5,false), ($3,$6,true), ($2,$7,true)`,
    [DEPT.board, DEPT.fin, DEPT.legal, U.mgr, U.sponsor, U.owner, U.fin],
  );
  await q(
    `INSERT INTO findings (id, project_id, org_id, title, visibility, created_by) VALUES
      ($1,$3,$4,'No delegation matrix','shared',$5), ($2,$3,$4,'No board charter','shared',$5)`,
    [F.matrix, F.charter, P, ACME, U.lead],
  );
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, department_id, finding_id, created_by) VALUES
      ($1,$4,$5,'Form the audit committee','shared',NULL,NULL,$8),
      ($2,$4,$5,'Update the delegation matrix','shared',$6,$9,$8),
      ($3,$4,$5,'Adopt a board charter','shared',$7,$10,$8)`,
    [REC.all, REC.fin, REC.board, P, ACME, DEPT.fin, DEPT.board, U.lead, F.matrix, F.charter],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, department_id, blocked_reason, created_by) VALUES
      ($1,$7,$8,$9,'Owner canary',$12,'in_progress',app_firm_today() + 30,NULL,NULL,$16),
      ($2,$7,$8,$9,'Sponsor canary',$13,'blocked',app_firm_today() + 30,NULL,'waiting for the assembly',$16),
      ($3,$7,$8,$9,'Draft canary',$13,'draft',app_firm_today() + 30,NULL,NULL,$16),
      ($4,$7,$8,$9,'Finance canary',$14,'in_progress',app_firm_today() - 5,$17,NULL,$16),
      ($5,$7,$8,$10,'Finance matrix canary',$14,'in_progress',app_firm_today() + 30,$17,NULL,$16),
      ($6,$7,$8,$11,'Board canary',$15,'in_progress',app_firm_today() + 30,$18,NULL,$16)`,
    [A.owners, A.sponsors, A.draft, A.finCanary, A.finMatrix, A.board, P, ACME, REC.all, REC.fin, REC.board, U.owner, U.sponsor, U.fin, U.mgr, U.lead, DEPT.fin, DEPT.board],
  );
  await q(`INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES ($1,$2,$3,'Plain charter','shared',$4)`, [
    id(34),
    P_PLAIN,
    PLAIN,
    U.lead,
  ]);
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, status, due_date, created_by, owner_name)
     VALUES ($1,$2,$3,$4,'Plain canary','in_progress',app_firm_today() - 5,$5,'Someone')`,
    [A.plain, P_PLAIN, PLAIN, id(34), U.lead],
  );
  // What happened on the project: one event per department, and a restructure that refiled the Board action.
  await q(
    `INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, to_state, meta) VALUES
      ($1,$2,$3,'action',$4,'status_changed','in_progress','{}'),
      ($1,$2,$5,'action',$6,'status_changed','in_progress','{}'),
      ($1,$2,$7,'action',$6,'department_moved',NULL,$8)`,
    [P, ACME, U.fin, A.finCanary, U.mgr, A.board, U.admin, JSON.stringify({ from: DEPT.legal, to: DEPT.board, actions: [A.board] })],
  );

  // Meetings, booked the way the screen books them.
  M = {
    fin: (await book(U.lead, P, { title: "Finance workshop", departmentId: DEPT.fin, attendees: [{ userId: U.fin }] })).id,
    all: (await book(U.lead, P, { title: "Steering committee" })).id,
    plain: (await book(U.lead, P_PLAIN, { title: "Plain status" })).id,
    finInvited: (await book(U.lead, P, { title: "Finance review", departmentId: DEPT.fin, attendees: [{ userId: U.mgr }] })).id,
  };
  for (const mid of [M.fin, M.all]) {
    await q(`UPDATE meetings SET status = 'held' WHERE id = $1`, [mid]);
    await q(
      `INSERT INTO meeting_decisions (project_id, org_id, meeting_id, text, visibility, created_by) VALUES ($1,$2,$3,'Decision canary','shared',$4)`,
      [P, ACME, mid, U.lead],
    );
    await q(
      `INSERT INTO meeting_summaries (meeting_id, project_id, org_id, lang, main_points_md, confirmed_by, visibility) VALUES ($1,$2,$3,'en','Summary canary',$4,'shared')`,
      [mid, P, ACME, U.lead],
    );
    await q(
      `INSERT INTO follow_ups (project_id, org_id, meeting_id, title, visibility, assignee_user_id, due_at, created_by) VALUES ($1,$2,$3,$6,'shared',$4, now() + interval '2 days', $5)`,
      [P, ACME, mid, U.lead, U.lead, mid === M.fin ? "Finance follow-up canary" : "Steering follow-up canary"],
    );
  }
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

// ------------------------------------------------------------------ item 1
describe("the recommendation page lists only actions the reader may open", () => {
  const page = (who: string) => svc(who, (tx, p) => getRecommendation(tx, p, REC.all));

  it("an action owner sees their own action, and how many more there are, never the titles", async () => {
    const r = await page(U.owner);
    expect(titles(r.actions)).toEqual(["Owner canary"]);
    // The sponsor's and Finance's; the firm's draft is not announced, not even as a number.
    expect(r.actionsLeftOut).toBe(2);
    expect(JSON.stringify(r)).not.toMatch(/Sponsor canary|Draft canary|Finance canary/);
  });

  it("a manager outside Finance sees the company-wide ones and is told one more exists", async () => {
    const r = await page(U.mgr);
    expect(titles(r.actions)).toEqual(["Draft canary", "Owner canary", "Sponsor canary"]);
    expect(r.actionsLeftOut).toBe(1);
    expect(JSON.stringify(r)).not.toContain("Finance canary");
  });

  it("the sponsor in Finance, the client admin and the firm see all of them and no line", async () => {
    for (const who of [U.sponsor, U.cadmin, U.lead, U.cons, U.obs, U.admin]) {
      const r = await page(who);
      expect(titles(r.actions)).toEqual(["Draft canary", "Finance canary", "Owner canary", "Sponsor canary"]);
      expect(r.actionsLeftOut).toBe(0);
    }
  });

  it("the schedule lists an action owner's own actions, not their colleagues'", async () => {
    const due = async (who: string) =>
      (await svc(who, (tx, p) => schedule(tx, p, { from: hour(-24 * 10), to: hour(24 * 60) })))
        .filter((i) => i.type === "action")
        .map((i) => i.title)
        .sort();
    expect(await due(U.owner)).toEqual(["Owner canary"]);
    expect(await due(U.fin)).toEqual(["Finance canary", "Finance matrix canary"]);
    // A manager keeps what her departments allow; the client admin and the firm keep everything.
    expect(await due(U.mgr)).toEqual(["Board canary", "Owner canary", "Sponsor canary"]);
    expect(await due(U.cadmin)).toEqual(["Board canary", "Finance canary", "Finance matrix canary", "Owner canary", "Sponsor canary"]);
  });

  it("the count answers nothing about a recommendation the caller cannot read", async () => {
    const n = async (who: string, rec: string) => (await rowsAs(who, `SELECT app_actions_left_out($1, '{}') AS n`, [rec]))[0].n;
    expect(await n(U.mgr, REC.fin)).toBe(0); // another department's
    expect(await n(U.oadmin, REC.all)).toBe(0); // another client's
    expect(await n(U.pmgr, REC.all)).toBe(0);
    expect(await n(U.cadmin, REC.fin)).toBe(1);
  });
});

// ------------------------------------------------------------------ item 7
describe("a finding answered in another department", () => {
  const findings = async (who: string) =>
    Object.fromEntries((await svc(who, (tx, p) => getProject(tx, p, P))).findings.map((f) => [f.title, f.answeredElsewhere]));

  it("is not shown as unanswered to a manager who cannot read the recommendation", async () => {
    const plan = await svc(U.mgr, (tx, p) => getProject(tx, p, P));
    expect(plan.recommendations.map((r) => r.title).sort()).toEqual(["Adopt a board charter", "Form the audit committee"]);
    expect(await findings(U.mgr)).toEqual({ "No delegation matrix": 1, "No board charter": 0 });
    expect(JSON.stringify(plan)).not.toContain("Update the delegation matrix");
  });

  it("counts nothing for people who read every recommendation", async () => {
    for (const who of [U.sponsor, U.cadmin, U.lead]) {
      expect(await findings(who)).toEqual({ "No delegation matrix": 0, "No board charter": 0 });
    }
  });

  it("answers nothing to another client", async () => {
    expect(await rowsAs(U.oadmin, `SELECT * FROM app_findings_answered_elsewhere($1)`, [P])).toEqual([]);
    expect(await rowsAs(U.pmgr, `SELECT * FROM app_findings_answered_elsewhere($1)`, [P])).toEqual([]);
  });
});

// ------------------------------------------------------------------ item 2
describe("a department's meeting follows the department rule", () => {
  const seen = async (who: string) => titles(await rowsAs(who, `SELECT title FROM meetings WHERE project_id = $1`, [P]));
  const OUTSIDE = [U.mgr, U.owner]; // not in Finance, not invited to the workshop

  it("is read by the department's people, the client admin, the firm and the people invited", async () => {
    for (const who of [U.sponsor, U.fin, U.cadmin, U.lead, U.cons, U.obs, U.admin]) {
      expect(await seen(who)).toEqual(["Finance review", "Finance workshop", "Steering committee"]);
    }
    // The manager is invited to the review, not to the workshop.
    expect(await seen(U.mgr)).toEqual(["Finance review", "Steering committee"]);
    expect(await seen(U.owner)).toEqual(["Steering committee"]);
    expect(await seen(U.oadmin)).toEqual([]);
  });

  it("hides everything under it from people outside the department", async () => {
    for (const who of OUTSIDE) {
      for (const table of ["meeting_attendees", "meeting_decisions", "meeting_summaries", "follow_ups"]) {
        expect(await rowsAs(who, `SELECT 1 FROM ${table} WHERE meeting_id = $1`, [M.fin])).toEqual([]);
        // The whole-project meeting stays open to everyone on the project.
        expect((await rowsAs(who, `SELECT 1 FROM ${table} WHERE meeting_id = $1`, [M.all])).length).toBeGreaterThan(0);
      }
      expect((await rowsAs(who, `SELECT item_id FROM v_schedule WHERE item_type = 'meeting'`)).map((r) => r.item_id)).not.toContain(M.fin);
      expect(await rowsAs(who, `SELECT app_can_see_meeting($1) AS ok`, [M.fin])).toEqual([{ ok: false }]);
    }
    for (const table of ["meeting_attendees", "meeting_decisions", "meeting_summaries", "follow_ups"]) {
      expect((await rowsAs(U.fin, `SELECT 1 FROM ${table} WHERE meeting_id = $1`, [M.fin])).length).toBeGreaterThan(0);
    }
  });

  it("answers Not found on the page, the calendar file and the schedule", async () => {
    for (const who of OUTSIDE) {
      await expect(svc(who, (tx, p) => getMeeting(tx, p, M.fin))).rejects.toThrow(/not found/i);
      await expect(svc(who, (tx, p) => meetingIcs(tx, p, M.fin))).rejects.toThrow(/not found/i);
      expect((await svc(who, (tx, p) => listMeetings(tx, p, P))).map((m) => m.title)).not.toContain("Finance workshop");
      const items = await svc(who, (tx, p) => schedule(tx, p, { from: hour(-1), to: hour(24 * 30) }));
      expect(items.map((i) => i.title)).not.toContain("Finance workshop");
      expect(items.map((i) => i.title)).not.toContain("Finance follow-up canary");
      // The whole-project meeting and what came out of it stay on the schedule (an action owner: only what is assigned to them).
      expect(items.map((i) => i.title)).toContain("Steering committee");
      if (who === U.mgr) expect(items.map((i) => i.title)).toContain("Steering follow-up canary");
    }
    expect((await svc(U.fin, (tx, p) => getMeeting(tx, p, M.fin))).meeting.title).toBe("Finance workshop");
    expect((await svc(U.mgr, (tx, p) => getMeeting(tx, p, M.finInvited))).meeting.title).toBe("Finance review");
  });

  it("is not booked by a client manager for a department they are not in", async () => {
    await expect(book(U.mgr, P, { title: "Peek", departmentId: DEPT.fin })).rejects.toThrow();
    const mine = await book(U.mgr, P, { title: "Board prep", departmentId: DEPT.board });
    expect(mine.id).toBeTruthy();
    await owner.query(`DELETE FROM meetings WHERE id = $1`, [mine.id]);
  });

  it("a follow-up from it still reaches the person it is assigned to", async () => {
    await owner.query(`UPDATE follow_ups SET assignee_user_id = $1 WHERE meeting_id = $2`, [U.owner, M.fin]);
    expect((await rowsAs(U.owner, `SELECT 1 FROM follow_ups WHERE meeting_id = $1`, [M.fin])).length).toBe(1);
    expect(await rowsAs(U.mgr, `SELECT 1 FROM follow_ups WHERE meeting_id = $1`, [M.fin])).toEqual([]);
    await owner.query(`UPDATE follow_ups SET assignee_user_id = $1 WHERE meeting_id = $2`, [U.lead, M.fin]);
  });
});

// ------------------------------------------------------------------ item 3
describe("the activity record is for the firm and the client admin", () => {
  it("is not returned to client managers and action owners, by the service or by the database", async () => {
    for (const who of [U.mgr, U.sponsor, U.owner, U.fin]) {
      expect(await rowsAs(who, `SELECT 1 FROM activity_events`)).toEqual([]);
      expect((await svc(who, (tx, p) => getProject(tx, p, P))).activity).toBeNull();
    }
  });

  it("is still read by the firm on the project and by the client admin", async () => {
    for (const who of [U.cadmin, U.lead, U.cons, U.obs, U.admin]) {
      expect((await rowsAs(who, `SELECT 1 FROM activity_events WHERE project_id = $1`, [P])).length).toBe(3);
      expect((await svc(who, (tx, p) => getProject(tx, p, P))).activity?.length).toBe(3);
    }
    expect(await rowsAs(U.oadmin, `SELECT 1 FROM activity_events`)).toEqual([]);
  });

  it("the action page still says when a restructure refiled the action", async () => {
    for (const who of [U.mgr, U.cadmin, U.lead]) {
      const detail = await svc(who, (tx, p) => getActionDetail(tx, p, A.board));
      const moved = detail.timeline.filter((e) => e.kind === "moved");
      expect(moved).toHaveLength(1);
      // A client reads the department it went to; the firm admin's name is the firm's to read, as before.
      expect(moved[0]).toMatchObject({ who: who === U.lead ? "admin" : null, to: { nameEn: "Board secretariat" } });
    }
    // Nothing about an action the caller cannot open.
    expect(await rowsAs(U.owner, `SELECT * FROM app_action_refilings($1)`, [A.board])).toEqual([]);
    expect(await rowsAs(U.oadmin, `SELECT * FROM app_action_refilings($1)`, [A.board])).toEqual([]);
  });
});

// ------------------------------------------------------------------ item 4
describe("the stored agenda is sent only to people who can open all of the project's work", () => {
  const agenda = async (who: string, mid: string) => {
    const m = await svc(who, (tx, p) => getMeeting(tx, p, mid));
    return { text: m.meeting.agendaMd, withheld: m.agendaWithheld, all: JSON.stringify(m) };
  };

  it("names Finance's late action to the firm and the client admin", async () => {
    for (const who of [U.lead, U.cons, U.obs, U.admin, U.cadmin]) {
      const a = await agenda(who, M.all);
      expect(a.text).toContain("Finance canary");
      expect(a.withheld).toBe(false);
    }
  });

  it("is withheld from a department-limited manager and from action owners, with nothing of it in the answer", async () => {
    for (const who of [U.mgr, U.owner, U.fin]) {
      const a = await agenda(who, M.all);
      expect(a.text).toBeNull();
      expect(a.withheld).toBe(true);
      expect(a.all).not.toMatch(/Finance canary|Sponsor canary/);
    }
  });

  it("is read by a manager whom no department limit applies to", async () => {
    // In every department that has work here.
    expect((await agenda(U.sponsor, M.all)).text).toContain("Finance canary");
    // A client with departments switched off.
    expect((await agenda(U.pmgr, M.plain)).text).toContain("Plain canary");
  });

  it("a department's agenda is read by a manager of that department, not by an invited outsider", async () => {
    expect((await agenda(U.sponsor, M.finInvited)).text).toContain("Finance canary");
    const outsider = await agenda(U.mgr, M.finInvited);
    expect(outsider.text).toBeNull();
    expect(outsider.withheld).toBe(true);
  });

  it("cannot be read straight from the table by anyone", async () => {
    for (const who of [U.mgr, U.owner, U.cadmin, U.lead]) {
      await expect(rowsAs(who, `SELECT agenda_md FROM meetings WHERE id = $1`, [M.all])).rejects.toThrow(/permission denied/);
      await expect(rowsAs(who, `SELECT * FROM meetings WHERE id = $1`, [M.all])).rejects.toThrow(/permission denied/);
    }
    const viaFunction = async (who: string, mid: string) => (await rowsAs(who, `SELECT * FROM app_meeting_agenda_for($1)`, [mid]))[0];
    expect(await viaFunction(U.mgr, M.all)).toEqual({ agenda: null, withheld: true });
    expect(await viaFunction(U.owner, M.all)).toEqual({ agenda: null, withheld: true });
    expect((await viaFunction(U.cadmin, M.all)).agenda).toContain("Finance canary");
    // A meeting the caller cannot open at all: no row, as if it did not exist.
    expect(await viaFunction(U.owner, M.fin)).toBeUndefined();
    expect(await viaFunction(U.oadmin, M.all)).toBeUndefined();
  });

  it("every other column of a meeting is still granted to the app (a new column needs its own GRANT in a migration)", async () => {
    const { rows } = await owner.query(
      `SELECT c.column_name FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = 'meetings'
         AND NOT has_column_privilege('selah_app', 'public.meetings', c.column_name, 'SELECT')`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(["agenda_md"]);
  });
});

// ------------------------------------------------------------------ item 9
describe("a new agenda", () => {
  const STATUSES = ["draft", "assigned", "in_progress", "blocked", "awaiting_review", "revision_requested", "verified_complete", "closed"];

  it("says a status in the app's own words, in both languages", async () => {
    for (const lang of ["ar", "en"] as const) {
      const words = (await import(`../../messages/${lang}.json`)).default.status as Record<string, string>;
      for (const s of STATUSES) {
        const { rows } = await owner.query(`SELECT app_action_status_label($1, $2) AS label`, [s, lang]);
        expect(rows[0].label).toBe(words[s]);
      }
    }
  });

  it("writes a date the way the screens do, in both languages", async () => {
    for (const lang of ["ar", "en"] as const) {
      const screen = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeZone: "UTC" });
      for (const day of ["2031-01-02", "2031-11-12", "2032-02-29"]) {
        const { rows } = await owner.query(`SELECT app_agenda_date($1::date, $2) AS d`, [day, lang]);
        expect(rows[0].d).toBe(screen.format(new Date(`${day}T00:00:00Z`)));
      }
    }
  });

  it("carries no status key and no raw date", async () => {
    // A meeting was held two days ago; the next one lists what changed since, and what is late.
    const earlier = (
      await owner.query(
        `INSERT INTO meetings (project_id, org_id, kind, title, starts_at, ends_at, location, organizer_id, ics_uid)
         VALUES ($1,$2,'status','Earlier', now() - interval '2 days', now() - interval '47 hours', 'in_person', $3, 'x') RETURNING id`,
        [P, ACME, U.lead],
      )
    ).rows[0].id as string;
    await owner.query(`UPDATE meetings SET status = 'held' WHERE id = $1`, [earlier]);
    await owner.query(`UPDATE actions SET updated_at = now() WHERE id = $1`, [A.owners]);
    const due = (await owner.query(`SELECT due_date::text AS d FROM actions WHERE id = $1`, [A.finCanary])).rows[0].d as string;
    for (const lang of ["ar", "en"] as const) {
      // Before the fixture's own (held) meetings, so the one two days ago is the last held before it.
      const { id: mid } = await book(U.lead, P, { title: `Next (${lang})`, spokenLang: lang, startsAt: hour(2), endsAt: hour(3) });
      const text = (await rowsAs(U.lead, `SELECT agenda FROM app_meeting_agenda_for($1)`, [mid]))[0].agenda as string;
      const day = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${due}T00:00:00Z`));
      expect(text).toContain(lang === "en" ? `- Finance canary (due ${day})` : `- Finance canary (الاستحقاق ${day})`);
      expect(text).toContain(lang === "en" ? "- Owner canary (In progress)" : "- Owner canary (قيد التنفيذ)");
      expect(text).not.toMatch(/in_progress|awaiting_review|revision_requested|verified_complete|\d{4}-\d{2}-\d{2}/);
      await owner.query(`DELETE FROM meetings WHERE id = $1`, [mid]);
    }
    await owner.query(`DELETE FROM meetings WHERE id = $1`, [earlier]);
  });
});

// ------------------------------------------------------------------ item 6
describe("the departments page", () => {
  it("links a manager only to the departments she may open", async () => {
    const open = async (who: string) =>
      Object.fromEntries((await svc(who, (tx, p) => getEngagement(tx, p, ACME))).departments.map((d) => [d.nameEn, d.canOpen]));
    expect(await open(U.mgr)).toEqual({ "Board secretariat": true, Finance: false, Legal: false });
    expect(await open(U.sponsor)).toEqual({ "Board secretariat": true, Finance: true, Legal: false });
    expect(await open(U.cadmin)).toEqual({ "Board secretariat": true, Finance: true, Legal: true });
    expect(await open(U.lead)).toEqual({ "Board secretariat": true, Finance: true, Legal: true });
  });
});

// ------------------------------------------------------------------ item 5
describe("a shared status pack", () => {
  const REPORT = id(61);
  const KPI = id(62);
  const item = (aid: string, title: string, departmentId: string | null) => ({ id: aid, title, departmentId });
  const pack: StatusPack = {
    overdue: [
      { ...item(A.finCanary, "Finance canary", DEPT.fin), owner: "fin", dueDate: "2030-01-01", days: 5 },
      { ...item(A.board, "Board canary", DEPT.board), owner: "mgr", dueDate: "2030-01-01", days: 2 },
    ],
    slipped: [],
    riskAccepted: [],
    verified: [{ ...item(A.finMatrix, "Finance matrix canary", DEPT.fin), owner: "fin", on: "2030-01-01" }],
    moved: { in_progress: 4 },
    decisions: [{ ...item(REC.fin, "Update the delegation matrix", DEPT.fin), kind: "response", since: "2030-01-01" }],
    indicators: [
      {
        id: KPI,
        nameAr: null,
        nameEn: "Board decisions on time",
        departmentId: null,
        departmentAr: null,
        departmentEn: null,
        unit: "%",
        direction: "higher_better",
        frequency: "monthly",
        baseline: 40,
        baselinePeriod: "2030-01-01",
        target: null,
        targetDate: null,
        latest: null,
        previous: null,
        movement: null,
        towardTarget: null,
        missing: 0,
        points: [],
        recommendations: ["Adopt a board charter", "Update the delegation matrix"],
      },
    ],
  };

  beforeAll(async () => {
    await owner.query(
      `INSERT INTO client_kpis (id, org_id, name_en, unit, direction, frequency, baseline, baseline_period, created_by)
       VALUES ($1,$2,'Board decisions on time','%','higher_better','monthly',40,'2030-01-01',$3)`,
      [KPI, ACME, U.lead],
    );
    await owner.query(`INSERT INTO client_kpi_links (kpi_id, org_id, recommendation_id, created_by) VALUES ($1,$2,$3,$5), ($1,$2,$4,$5)`, [
      KPI,
      ACME,
      REC.board,
      REC.fin,
      U.lead,
    ]);
    await owner.query(
      `INSERT INTO reports (id, project_id, org_id, kind, title, body_md, generated_by, period_start, period_end, metrics, pack, visibility, shared_at)
       VALUES ($1,$2,$3,'status_pack','Status pack','',$4,'2030-01-01','2030-01-31','{}',$5,'shared', now())`,
      [REPORT, P, ACME, U.lead, JSON.stringify(pack)],
    );
  });

  const read = async (who: string) => (await svc(who, (tx, p) => reportPack(tx, p, REPORT)))!;

  it("leaves other departments' titles out for a limited manager and says how many", async () => {
    const r = await read(U.mgr);
    expect(titles(r.pack.overdue)).toEqual(["Board canary"]);
    expect(r.pack.verified).toEqual([]);
    expect(r.pack.decisions).toEqual([]);
    expect(r.pack.leftOut).toEqual({ decisions: 1, overdue: 1, slipped: 0, riskAccepted: 0, verified: 1 });
    // The numbers stay whole: a person at the firm chose to share the report.
    expect(r.pack.moved).toEqual({ in_progress: 4 });
    // An indicator's linked recommendations follow the same limit.
    expect(r.pack.indicators![0]!.recommendations).toEqual(["Adopt a board charter"]);
    expect(r.pack.indicators![0]!.recommendationsLeftOut).toBe(1);
    expect(JSON.stringify(r)).not.toMatch(/Finance canary|Finance matrix canary|Update the delegation matrix/);
  });

  it("is whole for the sponsor in Finance, the client admin and the firm", async () => {
    for (const who of [U.sponsor, U.cadmin, U.lead]) {
      const r = await read(who);
      expect(titles(r.pack.overdue)).toEqual(["Board canary", "Finance canary"]);
      expect(r.pack.decisions).toHaveLength(1);
      expect(r.pack.indicators![0]!.recommendations).toEqual(["Adopt a board charter", "Update the delegation matrix"]);
      expect(Object.values(r.pack.leftOut ?? {}).reduce((a, b) => a + b, 0)).toBe(0);
      expect(r.pack.indicators![0]!.recommendationsLeftOut ?? 0).toBe(0);
    }
  });
});
