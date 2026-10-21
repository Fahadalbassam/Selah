// Booking with attendees, whom a booker can invite, and follow-ups out of a
// meeting (migrations 0037-0038) against a real Postgres.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { addFollowUp, bookMeeting, getMeeting, meetingInvitees, recordDecision, updateFollowUp } from "@/services/meetings";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-f700-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const PROJ = id(3);
const CONTACT = id(5);
const U = { admin: id(11), cons: id(12), other: id(13), cmgr: id(14), cadm: id(15) };
const MEET = "https://meet.google.com/abc-defg-hij";

async function as<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
const sqlAs = (userId: string, text: string, params: unknown[] = []) => as(userId, (c) => c.query(text, params));
async function svc<R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>): Promise<R> {
  return as(userId, async (c) => {
    const tx = drizzle(c, { schema }) as unknown as Tx;
    const p = await loadPrincipal(tx, userId);
    return fn(tx, p!).catch((e: Error & { cause?: Error }) => {
      throw new Error(e.cause ? `${e.message} | ${e.cause.message}` : e.message);
    });
  });
}
const hour = (h: number) => new Date(Date.now() + h * 3_600_000);
const book = (userId: string, extra: Partial<Parameters<typeof bookMeeting>[3]> = {}) =>
  svc(userId, (tx, p) =>
    bookMeeting(tx, p, PROJ, {
      kind: "status",
      title: "Monthly status",
      startsAt: hour(24),
      endsAt: hour(25),
      location: "online",
      joinUrl: MEET,
      ...extra,
    }),
  );
const held = (mid: string) => owner.query(`UPDATE meetings SET status = 'held' WHERE id = $1`, [mid]);

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme')`, [FIRM, ACME]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
       ($1,$6,'firm_admin'), ($2,$6,'consultant'), ($3,$6,'consultant'), ($4,$7,'client_manager'), ($5,$7,'client_admin')`,
    [U.admin, U.cons, U.other, U.cmgr, U.cadm, FIRM, ACME],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Acme governance','active',$4)`,
    [PROJ, ACME, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id) VALUES ($1,$2)`, [ACME, U.cons]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3)`, [PROJ, U.cons, U.cmgr]);
  await q(`INSERT INTO client_contacts (id, org_id, name, email) VALUES ($1,$2,'Majed','majed@acme.example')`, [CONTACT, ACME]);
});

