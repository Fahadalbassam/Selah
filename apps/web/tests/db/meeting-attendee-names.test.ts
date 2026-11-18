// Attendee names follow the meeting, not the user-row rule (screen re-check
// of batch 0, fault 2; the lead's decision: anyone who may open a meeting
// sees the names of its attendees, and nothing else about them).
//
// At Rawdah the client's admin is not a project member, so an action owner
// invited with her could not read her user row (app_can_see_user), and the
// meeting page drew her as a nameless "—". The names now come from
// app_meeting_attendee_names() (migration 0093): names only, only for a
// meeting the caller can open. The user-row rule itself is unchanged.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { bookMeeting, getMeeting } from "@/services/meetings";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 3 });

const id = (n: number) => `00000000-0000-4000-a77e-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const RAWDAH = id(2); // departments off
const OTHER = id(3); // another client of the firm
const PR = id(4);
const PO = id(5);
const NUKHBA = id(6); // departments on
const PN = id(7);
const DEPT = { board: id(8), fin: id(9) };
const U = {
  lead: id(11), // the firm's lead consultant on all three clients
  radmin: id(12), // Rawdah's admin: not a member of the project
  rowner: id(13), // owner@rawdah.test: an action owner on the project, invited
  rmate: id(14), // her colleague, an action owner on the project, not invited
  oadmin: id(15), // the other client's admin
  oowner: id(16), // an action owner at the other client
  nadmin: id(17), // Nukhba's admin
  nmgr: id(18), // manager@nukhba.test: a manager in the Board secretariat only, on the project
};
const NAMES: Record<keyof typeof U, string> = {
  lead: "Majid Al-Subaie",
  radmin: "Hind Al-Zahrani",
  rowner: "Dana Al-Omari",
  rmate: "Sara Colleague",
  oadmin: "Other Admin",
  oowner: "Other Owner",
  nadmin: "Fahd Al-Dosari",
  nmgr: "Reem Al-Harbi",
};
const MEET = "https://meet.google.com/abc-defg-hij";
const NOT_FOUND = /forbidden|not found/i;

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
const rowsAs = async (userId: string, text: string, params: unknown[] = []) => (await as(userId, (c) => c.query(text, params))).rows;
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

let MEETING = "";
let OTHER_MEETING = "";
let STEERING = "";

beforeAll(async () => {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name, departments_enabled) VALUES ($1,'firm','Mizan Advisory',false), ($2,'client','Rawdah',false), ($3,'client','Other',false)`, [
    FIRM,
    RAWDAH,
    OTHER,
  ]);
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [key, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, NAMES[key as keyof typeof U], `${key}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$7,'consultant'), ($2,$8,'client_admin'), ($3,$8,'action_owner'), ($4,$8,'action_owner'), ($5,$9,'client_admin'), ($6,$9,'action_owner')`,
    [U.lead, U.radmin, U.rowner, U.rmate, U.oadmin, U.oowner, FIRM, RAWDAH, OTHER],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$3,true), ($2,$3,true)`, [RAWDAH, OTHER, U.lead]);
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$2,$5,'Rawdah governance','active',$6), ($3,'client',$4,$5,'Other governance','active',$6)`,
    [PR, RAWDAH, PO, OTHER, FIRM, U.lead],
  );
  // The client's admin is not a project member (as at Rawdah in the walkthrough); the owners are.
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$3), ($1,$4), ($2,$5)`, [PR, PO, U.rowner, U.rmate, U.oowner]);
  // Al-Nukhba: departments on, and a manager in one of its two departments, so she may not see
  // everything on the project and a meeting of the whole project does not open for her (decision 1a).
  await q(`INSERT INTO organizations (id, kind, name, departments_enabled) VALUES ($1,'client','Al-Nukhba',true)`, [NUKHBA]);
  await q(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$3,'client_admin'), ($2,$3,'client_manager')`, [U.nadmin, U.nmgr, NUKHBA]);
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [NUKHBA, U.lead]);
  await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Nukhba governance','active',$4)`, [
    PN,
    NUKHBA,
    FIRM,
    U.lead,
  ]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [PN, U.nmgr]);
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$3,'أمانة المجلس','Board secretariat'), ($2,$3,'المالية','Finance')`, [
    DEPT.board,
    DEPT.fin,
    NUKHBA,
  ]);
  await q(`INSERT INTO department_members (department_id, user_id) VALUES ($1,$2)`, [DEPT.board, U.nmgr]);
  const book = (projectId: string, title: string, attendees: string[]) =>
    svc(
      U.lead,
      (tx, p) =>
        bookMeeting(tx, p, projectId, {
          kind: "status",
          title,
          startsAt: hour(24),
          endsAt: hour(25),
          location: "online",
          joinUrl: MEET,
          spokenLang: "en",
          attendees: attendees.map((userId) => ({ userId })),
        }),
      true,
    );
  // The whole project, as "Hand-over of the quarterly reviews" in the walkthrough.
  MEETING = (await book(PR, "Hand-over", [U.radmin, U.rowner])).id;
  OTHER_MEETING = (await book(PO, "Other check-in", [U.oadmin, U.oowner])).id;
  // The whole project, inviting the limited manager anyway (as on the steering meetings in the walkthrough).
  STEERING = (await book(PN, "Steering committee", [U.nadmin, U.nmgr])).id;
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

const namesOn = (m: Awaited<ReturnType<typeof getMeeting>>) => Object.fromEntries(m.attendees.map((a) => [a.userId, a.name]));

describe("an attendee's name on a meeting", () => {
  it("the invited Rawdah owner sees the client admin's name on her meeting, as everyone who opens it does", async () => {
    const mine = namesOn(await svc(U.rowner, (tx, p) => getMeeting(tx, p, MEETING)));
    expect(mine).toEqual({ [U.lead]: NAMES.lead, [U.radmin]: NAMES.radmin, [U.rowner]: NAMES.rowner });
    for (const who of [U.lead, U.radmin]) {
      expect(namesOn(await svc(who, (tx, p) => getMeeting(tx, p, MEETING))), who).toEqual(mine);
    }
  });

  it("is the name and nothing else: the user-row rule is unchanged", async () => {
    const rows = await rowsAs(U.rowner, `SELECT * FROM app_meeting_attendee_names($1) ORDER BY name`, [MEETING]);
    expect(rows.map((r) => Object.keys(r).sort())).toEqual([
      ["name", "user_id"],
      ["name", "user_id"],
      ["name", "user_id"],
    ]);
    // She still cannot read the admin's user row (address included), as before.
    expect(await rowsAs(U.rowner, `SELECT name, email FROM "user" WHERE id = $1`, [U.radmin])).toEqual([]);
    const m = await svc(U.rowner, (tx, p) => getMeeting(tx, p, MEETING));
    expect(JSON.stringify(m)).not.toContain("radmin@example.test");
  });

  it("is nothing for someone who cannot open the meeting: a colleague not invited", async () => {
    await expect(svc(U.rmate, (tx, p) => getMeeting(tx, p, MEETING))).rejects.toThrow(NOT_FOUND);
    expect(await rowsAs(U.rmate, `SELECT * FROM app_meeting_attendee_names($1)`, [MEETING])).toEqual([]);
  });

  // Being invited is not opening: the names go with the meeting, not with the invitation (review of
  // this fix, S1: a function that also answered attendees passed every other meeting test).
  it("is nothing for someone invited who may not open it: a manager limited to her department, on a meeting of the whole project", async () => {
    const invited = await owner.query(`SELECT 1 FROM meeting_attendees WHERE meeting_id = $1 AND user_id = $2`, [STEERING, U.nmgr]);
    expect(invited.rowCount).toBe(1);
    await expect(svc(U.nmgr, (tx, p) => getMeeting(tx, p, STEERING))).rejects.toThrow(NOT_FOUND);
    expect(await rowsAs(U.nmgr, `SELECT * FROM app_meeting_attendee_names($1)`, [STEERING])).toEqual([]);
    // The client's admin, who may open it, reads them.
    expect(namesOn(await svc(U.nadmin, (tx, p) => getMeeting(tx, p, STEERING)))).toEqual({
      [U.lead]: NAMES.lead,
      [U.nadmin]: NAMES.nadmin,
      [U.nmgr]: NAMES.nmgr,
    });
  });

  it("is nothing for another client, its admin or its owner", async () => {
    for (const who of [U.oadmin, U.oowner]) {
      await expect(svc(who, (tx, p) => getMeeting(tx, p, MEETING)), who).rejects.toThrow(NOT_FOUND);
      expect(await rowsAs(who, `SELECT * FROM app_meeting_attendee_names($1)`, [MEETING]), who).toEqual([]);
    }
    // And the other way round: Rawdah's people get nothing about the other client's meeting.
    for (const who of [U.radmin, U.rowner]) {
      expect(await rowsAs(who, `SELECT * FROM app_meeting_attendee_names($1)`, [OTHER_MEETING]), who).toEqual([]);
    }
  });

  it("is nothing for a meeting that does not exist, and the function is not callable by the public", async () => {
    expect(await rowsAs(U.lead, `SELECT * FROM app_meeting_attendee_names($1)`, [id(99)])).toEqual([]);
    const [acl] = (
      await owner.query(
        `SELECT p.prosecdef AS definer, has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec, has_function_privilege('selah_app', p.oid, 'EXECUTE') AS app_exec
         FROM pg_proc p WHERE p.proname = 'app_meeting_attendee_names'`,
      )
    ).rows;
    expect(acl).toEqual({ definer: true, public_exec: false, app_exec: true });
  });
});
