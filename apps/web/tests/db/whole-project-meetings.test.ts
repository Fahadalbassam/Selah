// Decision 1a (product owner, 17 Nov 2026), "the agenda follows the
// meeting", with his answer of the same day on action owners (migration
// 0082_whole_project_meetings):
//   - a department's meeting lists only that department's work, for every
//     reader, and opens as before (0070);
//   - a meeting with no department opens only for people who may see all of
//     the project's work, plus action owners invited to it, who see only
//     their own actions on its agenda; everyone else gets Not found on the
//     meeting and everything under it, and it is left out of every list;
//   - the organiser is warned, by name, before inviting someone who could not
//     open it; saving anyway is allowed, and the invitation carries no agenda.
// Every case for a limited manager or an owner failed before 0082 and the
// service changes; the other roles guard what must not change.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { runMail, type OutgoingMail } from "@/jobs/mail";
import { leftOutOfMeeting } from "@/lib/meetings";
import { bookMeeting, getMeeting, listMeetings, meetingIcs, meetingInvitees, schedule } from "@/services/meetings";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 3 });

const id = (n: number) => `00000000-0000-4000-b1a1-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const NUKHBA = id(2); // departments on
const RAWDAH = id(3); // departments off
const PN = id(4);
const PR = id(5);
const DEPT = { board: id(6), fin: id(7), legal: id(8) };
const U = {
  admin: id(11), // firm admin
  lead: id(12), // both clients' lead consultant
  cons: id(13), // staffed on Nukhba's project
  ncadmin: id(14), // Nukhba's admin
  nmgr: id(15), // Nukhba manager, Board secretariat only: limited
  nsponsor: id(16), // Nukhba manager in all three departments: no limit applies
  owner: id(17), // owner@nukhba.test: action owner in Legal
  fin: id(18), // action owner in Finance
  radmin: id(19), // Rawdah's admin
  rowner: id(20), // owner@rawdah.test: action owner, no departments
  rmate: id(21), // her colleague
  // Nukhba manager in the Board secretariat and Finance, not Legal. Legal has no work on the
  // project, so the rule that looked at released work let her see everything; the stable rule
  // (a member of every active department) does not, and releasing work changes neither answer.
  npartial: id(22),
};
const REC = { all: id(31), fin: id(32), rawdah: id(33) };
const A = { wide: id(41), fin: id(42), board: id(43), rmine: id(44), rmate: id(45) };
const MEET = "https://meet.google.com/abc-defg-hij";
const TITLES = ["Wide canary", "Finance canary", "Board canary", "Rawdah owner canary", "Rawdah colleague canary"];

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
        spokenLang: "en",
        ...extra,
      }),
    true,
  );
// The route answers 404 for each of these (src/server/http.ts).
const NOT_FOUND = /forbidden|not found/i;

let M = { steer: "", finance: "", rawdah: "", rawdahUninvited: "" };

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, departments_enabled) VALUES ($1,'firm','Mizan Advisory',false), ($2,'client','Al-Nukhba',true), ($3,'client','Rawdah',false)`,
    [FIRM, NUKHBA, RAWDAH],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$12,'firm_admin'), ($2,$12,'consultant'), ($3,$12,'consultant'),
      ($4,$13,'client_admin'), ($5,$13,'client_manager'), ($6,$13,'client_manager'), ($7,$13,'action_owner'), ($8,$13,'action_owner'),
      ($9,$14,'client_admin'), ($10,$14,'action_owner'), ($11,$14,'action_owner')`,
    [U.admin, U.lead, U.cons, U.ncadmin, U.nmgr, U.nsponsor, U.owner, U.fin, U.radmin, U.rowner, U.rmate, FIRM, NUKHBA, RAWDAH],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$2,$5,'Nukhba governance','active',$6), ($3,'client',$4,$5,'Rawdah governance','active',$6)`,
    [PN, NUKHBA, PR, RAWDAH, FIRM, U.admin],
  );
  await q(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,'client_manager')`, [U.npartial, NUKHBA]);
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$3,true), ($2,$3,true), ($1,$4,false)`, [NUKHBA, RAWDAH, U.lead, U.cons]);
  await q(
    `INSERT INTO project_members (project_id, user_id) VALUES ($1,$3), ($1,$4), ($1,$5), ($1,$6), ($1,$7), ($2,$8), ($2,$9), ($1,$10)`,
    [PN, PR, U.cons, U.nmgr, U.nsponsor, U.owner, U.fin, U.rowner, U.rmate, U.npartial],
  );
  await q(
    `INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$4,'أمانة المجلس','Board secretariat'), ($2,$4,'المالية','Finance'), ($3,$4,'الشؤون القانونية','Legal')`,
    [DEPT.board, DEPT.fin, DEPT.legal, NUKHBA],
  );
  await q(
    `INSERT INTO department_members (department_id, user_id) VALUES ($1,$4), ($1,$5), ($2,$5), ($3,$5), ($3,$6), ($2,$7), ($1,$8), ($2,$8)`,
    [DEPT.board, DEPT.fin, DEPT.legal, U.nmgr, U.nsponsor, U.owner, U.fin, U.npartial],
  );
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, department_id, created_by) VALUES
      ($1,$4,$5,'Publish the delegation matrix','shared',NULL,$7),
      ($2,$4,$5,'Close the books monthly','shared',$6,$7),
      ($3,$8,$9,'Adopt a board charter','shared',NULL,$7)`,
    [REC.all, REC.fin, REC.rawdah, PN, NUKHBA, DEPT.fin, U.lead, PR, RAWDAH],
  );
  // Late work, so it is on every agenda written at booking.
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, department_id, created_by) VALUES
      ($1,$4,$5,$6,'Wide canary',$8,'in_progress',app_firm_today() - 5,NULL,$11),
      ($2,$4,$5,$7,'Finance canary',$9,'in_progress',app_firm_today() - 4,$12,$11),
      ($3,$4,$5,$6,'Board canary',$10,'blocked',app_firm_today() + 30,$13,$11)`,
    [A.wide, A.fin, A.board, PN, NUKHBA, REC.all, REC.fin, U.owner, U.fin, U.nmgr, U.lead, DEPT.fin, DEPT.board],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by) VALUES
      ($1,$3,$4,$5,'Rawdah owner canary',$6,'in_progress',app_firm_today() - 5,$8),
      ($2,$3,$4,$5,'Rawdah colleague canary',$7,'in_progress',app_firm_today() - 4,$8)`,
    [A.rmine, A.rmate, PR, RAWDAH, REC.rawdah, U.rowner, U.rmate, U.lead],
  );

  // Booked the way the screen books them, by the lead.
  M = {
    // The whole project, inviting a manager with department limits (saved anyway) and an action owner.
    steer: (await book(U.lead, PN, { title: "Steering committee", attendees: [{ userId: U.nmgr }, { userId: U.owner }, { userId: U.nsponsor }] })).id,
    finance: (await book(U.lead, PN, { title: "Finance workshop", departmentId: DEPT.fin, attendees: [{ userId: U.fin }, { userId: U.nmgr }] })).id,
    rawdah: (await book(U.lead, PR, { title: "Rawdah steering", attendees: [{ userId: U.rowner }] })).id,
    rawdahUninvited: (await book(U.lead, PR, { title: "Rawdah board prep" })).id,
  };
  // What came out of the steering meeting.
  await q(`UPDATE meetings SET status = 'held', transcript_consent = true, consent_noted_by = $2 WHERE id = $1`, [M.steer, U.lead]);
  await q(`INSERT INTO meeting_decisions (project_id, org_id, meeting_id, text, visibility, created_by) VALUES ($1,$2,$3,'Decision canary','shared',$4)`, [
    PN,
    NUKHBA,
    M.steer,
    U.lead,
  ]);
  await q(
    `INSERT INTO meeting_summaries (meeting_id, project_id, org_id, lang, main_points_md, confirmed_by, visibility) VALUES ($1,$2,$3,'en','Summary canary',$4,'shared')`,
    [M.steer, PN, NUKHBA, U.lead],
  );
  await q(
    `INSERT INTO follow_ups (project_id, org_id, meeting_id, title, visibility, assignee_user_id, due_at, created_by) VALUES
      ($1,$2,$3,'Steering follow-up canary','shared',$4, now() + interval '2 days', $4),
      ($1,$2,$3,'Assigned to the manager','shared',$5, now() + interval '2 days', $4)`,
    [PN, NUKHBA, M.steer, U.lead, U.nmgr],
  );
  await q(
    `INSERT INTO meeting_notes (project_id, org_id, author_id, meeting_id, held_on, title, body, visibility) VALUES ($1,$2,$3,$4,app_firm_today(),'Note canary','Said','shared')`,
    [PN, NUKHBA, U.lead, M.steer],
  );
  await q(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, storage_key, content_type, size_bytes, sha256, scan_status)
     VALUES ($1,$2,$3,$3,$4,'client_document','submitted','Board pack','shared','k-pack','application/pdf',1,'s','clean')`,
    [id(51), PN, NUKHBA, U.ncadmin],
  );
  await q(`INSERT INTO meeting_summary_sources (meeting_id, project_id, org_id, line, kind, document_id, page) VALUES ($1,$2,$3,1,'document',$4,1)`, [
    M.steer,
    PN,
    NUKHBA,
    id(51),
  ]);
  await q(`INSERT INTO meeting_transcripts (meeting_id, project_id, org_id, lang, format, body, imported_by) VALUES ($1,$2,$3,'en','text','Transcript canary',$4)`, [
    M.steer,
    PN,
    NUKHBA,
    U.lead,
  ]);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

