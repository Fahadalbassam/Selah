// Meetings (baseline: Meetings) against a real Postgres: call links,
// calendar sequence, who books and sees what, attendees, decisions,
// summaries, invites and the schedule.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-a100-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = {
  admin: id(11),
  cons: id(12), // staffed on PROJ
  other: id(13), // consultant not on PROJ
  cmgr: id(14), // Acme manager on PROJ
  cowner: id(15), // Acme action owner on PROJ
  outsider: id(16), // Acme manager not on PROJ
  betaMgr: id(17),
};
const PROJ = id(21);
const BETA_PROJ = id(22);
const REC = id(31);
const CONTACT = id(41);
let n = 100;
const next = () => id(++n);

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
const run = (userId: string, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params), true);
const attempt = (userId: string, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params));

async function book(
  by: string,
  fields: { visibility?: string; url?: string | null; location?: string; project?: string; org?: string } = {},
) {
  const mid = next();
  await run(
    by,
    `INSERT INTO meetings (id, project_id, org_id, kind, title, starts_at, ends_at, location, join_url, organizer_id, visibility, ics_uid)
     VALUES ($1,$2,$3,'status','Monthly status', now() + interval '1 day', now() + interval '1 day 1 hour', $4, $5, $6, $7, 'x')`,
    [
      mid,
      fields.project ?? PROJ,
      fields.org ?? ACME,
      fields.location ?? "online",
      fields.url === undefined ? "https://meet.google.com/abc-defg-hij" : fields.url,
      by,
      fields.visibility ?? "shared",
    ],
  );
  return mid;
}
const meeting = async (mid: string) => (await owner.query(`SELECT * FROM meetings WHERE id = $1`, [mid])).rows[0];

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`TRUNCATE outbound_emails`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [
    FIRM,
    ACME,
    BETA,
  ]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$8,'firm_admin'), ($2,$8,'consultant'), ($3,$8,'consultant'), ($4,$9,'client_manager'),
      ($5,$9,'action_owner'), ($6,$9,'client_manager'), ($7,$10,'client_manager')`,
    [U.admin, U.cons, U.other, U.cmgr, U.cowner, U.outsider, U.betaMgr, FIRM, ACME, BETA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$3,$5,'Acme governance','active',$6), ($2,'client',$4,$5,'Beta strategy','active',$6)`,
    [PROJ, BETA_PROJ, ACME, BETA, FIRM, U.admin],
  );
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4), ($5,$6)`, [
    PROJ,
    U.cons,
    U.cmgr,
    U.cowner,
    BETA_PROJ,
    U.betaMgr,
  ]);
  await q(`INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES ($1,$2,$3,'Charter',$4)`, [
    REC,
    PROJ,
    ACME,
    U.cons,
  ]);
  await q(
    `INSERT INTO actions (project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, blocked_reason, created_by) VALUES
      ($1,$2,$3,'Adopt the charter',$4,'in_progress','2020-01-01',NULL,$5),
      ($1,$2,$3,'Approve the matrix',$4,'blocked','2099-01-01','board not convened',$5)`,
    [PROJ, ACME, REC, U.cowner, U.cons],
  );
  await q(`INSERT INTO client_contacts (id, org_id, name, email) VALUES ($1,$2,'Majed','majed@acme.example')`, [CONTACT, ACME]);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("booking", () => {
  it("takes only https call links on Meet, Teams or Zoom, and names the provider", async () => {
    for (const url of [
      "http://meet.google.com/abc",
      "https://meet.google.com.evil.example/abc",
      "https://meet.google.com@evil.example/abc",
      "https://evil.example/?u=meet.google.com",
    ]) {
      await expect(book(U.cons, { url }), url).rejects.toThrow(/Google Meet, Teams or Zoom/);
    }
    await expect(book(U.cons, { url: null })).rejects.toThrow(/meeting_online_link/);
    const zoom = await book(U.cons, { url: "https://acme.zoom.us/j/123" });
    expect((await meeting(zoom)).provider).toBe("zoom");
    const meet = await book(U.cons);
    const m = await meeting(meet);
    expect([m.provider, m.status, m.ics_sequence, m.ics_uid.endsWith("@selah")]).toEqual(["google_meet", "scheduled", 0, true]);
  });

  it("writes the agenda from the project's open work", async () => {
    const m = await meeting(await book(U.cons));
    expect(m.agenda_md).toContain("## متأخرة\n- Adopt the charter (الاستحقاق 2020-01-01)");
    expect(m.agenda_md).toContain("## متوقفة\n- Approve the matrix: board not convened");
    const en = (await owner.query(`SELECT app_meeting_agenda($1, now(), 'en') AS md`, [PROJ])).rows[0].md;
    expect(en).toContain("## Overdue\n- Adopt the charter (due 2020-01-01)");
  });

  it("is open to the firm on the project and to client managers for shared meetings", async () => {
    await book(U.cmgr);
    await expect(book(U.cmgr, { visibility: "firm_private" })).rejects.toThrow(/row-level security/);
    await expect(book(U.cowner)).rejects.toThrow(/row-level security/);
    await expect(book(U.other)).rejects.toThrow(/row-level security/);
    await expect(book(U.betaMgr)).rejects.toThrow(/row-level security/);
  });
});

describe("changes", () => {
  it("bump the calendar sequence and keep the calendar id; cancelling counts as a change", async () => {
    const mid = await book(U.cons);
    const { ics_uid } = await meeting(mid);
    await run(
      U.cons,
      `UPDATE meetings SET starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' WHERE id = $1`,
      [mid],
    );
    await run(U.cons, `UPDATE meetings SET spoken_lang = 'en' WHERE id = $1`, [mid]); // not on a calendar
    expect((await meeting(mid)).ics_sequence).toBe(1);
    await expect(run(U.cons, `UPDATE meetings SET ics_uid = 'new' WHERE id = $1`, [mid])).rejects.toThrow(/calendar id/);
    await run(U.cons, `UPDATE meetings SET status = 'cancelled' WHERE id = $1`, [mid]);
    const m = await meeting(mid);
    expect([m.ics_uid, m.ics_sequence, m.status]).toEqual([ics_uid, 2, "cancelled"]);
    await expect(run(U.cons, `UPDATE meetings SET status = 'scheduled' WHERE id = $1`, [mid])).rejects.toThrow(
      /invalid meeting status/,
    );
  });

  it("are made by the organiser or the firm, and a held meeting stays where it was", async () => {
    const mid = await book(U.cmgr);
    expect((await attempt(U.cowner, `UPDATE meetings SET title = 'x' WHERE id = $1`, [mid])).rowCount).toBe(0);
    await run(U.cons, `UPDATE meetings SET status = 'held' WHERE id = $1`, [mid]);
    await expect(run(U.cons, `UPDATE meetings SET starts_at = now() WHERE id = $1`, [mid])).rejects.toThrow(/cannot be moved/);
    await expect(run(U.cmgr, `UPDATE meetings SET visibility = 'firm_private' WHERE id = $1`, [mid])).rejects.toThrow(
      /row-level security/,
    );
  });
});

