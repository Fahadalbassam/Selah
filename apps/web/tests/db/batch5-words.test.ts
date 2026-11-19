// Batch 5 (D3), the two new reads behind the status words, against the database:
// - listMeetings().unanswered: the reader's own invitation, not answered, on a
//   meeting not yet over, is what makes the Meetings list say "Waiting for you"
//   (review B1: the first version compared the attendee row with itself; S5:
//   a meeting already over never waits for an answer);
// - listProjects().nextDue: the next due date on a Projects card comes from
//   the actions the reader may read, so an action owner never learns a
//   colleague's earlier date (review S6).
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { meetingPlacement, wordKey } from "@/lib/status-words";
import { bookMeeting, listMeetings, respond } from "@/services/meetings";
import { loadPrincipal } from "@/services/principal";
import { listProjects } from "@/services/queries";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 3 });

const id = (n: number) => `00000000-0000-4000-b55b-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const CLIENT = id(2);
const P = id(3);
const REC = id(4);
const A = { mine: id(5), mate: id(6), done: id(7) };
const U = { lead: id(11), admin: id(12), own: id(13), mate: id(14) };
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

let NEXT = "";
let PAST = "";

beforeAll(async () => {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name, departments_enabled) VALUES ($1,'firm','Mizan Advisory',false), ($2,'client','Rawdah',false)`, [FIRM, CLIENT]);
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [key, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, key, `${key}@example.test`]);
  await q(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$5,'consultant'), ($2,$6,'client_admin'), ($3,$6,'action_owner'), ($4,$6,'action_owner')`, [
    U.lead,
    U.admin,
    U.own,
    U.mate,
    FIRM,
    CLIENT,
  ]);
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [CLIENT, U.lead]);
  await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Governance','active',$4)`, [P, CLIENT, FIRM, U.lead]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3)`, [P, U.own, U.mate]);
  await q(`INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES ($1,$2,$3,'Board charter','shared',$4)`, [REC, P, CLIENT, U.lead]);
  const act = (aid: string, who: string, status: string, due: number) =>
    q(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, created_by, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,app_firm_today() + $9::int)`,
      [aid, P, CLIENT, REC, `Action ${aid.slice(-2)}`, who, status, U.lead, due],
    );
  await act(A.mine, U.own, "in_progress", 20);
  // The colleague's is due earlier; the owner may not read it.
  await act(A.mate, U.mate, "assigned", 5);
  // Finished work has no next date, however early.
  await act(A.done, U.own, "verified_complete", 1);

  const book = (title: string, from: number) =>
    svc(
      U.lead,
      (tx, p) =>
        bookMeeting(tx, p, P, {
          kind: "status",
          title,
          startsAt: hour(from),
          endsAt: hour(from + 1),
          location: "online",
          joinUrl: MEET,
          spokenLang: "en",
          attendees: [{ userId: U.admin }],
        }),
      true,
    );
  NEXT = (await book("Next check-in", 24)).id;
  PAST = (await book("Last week's check-in", 48)).id;
  // Over, and never marked held: still "scheduled" in the record.
  await q(`UPDATE meetings SET starts_at = now() - interval '3 days', ends_at = now() - interval '3 days' + interval '1 hour' WHERE id = $1`, [PAST]);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

const unanswered = async (userId: string) =>
  Object.fromEntries((await svc(userId, (tx, p) => listMeetings(tx, p, P))).map((m) => [m.id, m.unanswered]));

describe("a meeting waiting for the reader's answer", () => {
  it("an invited client admin who has not answered reads 'Waiting for you'", async () => {
    const mine = await unanswered(U.admin);
    expect(mine[NEXT]).toBe(true);
    expect(wordKey(meetingPlacement("scheduled", mine[NEXT]), "client")).toBe("waitingYou");
  });

  it("a meeting already over never waits for an answer", async () => {
    expect((await unanswered(U.admin))[PAST]).toBe(false);
  });

  it("the organiser does not wait for their own answer", async () => {
    const lead = await unanswered(U.lead);
    expect(lead[NEXT]).toBe(false);
    expect(wordKey(meetingPlacement("scheduled", lead[NEXT]), "firm")).toBe("notStarted");
  });

  it("once answered, the meeting has not started yet", async () => {
    await svc(U.admin, (tx, p) => respond(tx, p, NEXT, "accepted"), true);
    const mine = await unanswered(U.admin);
    expect(mine[NEXT]).toBe(false);
    expect(wordKey(meetingPlacement("scheduled", mine[NEXT]), "client")).toBe("notStarted");
  });
});

describe("the next due date on a Projects card", () => {
  const nextDue = async (userId: string) => (await svc(userId, (tx, p) => listProjects(tx, p))).find((x) => x.id === P)?.nextDue ?? null;
  const today = async (days: number) => (await owner.query(`SELECT (app_firm_today() + $1::int)::text AS d`, [days])).rows[0].d as string;

  it("the firm reads the earliest open date of the project", async () => {
    expect(await nextDue(U.lead)).toBe(await today(5));
  });

  it("an action owner reads only their own: never a colleague's earlier date, never finished work", async () => {
    expect(await nextDue(U.own)).toBe(await today(20));
  });
});