// ------------------------------------------------------------ department meetings
describe("a department's meeting lists only that department's work", () => {
  it("names no other department's work, for every reader who opens it", async () => {
    for (const who of [U.lead, U.cons, U.admin, U.ncadmin, U.nsponsor, U.fin, U.nmgr]) {
      const m = await svc(who, (tx, p) => getMeeting(tx, p, M.finance));
      const all = JSON.stringify(m);
      expect(all, who).not.toMatch(/Wide canary|Board canary|Rawdah/);
      // The stored agenda is Finance's work; an invited outsider (the Board manager) is told there is one.
      if (who === U.nmgr) expect(m.agendaWithheld).toBe(true);
      else if (who === U.fin) expect([m.agendaOwn, m.meeting.agendaMd]).toEqual([true, expect.stringContaining("Finance canary")]);
      else expect(m.meeting.agendaMd, who).toContain("Finance canary");
    }
  });

  it("still opens for its department, the client's admin, the firm and anyone invited, and for nobody else", async () => {
    for (const who of [U.lead, U.ncadmin, U.nsponsor, U.fin, U.nmgr]) {
      expect((await svc(who, (tx, p) => getMeeting(tx, p, M.finance))).meeting.title).toBe("Finance workshop");
    }
    await expect(svc(U.owner, (tx, p) => getMeeting(tx, p, M.finance))).rejects.toThrow(NOT_FOUND);
  });
});

