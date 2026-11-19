// Gate B answers (product owner, 19 Nov 2026), migration 0108_privacy_batch:
//   D1  a file's assistant switch belongs to the person who uploaded it and
//       the owning side's admin, not to every manager (or consultant) of
//       that side;
//   D3  a manager with department limits is not invited to a meeting of the
//       whole project she could never open; her department's meeting is
//       offered instead, and an invitation from before the rule stops
//       nagging her;
//   B1  "I am stuck" tells the firm: the client's lead and deputy and the
//       consultants staffed on the project, each only if they may read the
//       action; the owner is still told when someone else marks it.
// Each deny case below failed before 0108 and the service changes.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { transitionAction } from "@/services/actions";
import { addAttendee, bookMeeting, getMeeting, sendInvites } from "@/services/meetings";
import { loadPrincipal } from "@/services/principal";

vi.mock("@/services/storage", () => ({
  putObject: async () => undefined,
  signedDownloadUrl: async () => "https://example.test/x",
  DOWNLOAD_TTL_SECONDS: 60,
}));
const { fileControls, loadDocument, setAssistantFlag, uploadNewVersion } = await import("@/services/documents");

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 3 });

const id = (n: number) => `00000000-0000-4000-b3e1-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2); // departments on
const P = id(3); // Acme's project
const PI = id(4); // the firm's internal project
const DEPT = { fin: id(5), hr: id(6) };
const U = {
  fadmin: id(11),
  lead: id(12), // Acme's lead consultant, staffed on P; leads PI
  deputy: id(13), // Acme's deputy, not staffed
  staff: id(14), // staffed on P and on PI
  observer: id(15), // observing P
  stranger: id(16), // a consultant on nothing of Acme's
  cadmin: id(21),
  mgrA: id(22), // client manager in Finance only: limited
  mgrB: id(23), // client manager in Finance only: limited
  mgrAll: id(24), // client manager in every department: no limit
  owner1: id(25), // action owner in Finance
};
const REC = { shared: id(31), mine: id(32), internal: id(33) };
const A = { fin: id(41), hidden: id(42), internal: id(43) };
const D = { byAdmin: id(51), byMgrB: id(52), byFadmin: id(53), byStaff: id(54) };
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
const sqlAs = (userId: string, text: string, params: unknown[] = []) => as(userId, (c) => c.query(text, params));
const q = (text: string, params: unknown[] = []) => owner.query(text, params);
// The route answers 404 for a refusal (src/server/http.ts).
const NOT_FOUND = /forbidden|not found/i;

async function doc(docId: string, by: string, ownerOrg: string, visibility = "shared", ai = false) {
  await q(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility,
       storage_key, content_type, size_bytes, sha256, scan_status, ai_indexable)
     VALUES ($1,$2,$3,$4,$5,$6,'submitted',$7,$8,$9,'application/pdf',10,'abc','clean',$10)`,
    [docId, P, ACME, ownerOrg, by, ownerOrg === FIRM ? "deliverable" : "client_document", `file ${docId.slice(-2)}`, visibility, `k-${docId}`, ai],
  );
}