describe("firm-private meetings", () => {
  it("and their decisions and summaries are invisible to the client", async () => {
    const mid = await book(U.cons, { visibility: "firm_private" });
    await run(
      U.cons,
      `INSERT INTO meeting_decisions (project_id, org_id, meeting_id, text, visibility, created_by) VALUES ($1,$2,$3,'Staff it','firm_private',$4)`,
      [PROJ, ACME, mid, U.cons],
    );
    await run(U.cons, `UPDATE meetings SET status = 'held' WHERE id = $1`, [mid]);
    await run(
      U.cons,
      `INSERT INTO meeting_summaries (meeting_id, project_id, org_id, lang, main_points_md, confirmed_by) VALUES ($1,$2,$3,'ar','نقاط',$4)`,
      [mid, PROJ, ACME, U.admin],
    );
    expect(
      (await owner.query(`SELECT confirmed_by FROM meeting_summaries WHERE meeting_id = $1`, [mid])).rows[0].confirmed_by,
    ).toBe(U.cons);
    for (const table of ["meetings", "meeting_decisions", "meeting_summaries"]) {
      const col = table === "meetings" ? "id" : "meeting_id";
      expect((await attempt(U.cmgr, `SELECT 1 FROM ${table} WHERE ${col} = $1`, [mid])).rowCount, table).toBe(0);
      expect((await attempt(U.cons, `SELECT 1 FROM ${table} WHERE ${col} = $1`, [mid])).rowCount, table).toBe(1);
    }
    await expect(
      run(
        U.cons,
        `INSERT INTO meeting_decisions (project_id, org_id, meeting_id, text, visibility, created_by) VALUES ($1,$2,$3,'Leak','shared',$4)`,
        [PROJ, ACME, mid, U.cons],
      ),
    ).rejects.toThrow(/keeps its records firm-private/);
  });
});