// ------------------------------------------------------------ whole-project meetings
describe("a meeting of the whole project opens only for people who see all of the project's work, and invited owners", () => {
  it("a manager with department limits gets Not found on the meeting, its calendar file and its agenda, though invited", async () => {
    await expect(svc(U.nmgr, (tx, p) => getMeeting(tx, p, M.steer))).rejects.toThrow(NOT_FOUND);
    await expect(svc(U.nmgr, (tx, p) => meetingIcs(tx, p, M.steer))).rejects.toThrow(NOT_FOUND);
    expect(await rowsAs(U.nmgr, `SELECT * FROM app_meeting_agenda_for($1)`, [M.steer])).toEqual([]);
    expect(await rowsAs(U.nmgr, `SELECT app_can_see_meeting($1) AS ok`, [M.steer])).toEqual([{ ok: false }]);
  });

  it("and nothing under it: attendees, decisions, summary and its sources, notes, transcript, follow-ups", async () => {
    for (const t of ["meetings", "meeting_attendees", "meeting_decisions", "meeting_summaries", "meeting_summary_sources", "meeting_notes", "meeting_transcripts"]) {
      const col = t === "meetings" ? "id" : "meeting_id";
      expect(await rowsAs(U.nmgr, `SELECT 1 FROM ${t} WHERE ${col} = $1`, [M.steer]), t).toEqual([]);
    }
    // Only the follow-up assigned to her: she has to do it.
    expect(await rowsAs(U.nmgr, `SELECT title FROM follow_ups WHERE meeting_id = $1`, [M.steer])).toEqual([{ title: "Assigned to the manager" }]);
  });

  it("is left out of every meeting list and the schedule", async () => {
    expect((await svc(U.nmgr, (tx, p) => listMeetings(tx, p, PN))).map((m) => m.title)).toEqual(["Finance workshop"]);
    const items = await svc(U.nmgr, (tx, p) => schedule(tx, p, { from: hour(-24), to: hour(24 * 30) }));
    expect(items.map((i) => i.title)).not.toContain("Steering committee");
    expect(items.map((i) => i.title)).not.toContain("Steering follow-up canary");
    expect((await rowsAs(U.nmgr, `SELECT item_id FROM v_schedule WHERE item_type = 'meeting'`)).map((r) => r.item_id)).not.toContain(M.steer);
  });

  it("opens, with its whole agenda, for the firm, the client's admin and a manager no department limit stops", async () => {
    for (const who of [U.lead, U.cons, U.admin, U.ncadmin, U.nsponsor]) {
      const m = await svc(who, (tx, p) => getMeeting(tx, p, M.steer));
      expect(m.meeting.agendaMd, who).toContain("Finance canary");
      expect(m.meeting.agendaMd, who).toContain("Wide canary");
      expect([m.agendaWithheld, m.agendaOwn]).toEqual([false, false]);
    }
    // At a client with departments switched off, every manager reads all of the work.
    const { rows } = await owner.query(`SELECT app_user_reads_all_actions($1, $2, NULL) AS ok`, [U.radmin, PR]);
    expect(rows).toEqual([{ ok: true }]);
  });

  it("an action owner invited to it opens it and sees only her own actions on its agenda", async () => {
    const m = await svc(U.owner, (tx, p) => getMeeting(tx, p, M.steer));
    expect(m.meeting.title).toBe("Steering committee");
    expect(m.agendaOwn).toBe(true);
    expect(m.meeting.agendaMd).toContain("Wide canary");
    expect(JSON.stringify(m)).not.toMatch(/Finance canary|Board canary/);
    // The stored text never reaches her.
    const fn = (await rowsAs(U.owner, `SELECT * FROM app_meeting_agenda_for($1)`, [M.steer]))[0];
    expect(fn).toMatchObject({ withheld: false, own: true });
    expect(fn.agenda).not.toContain("Finance canary");
  });

  it("owner@rawdah.test (a client with no departments), invited to a meeting of the whole project, opens it and sees only her own actions", async () => {
    const m = await svc(U.rowner, (tx, p) => getMeeting(tx, p, M.rawdah));
    expect(m.meeting.title).toBe("Rawdah steering");
    expect(m.agendaOwn).toBe(true);
    expect(m.meeting.agendaMd).toContain("Rawdah owner canary");
    expect(JSON.stringify(m)).not.toContain("Rawdah colleague canary");
    expect((await svc(U.rowner, (tx, p) => meetingIcs(tx, p, M.rawdah))).status).toBe(200);
    // Her colleague's actions are on the stored agenda, which the client's admin reads.
    expect((await svc(U.radmin, (tx, p) => getMeeting(tx, p, M.rawdah))).meeting.agendaMd).toContain("Rawdah colleague canary");
  });

  it("an action owner not invited gets Not found, and it is not on her list", async () => {
    for (const [who, mid, pid] of [
      [U.rowner, M.rawdahUninvited, PR],
      [U.rmate, M.rawdah, PR],
      [U.fin, M.steer, PN],
    ] as const) {
      await expect(svc(who, (tx, p) => getMeeting(tx, p, mid))).rejects.toThrow(NOT_FOUND);
      await expect(svc(who, (tx, p) => meetingIcs(tx, p, mid))).rejects.toThrow(NOT_FOUND);
      expect((await svc(who, (tx, p) => listMeetings(tx, p, pid))).map((m) => m.id)).not.toContain(mid);
    }
  });
});