beforeEach(async () => {
  await owner.query(`TRUNCATE meetings CASCADE`);
  await owner.query(`TRUNCATE outbound_emails`);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("booking a meeting", () => {
  it("adds the attendees and queues the invites in the same step", async () => {
    const { id: mid, queued } = await book(U.cons, {
      attendees: [{ userId: U.cmgr }, { contactId: CONTACT, optional: true }, { userId: U.cons }],
      sendInvites: true,
    });
    expect(queued).toBe(2);
    const roles = (await owner.query(`SELECT role FROM meeting_attendees WHERE meeting_id = $1 ORDER BY role`, [mid])).rows;
    expect(roles.map((r) => r.role)).toEqual(["organizer", "required", "optional"]);
    expect((await owner.query(`SELECT to_email FROM outbound_emails ORDER BY 1`)).rows.map((r) => r.to_email)).toEqual([
      "cmgr@example.test",
      "majed@acme.example",
    ]);
  });

  it("is all or nothing: one attendee who can't open the project stops the booking", async () => {
    await expect(book(U.cons, { attendees: [{ userId: U.cmgr }, { userId: U.other }] })).rejects.toThrow(/cannot open/);
    await expect(book(U.cons, { visibility: "firm_private", attendees: [{ userId: U.cmgr }] })).rejects.toThrow(/cannot open/);
    await expect(book(U.cmgr, { attendees: [{ contactId: CONTACT }] })).rejects.toThrow(/contacts are invited by the firm/);
    expect((await owner.query(`SELECT count(*)::int AS n FROM meetings`)).rows[0].n).toBe(0);
  });
});

describe("whom a booker can invite", () => {
  it("the firm sees everyone who can open the project and the client's contacts", async () => {
    const out = await svc(U.cons, (tx, p) => meetingInvitees(tx, p, PROJ));
    expect(out.people.map((x) => x.name).sort()).toEqual(["admin", "cadm", "cmgr", "cons"]);
    expect(out.contacts.map((c) => c.name)).toEqual(["Majed"]);
  });

  it("a client sees its own people and the firm staff on the project, never the contact list", async () => {
    const out = await svc(U.cmgr, (tx, p) => meetingInvitees(tx, p, PROJ));
    expect(out.people.map((x) => x.name).sort()).toEqual(["cadm", "cmgr", "cons"]);
    expect(out.contacts).toEqual([]);
    // Off the project: nothing at all.
    expect((await sqlAs(U.other, `SELECT * FROM app_meeting_invitees($1)`, [PROJ])).rows).toEqual([]);
  });
});

describe("follow-ups out of a meeting", () => {
  it("follow a decision of the same meeting and show on its page", async () => {
    const { id: mid } = await book(U.cons);
    await held(mid);
    const d = await svc(U.cons, (tx, p) => recordDecision(tx, p, mid, { text: "Adopt the charter", lang: "en" }));
    await svc(U.cons, (tx, p) =>
      addFollowUp(tx, p, mid, { title: "Send the draft charter", decisionId: d.id, assigneeUserId: U.cmgr, dueAt: hour(72) }),
    );
    const page = await svc(U.cmgr, (tx, p) => getMeeting(tx, p, mid));
    expect(page.followUps).toMatchObject([
      { title: "Send the draft charter", decisionId: d.id, assignee: "cmgr", status: "open" },
    ]);
    expect(page.canFollowUp).toBe(false);

    // Another meeting's decision is refused.
    const { id: other } = await book(U.cons);
    await expect(svc(U.cons, (tx, p) => addFollowUp(tx, p, other, { title: "Wrong one", decisionId: d.id }))).rejects.toThrow(
      /another meeting/,
    );
  });

  it("are never more visible than the meeting, and go only to someone who can open it", async () => {
    const { id: mid } = await book(U.cons, { visibility: "firm_private" });
    await expect(
      svc(U.cons, (tx, p) => addFollowUp(tx, p, mid, { title: "Tell the client", visibility: "shared" })),
    ).rejects.toThrow(/firm-private/);
    await expect(svc(U.cons, (tx, p) => addFollowUp(tx, p, mid, { title: "Ask Acme", assigneeUserId: U.cmgr }))).rejects.toThrow(
      /cannot open/,
    );
    const { id: shared } = await book(U.cons);
    await expect(
      svc(U.cons, (tx, p) => addFollowUp(tx, p, shared, { title: "Ask Acme", assigneeUserId: U.other })),
    ).rejects.toThrow(/cannot open/);
    // The client never writes one.
    await expect(svc(U.cmgr, (tx, p) => addFollowUp(tx, p, shared, { title: "Ours" }))).rejects.toThrow();
  });

  it("the assignee marks their own one done, and changes nothing else", async () => {
    const { id: mid } = await book(U.cons);
    const f = await svc(U.cons, (tx, p) => addFollowUp(tx, p, mid, { title: "Send the minutes", assigneeUserId: U.cmgr }));
    await svc(U.cmgr, (tx, p) => updateFollowUp(tx, p, f.id, { status: "done" }));
    expect((await owner.query(`SELECT status::text FROM follow_ups`)).rows[0].status).toBe("done");
    await expect(svc(U.cmgr, (tx, p) => updateFollowUp(tx, p, f.id, { title: "Changed" }))).rejects.toThrow(/only mark it done/);
    await expect(sqlAs(U.cmgr, `UPDATE follow_ups SET title = 'Changed'`)).rejects.toThrow(/only marks a follow-up done/);
    // Someone else on the client side can't touch it.
    expect((await sqlAs(U.cadm, `UPDATE follow_ups SET status = 'open'`)).rowCount).toBe(0);
    // Nor can it be moved to another meeting.
    const { id: other } = await book(U.cons);
    await expect(sqlAs(U.cons, `UPDATE follow_ups SET meeting_id = $1`, [other])).rejects.toThrow(/keeps its project/);
    await svc(U.cons, (tx, p) => updateFollowUp(tx, p, f.id, { status: "open", title: "Send the signed minutes" }));
  });
});