describe("attendees", () => {
  const add = (by: string, mid: string, who: { user?: string; contact?: string }, role = "required") =>
    run(by, `INSERT INTO meeting_attendees (meeting_id, user_id, contact_id, role) VALUES ($1,$2,$3,$4)`, [
      mid,
      who.user ?? null,
      who.contact ?? null,
      role,
    ]);

  it("are people who can open the project, or the client's contacts added by the firm", async () => {
    const mid = await book(U.cons);
    await add(U.cons, mid, { user: U.cons }, "organizer");
    await add(U.cons, mid, { user: U.cmgr });
    await add(U.cons, mid, { contact: CONTACT });
    for (const who of [U.outsider, U.other, U.betaMgr]) {
      await expect(add(U.cons, mid, { user: who }), who).rejects.toThrow(/cannot open this meeting's project/);
    }
    const shared = await book(U.cmgr);
    await expect(add(U.cmgr, shared, { contact: CONTACT })).rejects.toThrow(/invited by the firm/);
    const private_ = await book(U.cons, { visibility: "firm_private" });
    await expect(add(U.cons, private_, { user: U.cmgr })).rejects.toThrow(/cannot open/);
    await expect(add(U.cons, private_, { contact: CONTACT })).rejects.toThrow(/cannot be invited/);
    const rows = (
      await owner.query(
        `SELECT user_id, response FROM meeting_attendees WHERE meeting_id = $1 AND user_id IS NOT NULL ORDER BY role`,
        [mid],
      )
    ).rows;
    expect(rows).toEqual([
      { user_id: U.cons, response: "accepted" },
      { user_id: U.cmgr, response: "needs_action" },
    ]);
  });

  it("answer for themselves only, and get the invite by mail", async () => {
    const mid = await book(U.cons);
    await add(U.cons, mid, { user: U.cmgr });
    await add(U.cons, mid, { user: U.cowner });
    await add(U.cons, mid, { contact: CONTACT });
    await run(U.cmgr, `UPDATE meeting_attendees SET response = 'accepted' WHERE meeting_id = $1 AND user_id = $2`, [mid, U.cmgr]);
    await expect(
      run(U.cmgr, `UPDATE meeting_attendees SET role = 'optional' WHERE meeting_id = $1 AND user_id = $2`, [mid, U.cmgr]),
    ).rejects.toThrow(/only answers/);
    expect(
      (
        await attempt(U.cmgr, `UPDATE meeting_attendees SET response = 'declined' WHERE meeting_id = $1 AND user_id = $2`, [
          mid,
          U.cowner,
        ])
      ).rowCount,
    ).toBe(0);
    expect((await run(U.cons, `SELECT app_send_meeting_invites($1) AS n`, [mid])).rows[0].n).toBe(3);
    await expect(run(U.cowner, `SELECT app_send_meeting_invites($1)`, [mid])).rejects.toThrow(/not allowed/);
    await run(U.cons, `UPDATE meetings SET status = 'cancelled' WHERE id = $1`, [mid]);
    await run(U.cons, `SELECT app_send_meeting_invites($1)`, [mid]);
    const mail = (
      await owner.query(`SELECT kind, count(*)::int AS n FROM outbound_emails WHERE meeting_id = $1 GROUP BY 1 ORDER BY 1`, [mid])
    ).rows;
    expect(mail).toEqual([
      { kind: "meeting.cancel", n: 3 },
      { kind: "meeting.invite", n: 3 },
    ]);
  });
});

describe("decisions and summaries", () => {
  it("decisions are append-only, and a correction replaces one of the same meeting", async () => {
    const mid = await book(U.cons);
    const other = await book(U.cons);
    const decide = (meetingId: string, supersedes: string | null = null, by = U.cons) =>
      run(
        by,
        `INSERT INTO meeting_decisions (project_id, org_id, meeting_id, text, supersedes_id, created_by) VALUES ($1,$2,$3,'Adopt',$4,$5) RETURNING id`,
        [PROJ, ACME, meetingId, supersedes, by],
      );
    const first = (await decide(mid)).rows[0].id;
    await decide(mid, first);
    await expect(decide(other, first)).rejects.toThrow(/same meeting/);
    await expect(decide(mid, null, U.cmgr)).rejects.toThrow(/row-level security/);
    await expect(run(U.cons, `UPDATE meeting_decisions SET text = 'x' WHERE id = $1`, [first])).rejects.toThrow(
      /permission denied/,
    );
    await expect(owner.query(`DELETE FROM meeting_decisions WHERE id = $1`, [first])).rejects.toThrow(
      /append-only|not allowed|forbid/i,
    );
  });

  it("a summary waits until the meeting is held", async () => {
    const mid = await book(U.cons);
    const write = () =>
      run(
        U.cons,
        `INSERT INTO meeting_summaries (meeting_id, project_id, org_id, lang, main_points_md, confirmed_by) VALUES ($1,$2,$3,'en','Points',$4)`,
        [mid, PROJ, ACME, U.cons],
      );
    await expect(write()).rejects.toThrow(/held before writing/);
    await run(U.cons, `UPDATE meetings SET status = 'held' WHERE id = $1`, [mid]);
    await write();
  });
});

describe("the schedule", () => {
  it("shows each person only what they can already see", async () => {
    const shared = await book(U.cons);
    const private_ = await book(U.cons, { visibility: "firm_private" });
    const items = async (uid: string) => (await attempt(uid, `SELECT item_type, item_id FROM v_schedule`)).rows;
    const cons = await items(U.cons);
    expect(cons.map((r) => r.item_id)).toEqual(expect.arrayContaining([shared, private_]));
    expect(cons.filter((r) => r.item_type === "action")).toHaveLength(2);
    const client = (await items(U.cmgr)).map((r) => r.item_id);
    expect(client).toContain(shared);
    expect(client).not.toContain(private_);
    expect(await items(U.betaMgr)).toEqual([]);
    expect(await items(U.other)).toEqual([]);
    const mine = await attempt(
      U.cowner,
      `SELECT title FROM v_schedule WHERE item_type = 'action' AND $1 = ANY (people) ORDER BY 1`,
      [U.cowner],
    );
    expect(mine.rows.map((r) => r.title)).toEqual(["Adopt the charter", "Approve the matrix"]);
  });
});