// ------------------------------------------------------------ who sees everything
// The lead's ruling on the review (17 Nov): "may see everything on the project" is stable. Firm
// staff on the project, the client's admin, and a client manager when the client has departments
// off or when she is in every active department. It moves only with departments and memberships,
// never when the firm releases work. Before 0084 it looked at the released work, so a manager in
// two of three departments saw everything while the third had none.
describe("who may see everything on the project", () => {
  const opens = async (who: string, mid = M.steer) => (await rowsAs(who, `SELECT app_can_see_meeting($1) AS ok`, [mid]))[0].ok as boolean;

  it("a manager in all but one department does not, though that department has no work yet", async () => {
    expect(await opens(U.npartial)).toBe(false);
    await expect(svc(U.npartial, (tx, p) => getMeeting(tx, p, M.steer))).rejects.toThrow(NOT_FOUND);
    expect((await svc(U.npartial, (tx, p) => meetingInvitees(tx, p, PN))).wholeProject).toBe(false);
    await expect(book(U.npartial, PN, { title: "Everything" })).rejects.toThrow(/one of your departments/);
    const list = await svc(U.lead, (tx, p) => meetingInvitees(tx, p, PN));
    expect(list.people.find((p) => p.userId === U.npartial)?.wholeProject).toBe(false);
  });

  it("the answer does not move when the firm releases work in a department", async () => {
    expect([await opens(U.nsponsor), await opens(U.npartial), await opens(U.nmgr)]).toEqual([true, false, false]);
    const legal = id(46);
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, department_id, created_by)
       VALUES ($1,$2,$3,$4,'Legal canary',$5,'draft',app_firm_today() + 10,$6,$7)`,
      [legal, PN, NUKHBA, REC.all, U.owner, DEPT.legal, U.lead],
    );
    try {
      await owner.query(`UPDATE actions SET status = 'assigned' WHERE id = $1`, [legal]);
      expect([await opens(U.nsponsor), await opens(U.npartial), await opens(U.nmgr)]).toEqual([true, false, false]);
    } finally {
      await owner.query(`DELETE FROM actions WHERE id = $1`, [legal]);
    }
  });

  it("moves with memberships: joining the last department opens it, and leaving one closes it", async () => {
    await owner.query(`INSERT INTO department_members (department_id, user_id) VALUES ($1,$2)`, [DEPT.legal, U.npartial]);
    try {
      expect(await opens(U.npartial)).toBe(true);
    } finally {
      await owner.query(`DELETE FROM department_members WHERE department_id = $1 AND user_id = $2`, [DEPT.legal, U.npartial]);
    }
    expect(await opens(U.npartial)).toBe(false);
  });
});

// ------------------------------------------------------------ booking and the warning
describe("booking a meeting of the whole project", () => {
  it("the invite list says who could not open it, with their departments, so the form warns before saving", async () => {
    const list = await svc(U.lead, (tx, p) => meetingInvitees(tx, p, PN));
    const person = (uid: string) => list.people.find((p) => p.userId === uid)!;
    expect(person(U.nmgr)).toMatchObject({ wholeProject: false, departmentIds: [DEPT.board] });
    for (const uid of [U.nsponsor, U.ncadmin, U.owner, U.fin, U.cons]) expect(person(uid).wholeProject, uid).toBe(true);
    // The form's rule: the limited manager, by name, and nobody for a department's meeting.
    expect(leftOutOfMeeting(list.people, [U.nmgr, U.owner, U.nsponsor], null).map((p) => p.name)).toEqual(["nmgr"]);
    expect(leftOutOfMeeting(list.people, [U.nmgr], DEPT.board)).toEqual([]);
    // The departments the firm may book a meeting for, to offer instead.
    expect(list.departments.map((d) => d.nameEn).sort()).toEqual(["Board secretariat", "Finance", "Legal"]);
    expect(list.wholeProject).toBe(true);
  });

  it("is not for a manager with department limits: she books one for her department", async () => {
    const mine = await svc(U.nmgr, (tx, p) => meetingInvitees(tx, p, PN));
    expect(mine.wholeProject).toBe(false);
    expect(mine.departments.map((d) => d.nameEn)).toEqual(["Board secretariat"]);
    await expect(book(U.nmgr, PN, { title: "Peek at everything" })).rejects.toThrow(/one of your departments/);
    await expect(
      as(U.nmgr, (c) =>
        c.query(
          `INSERT INTO meetings (project_id, org_id, kind, title, starts_at, ends_at, location, join_url, organizer_id, ics_uid)
           VALUES ($1,$2,'status','Peek',now() + interval '1 day',now() + interval '25 hours','online',$3,$4,'x')`,
          [PN, NUKHBA, MEET, U.nmgr],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const board = await book(U.nmgr, PN, { title: "Board prep", departmentId: DEPT.board });
    expect((await svc(U.nmgr, (tx, p) => getMeeting(tx, p, board.id))).meeting.title).toBe("Board prep");
    await owner.query(`DELETE FROM meetings WHERE id = $1`, [board.id]);
    // A manager no limit stops still books one for the whole project.
    const all = await book(U.nsponsor, PN, { title: "Sponsor review" });
    await owner.query(`DELETE FROM meetings WHERE id = $1`, [all.id]);
  });

  it("the invitation e-mail and calendar file the limited manager was sent carry no agenda", async () => {
    await owner.query(`DELETE FROM outbound_emails`);
    const sent = await book(U.lead, PN, { title: "Steering next round", attendees: [{ userId: U.nmgr }], sendInvites: true });
    expect(sent.queued).toBe(1);
    const mails: OutgoingMail[] = [];
    await runMail(owner, async (m) => void mails.push(m), "https://selah.example");
    const toHer = mails.filter((m) => m.to === "nmgr@example.test");
    expect(toHer).toHaveLength(1);
    const everything = JSON.stringify(toHer);
    for (const t of TITLES) expect(everything).not.toContain(t);
    expect(toHer[0]!.icalEvent?.content).toContain("SUMMARY:Steering next round");
    // And the calendar file is Not found for her, the meeting being one she cannot open.
    await expect(svc(U.nmgr, (tx, p) => meetingIcs(tx, p, sent.id))).rejects.toThrow(NOT_FOUND);
  });
});