beforeAll(async () => {
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name, departments_enabled) VALUES ($1,'firm','Mizan Advisory',false), ($2,'client','Acme',true)`, [FIRM, ACME]);
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$12,'firm_admin'), ($2,$12,'consultant'), ($3,$12,'consultant'), ($4,$12,'consultant'), ($5,$12,'consultant'), ($6,$12,'consultant'),
      ($7,$13,'client_admin'), ($8,$13,'client_manager'), ($9,$13,'client_manager'), ($10,$13,'client_manager'), ($11,$13,'action_owner')`,
    [U.fadmin, U.lead, U.deputy, U.staff, U.observer, U.stranger, U.cadmin, U.mgrA, U.mgrB, U.mgrAll, U.owner1, FIRM, ACME],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$2,$4,'Acme governance','active',$5), ($3,'internal',$4,$4,'Firm methods','active',$5)`,
    [P, ACME, PI, FIRM, U.fadmin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES ($1,$2,true,false), ($1,$3,false,true), ($1,$4,false,false)`, [
    ACME,
    U.lead,
    U.deputy,
    U.staff,
  ]);
  await q(
    `INSERT INTO project_members (project_id, user_id, observer, is_lead) VALUES
      ($1,$3,false,false), ($1,$4,false,false), ($1,$5,true,false), ($1,$6,false,false), ($1,$7,false,false), ($1,$8,false,false), ($1,$9,false,false),
      ($2,$3,false,true), ($2,$4,false,false)`,
    [P, PI, U.lead, U.staff, U.observer, U.mgrA, U.mgrB, U.mgrAll, U.owner1],
  );
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$3,'المالية','Finance'), ($2,$3,'الموارد البشرية','People')`, [DEPT.fin, DEPT.hr, ACME]);
  await q(
    `INSERT INTO department_members (department_id, user_id) VALUES ($1,$3), ($1,$4), ($1,$5), ($2,$5), ($1,$6)`,
    [DEPT.fin, DEPT.hr, U.mgrA, U.mgrB, U.mgrAll, U.owner1],
  );
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES
      ($1,$3,$4,'Close the books monthly','shared',$6),
      ($2,$5,$7,'Firm method notes','user_private',$6),
      ($8,$5,$7,'Firm method review','shared',$6)`,
    [REC.shared, REC.mine, P, ACME, PI, U.lead, FIRM, REC.internal],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, department_id, created_by) VALUES
      ($1,$2,$3,$4,'Monthly close checklist',$5,'in_progress',app_firm_today() + 30,$6,$7)`,
    [A.fin, P, ACME, REC.shared, U.owner1, DEPT.fin, U.lead],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by) VALUES
      ($1,$3,$4,$5,'Write the notes',$7,'in_progress',app_firm_today() + 30,$7),
      ($2,$3,$4,$6,'Review the method',$7,'in_progress',app_firm_today() + 30,$7)`,
    [A.hidden, A.internal, PI, FIRM, REC.mine, REC.internal, U.lead],
  );
  await doc(D.byAdmin, U.cadmin, ACME, "shared", true);
  await doc(D.byMgrB, U.mgrB, ACME);
  await doc(D.byFadmin, U.fadmin, FIRM, "firm_private");
  await doc(D.byStaff, U.staff, FIRM, "firm_private");
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

// ------------------------------------------------------------ D1
describe("a file's assistant switch (D1)", () => {
  const controls = (userId: string, docId: string) =>
    svc(userId, async (tx, p) => {
      const loaded = await loadDocument(tx, docId, p);
      const c = loaded ? fileControls(p, loaded) : null;
      return c ? { assistant: c.assistant, locked: c.assistantLocked } : null;
    });

  it("is offered to the uploader and the client's admin; another manager sees whose it is", async () => {
    expect(await controls(U.mgrA, D.byAdmin)).toEqual({ assistant: false, locked: "client" });
    expect(await controls(U.mgrA, D.byMgrB)).toEqual({ assistant: false, locked: "client" });
    expect(await controls(U.mgrB, D.byMgrB)).toEqual({ assistant: true, locked: null });
    expect(await controls(U.cadmin, D.byMgrB)).toEqual({ assistant: true, locked: null });
    expect(await controls(U.cadmin, D.byAdmin)).toEqual({ assistant: true, locked: null });
    // The other side is offered neither the switch nor the line.
    expect(await controls(U.lead, D.byMgrB)).toEqual({ assistant: false, locked: null });
  });

  it("a manager who did not upload it cannot switch it: Not found from the service, refused by the database", async () => {
    await expect(svc(U.mgrA, (tx, p) => setAssistantFlag(tx, p, D.byAdmin, false))).rejects.toThrow(NOT_FOUND);
    await expect(svc(U.mgrA, (tx, p) => setAssistantFlag(tx, p, D.byMgrB, true))).rejects.toThrow(NOT_FOUND);
    await expect(sqlAs(U.mgrA, `UPDATE documents SET ai_indexable = true WHERE id = $1`, [D.byMgrB])).rejects.toThrow(/only the person who uploaded/);
    await expect(sqlAs(U.mgrA, `UPDATE documents SET ai_indexable = false WHERE id = $1`, [D.byAdmin])).rejects.toThrow(/only the person who uploaded/);
  });

  it("the uploader and the client's admin can, in the service and in the database", async () => {
    expect(await svc(U.mgrB, (tx, p) => setAssistantFlag(tx, p, D.byMgrB, true))).toEqual({ id: D.byMgrB, aiIndexable: true });
    expect(await svc(U.cadmin, (tx, p) => setAssistantFlag(tx, p, D.byMgrB, true))).toEqual({ id: D.byMgrB, aiIndexable: true });
    expect((await sqlAs(U.mgrB, `UPDATE documents SET ai_indexable = true WHERE id = $1`, [D.byMgrB])).rowCount).toBe(1);
    expect((await sqlAs(U.cadmin, `UPDATE documents SET ai_indexable = false WHERE id = $1`, [D.byAdmin])).rowCount).toBe(1);
  });

  it("other edits to a file by a manager are not stopped by the rule", async () => {
    // A new version retires the old one from the assistant inside the database (0005), whoever uploads it.
    const v2 = await svc(U.mgrA, (tx, p) =>
      uploadNewVersion(tx, p, D.byAdmin, { bytes: new TextEncoder().encode("v2"), fileName: "v2.pdf", contentType: "application/pdf", sha256: "v2", scanned: true, scanMs: 1 }),
    );
    expect(v2.version).toBe(2);
  });

  it("the firm side follows the same rule: the uploader and the firm admin", async () => {
    expect(await controls(U.staff, D.byFadmin)).toEqual({ assistant: false, locked: "firm" });
    expect(await controls(U.lead, D.byStaff)).toEqual({ assistant: false, locked: "firm" });
    expect(await controls(U.staff, D.byStaff)).toEqual({ assistant: true, locked: null });
    expect(await controls(U.fadmin, D.byStaff)).toEqual({ assistant: true, locked: null });
    await expect(svc(U.lead, (tx, p) => setAssistantFlag(tx, p, D.byStaff, true))).rejects.toThrow(NOT_FOUND);
    await expect(sqlAs(U.lead, `UPDATE documents SET ai_indexable = true WHERE id = $1`, [D.byFadmin])).rejects.toThrow(/only the person who uploaded/);
    expect(await svc(U.staff, (tx, p) => setAssistantFlag(tx, p, D.byStaff, true))).toEqual({ id: D.byStaff, aiIndexable: true });
    expect(await svc(U.fadmin, (tx, p) => setAssistantFlag(tx, p, D.byStaff, true))).toEqual({ id: D.byStaff, aiIndexable: true });
  });

  it("the client's admin still cannot switch the firm's file, nor the firm the client's", async () => {
    await expect(svc(U.cadmin, (tx, p) => setAssistantFlag(tx, p, D.byFadmin, true))).rejects.toThrow(NOT_FOUND);
    await expect(svc(U.fadmin, (tx, p) => setAssistantFlag(tx, p, D.byMgrB, true))).rejects.toThrow(NOT_FOUND);
    await expect(sqlAs(U.fadmin, `UPDATE documents SET ai_indexable = true WHERE id = $1`, [D.byMgrB])).rejects.toThrow(/side that owns/);
  });
});

// ------------------------------------------------------------ D3
describe("inviting a manager with department limits (D3)", () => {
  const hour = (h: number) => new Date(Date.now() + h * 3_600_000);
  const book = (userId: string, extra: Partial<Parameters<typeof bookMeeting>[3]> = {}, commit = false) =>
    svc(
      userId,
      (tx, p) =>
        bookMeeting(tx, p, P, {
          kind: "status",
          title: "Check-in",
          startsAt: hour(24),
          endsAt: hour(25),
          location: "online",
          joinUrl: MEET,
          spokenLang: "en",
          ...extra,
        }),
      commit,
    );

  it("is refused for a meeting of the whole project, with a department's meeting offered instead", async () => {
    await expect(book(U.lead, { attendees: [{ userId: U.mgrA }] })).rejects.toThrow(/invite them to a department's meeting/);
    await expect(book(U.cadmin, { attendees: [{ userId: U.owner1 }, { userId: U.mgrA }] })).rejects.toThrow(/invite them to a department's meeting/);
  });

  it("is allowed for her department's meeting, and the whole project's is allowed for an owner and a manager with no limit", async () => {
    expect((await book(U.lead, { departmentId: DEPT.fin, attendees: [{ userId: U.mgrA }] })).id).toBeTruthy();
    expect((await book(U.lead, { attendees: [{ userId: U.owner1 }, { userId: U.mgrAll }] })).id).toBeTruthy();
  });

  it("adding her to a meeting of the whole project is refused, by the service and by the database", async () => {
    const m = await book(U.lead, { title: "Steering" }, true);
    try {
      await expect(svc(U.lead, (tx, p) => addAttendee(tx, p, m.id, { userId: U.mgrA }))).rejects.toThrow(/invite them to a department's meeting/);
      await expect(sqlAs(U.lead, `INSERT INTO meeting_attendees (meeting_id, user_id, role) VALUES ($1,$2,'required')`, [m.id, U.mgrA])).rejects.toThrow(
        /invite them to a department's meeting/,
      );
      // An action owner is still invited (she opens it and sees only her own actions).
      expect(await svc(U.lead, (tx, p) => addAttendee(tx, p, m.id, { userId: U.owner1 }))).toHaveProperty("id");
    } finally {
      await q(`DELETE FROM meetings WHERE id = $1`, [m.id]);
    }
  });

  it("an invitation from before the rule stays, reads 'cannot open' and is not sent to her again", async () => {
    const m = await book(U.lead, { title: "Old steering", attendees: [{ userId: U.mgrAll }] }, true);
    try {
      // Made before 0108 (the owner writes as a migration would have left it).
      await q(`INSERT INTO meeting_attendees (meeting_id, user_id, role) VALUES ($1,$2,'required')`, [m.id, U.mgrA]);
      const seen = await svc(U.lead, (tx, p) => getMeeting(tx, p, m.id));
      const row = (uid: string) => seen.attendees.find((a) => a.userId === uid)!;
      expect(row(U.mgrA)).toMatchObject({ response: "needs_action", cannotOpen: true });
      expect(row(U.mgrAll).cannotOpen).toBe(false);
      // She still cannot open it.
      await expect(svc(U.mgrA, (tx, p) => getMeeting(tx, p, m.id))).rejects.toThrow(NOT_FOUND);

      await q(`DELETE FROM outbound_emails`);
      expect(await svc(U.lead, (tx, p) => sendInvites(tx, p, m.id), true)).toEqual({ queued: 1 });
      const to = (await q(`SELECT to_email FROM outbound_emails WHERE meeting_id = $1`, [m.id])).rows.map((r) => r.to_email);
      expect(to).toEqual(["mgrAll@example.test"]);
      // One queued for her before the rule is not sent either; its cancellation is.
      const ok = async (kind: string) => (await q(`SELECT app_meeting_mail_ok($1, 'mgrA@example.test', $2) AS ok`, [m.id, kind])).rows[0].ok;
      expect(await ok("meeting.invite")).toBe(false);
      expect(await ok("meeting.cancel")).toBe(true);
    } finally {
      await q(`DELETE FROM outbound_emails`);
      await q(`DELETE FROM meetings WHERE id = $1`, [m.id]);
    }
  });
});

// ------------------------------------------------------------ B1
describe("'I am stuck' tells the firm (B1)", () => {
  const stuckNotices = async (aid: string) =>
    (await q(`SELECT user_id FROM notifications WHERE kind = 'action.blocked' AND entity_id = $1 ORDER BY user_id`, [aid])).rows.map((r) => r.user_id);
  const reset = async (aid: string) => {
    await q(`DELETE FROM notifications WHERE entity_id = $1`, [aid]);
    await q(`UPDATE actions SET status = 'in_progress', blocked_reason = NULL WHERE id = $1`, [aid]);
  };

  it("reaches the client's lead and deputy and the staffed consultants, not an observer, a stranger or the owner herself", async () => {
    try {
      await svc(U.owner1, (tx, p) => transitionAction(tx, p, A.fin, { to: "blocked", reason: "The bank has not sent the statements" }), true);
      expect(await stuckNotices(A.fin)).toEqual([U.lead, U.deputy, U.staff].sort());
    } finally {
      await reset(A.fin);
    }
  });

  it("keeps the notice to the owner when someone else marks it", async () => {
    try {
      // A manager in the action's department marks the owner's action stuck.
      await svc(U.mgrA, (tx, p) => transitionAction(tx, p, A.fin, { to: "blocked", reason: "Waiting for the board" }), true);
      expect(await stuckNotices(A.fin)).toEqual([U.lead, U.deputy, U.staff, U.owner1].sort());
    } finally {
      await reset(A.fin);
    }
  });

  it("does not reach someone who may not read the action", async () => {
    try {
      // A recommendation only its author sees: the other consultant on the project is not told.
      await svc(U.lead, (tx, p) => transitionAction(tx, p, A.hidden, { to: "blocked", reason: "Need the old notes" }), true);
      expect(await stuckNotices(A.hidden)).toEqual([]);
      // The same move on an action both may read tells the other consultant.
      await svc(U.lead, (tx, p) => transitionAction(tx, p, A.internal, { to: "blocked", reason: "Need the old notes" }), true);
      expect(await stuckNotices(A.internal)).toEqual([U.staff]);
    } finally {
      await reset(A.hidden);
      await reset(A.internal);
    }
  });

  it("tells only of a move the caller has just made", async () => {
    await expect(sqlAs(U.owner1, `SELECT app_tell_firm_stuck($1)`, [A.fin])).rejects.toThrow(/no stuck action/);
    await q(`UPDATE actions SET status = 'blocked', blocked_reason = 'x' WHERE id = $1`, [A.fin]);
    try {
      await expect(sqlAs(U.owner1, `SELECT app_tell_firm_stuck($1)`, [A.fin])).rejects.toThrow(/no stuck action/);
      // And nothing about an action the caller cannot read.
      await expect(sqlAs(U.mgrAll, `SELECT app_tell_firm_stuck($1)`, [A.hidden])).rejects.toThrow(/not visible|permission/);
    } finally {
      await reset(A.fin);
    }
  });
});
