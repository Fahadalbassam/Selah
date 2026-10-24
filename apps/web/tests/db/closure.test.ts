// Closing a project (baseline: Closing, 0020; full picture item 25, gaps N5
// and N9) against a real Postgres: who closes, what must be settled first,
// that a closed project is read-only for everyone, reopening with a reason,
// the client's request to close, and that no other client sees any of it.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { closureDisposition } from "@/db/schema";
import { DISPOSITIONS, FROZEN_TABLES } from "@/lib/closure";
import {
  declineClosureRequest,
  disposeAction,
  getClosure,
  moveClosure,
  nameSustainer,
  requestClosure,
  writeLessons,
} from "@/services/closure";
import { loadPrincipal } from "@/services/principal";
import { dashboard } from "@/services/queries";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c160-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = {
  admin: id(11),
  lead: id(12), // Acme's lead consultant
  cons: id(13), // staffed on PROJ and INTERNAL (not its lead)
  ilead: id(14), // lead of the internal project
  cadmin: id(15),
  sponsor: id(16), // Acme client manager, the sponsor
  cmgr: id(17), // Acme client manager, not the sponsor
  cowner: id(18),
  betaMgr: id(19),
};
const PROJ = id(21);
const INTERNAL = id(22);
const BETA_PROJ = id(23);
const REC = id(31);
const IREC = id(32);
const CONTACT = id(41);
let n = 100;
const next = () => id(++n);

async function as<T>(userId: string | null, fn: (c: PoolClient) => Promise<T>, commit = false): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    if (userId) await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
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
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    true,
  );
const state = async (pid: string) => (await owner.query(`SELECT state::text AS s FROM projects WHERE id = $1`, [pid])).rows[0].s as string;
const blockers = (userId: string, pid: string) =>
  as(userId, async (c) => (await c.query(`SELECT kind, action_id FROM app_closure_blockers($1) ORDER BY kind`, [pid])).rows);

async function action(pid: string, fields: { status?: string; owner?: string | null } = {}) {
  const aid = next();
  const internal = pid === INTERNAL;
  await owner.query(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
     VALUES ($1,$2,$3,$4,'Act',$5,$6,'2099-01-01',$7)`,
    [aid, pid, internal ? FIRM : ACME, internal ? IREC : REC, fields.owner === undefined ? (internal ? U.cons : U.cowner) : fields.owner, fields.status ?? "in_progress", U.cons],
  );
  return aid;
}

/** Puts a project back to active with no rounds, requests or actions. */
async function reset(pid: string) {
  await owner.query(`DELETE FROM project_closures WHERE project_id = $1`, [pid]);
  await owner.query(`DELETE FROM project_closure_requests WHERE project_id = $1`, [pid]);
  await owner.query(`DELETE FROM deadline_change_requests WHERE project_id = $1`, [pid]);
  // Date history is append-only (F17); a reset discards it the way deleting an unsigned client does.
  await owner.query(`BEGIN; SELECT set_config('selah.discard', 'on', true); DELETE FROM actions WHERE project_id = '${pid}'; COMMIT;`);
  await owner.query(`UPDATE projects SET state = 'active' WHERE id = $1`, [pid]);
  await owner.query(`DELETE FROM notifications`);
}

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [FIRM, ACME, BETA]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$10,'firm_admin'), ($2,$10,'consultant'), ($3,$10,'consultant'), ($4,$10,'consultant'),
      ($5,$11,'client_admin'), ($6,$11,'client_manager'), ($7,$11,'client_manager'), ($8,$11,'action_owner'), ($9,$12,'client_manager')`,
    [U.admin, U.lead, U.cons, U.ilead, U.cadmin, U.sponsor, U.cmgr, U.cowner, U.betaMgr, FIRM, ACME, BETA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$4,$6,'Acme governance','active',$7), ($2,'internal',$6,$6,'Firm handbook','active',$7), ($3,'client',$5,$6,'Beta strategy','active',$7)`,
    [PROJ, INTERNAL, BETA_PROJ, ACME, BETA, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($3,$2,true)`, [ACME, U.lead, BETA]);
  await q(
    `INSERT INTO project_members (project_id, user_id, is_lead) VALUES
      ($1,$3,false), ($1,$4,false), ($1,$5,false), ($1,$6,false), ($2,$3,false), ($2,$7,true), ($8,$9,false)`,
    [PROJ, INTERNAL, U.cons, U.sponsor, U.cmgr, U.cowner, U.ilead, BETA_PROJ, U.betaMgr],
  );
  await q(`INSERT INTO project_client_roles (project_id, org_id, role, user_id) VALUES ($1,$2,'sponsor',$3)`, [PROJ, ACME, U.sponsor]);
  await q(`INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES ($1,$2,$3,'Charter',$4), ($5,$6,$7,'Handbook',$4)`, [
    REC,
    PROJ,
    ACME,
    U.cons,
    IREC,
    INTERNAL,
    FIRM,
  ]);
  await q(`INSERT INTO client_contacts (id, org_id, name) VALUES ($1,$2,'Acme board secretary')`, [CONTACT, ACME]);
});

beforeEach(async () => {
  await reset(PROJ);
  await reset(INTERNAL);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("who closes", () => {
  it("the firm admin closes a client project; consultants and the client cannot, even its lead", async () => {
    for (const who of [U.lead, U.cons, U.cadmin, U.sponsor]) {
      await expect(svc(who, (tx, p) => moveClosure(tx, p, PROJ, { step: "start" })), who).rejects.toThrow();
      await expect(run(who, `SELECT app_start_closing($1)`, [PROJ]), who).rejects.toThrow();
    }
    const view = await svc(U.admin, (tx, p) => moveClosure(tx, p, PROJ, { step: "start" }));
    expect(view.state).toBe("closing");
    expect(view.can).toMatchObject({ cancel: true, close: true, dispose: true, lessons: true });
    expect(await state(PROJ)).toBe("closing");
  });

  it("the lead of an internal project closes it (N5); another member does not", async () => {
    await expect(svc(U.cons, (tx, p) => moveClosure(tx, p, INTERNAL, { step: "start" }))).rejects.toThrow();
    await svc(U.ilead, (tx, p) => moveClosure(tx, p, INTERNAL, { step: "start" }));
    await svc(U.ilead, (tx, p) => writeLessons(tx, p, INTERNAL, { wentWell: "Clear scope", toImprove: "Earlier reviews" }));
    const view = await svc(U.ilead, (tx, p) => moveClosure(tx, p, INTERNAL, { step: "close" }));
    expect(view.state).toBe("closed");
    // Reopening stays with the firm admin.
    await expect(svc(U.ilead, (tx, p) => moveClosure(tx, p, INTERNAL, { step: "reopen", reason: "One more chapter" }))).rejects.toThrow();
    await svc(U.admin, (tx, p) => moveClosure(tx, p, INTERNAL, { step: "reopen", reason: "One more chapter" }));
    expect(await state(INTERNAL)).toBe("active");
  });

  it("a project's state moves to closing or closed only through the closing steps", async () => {
    await expect(run(U.admin, `UPDATE projects SET state = 'closed' WHERE id = $1`, [PROJ])).rejects.toThrow(/through its closing steps/);
    await expect(run(U.admin, `UPDATE projects SET state = 'closing' WHERE id = $1`, [PROJ])).rejects.toThrow(/through its closing steps/);
    await svc(U.admin, (tx, p) => moveClosure(tx, p, PROJ, { step: "start" }));
    await expect(run(U.admin, `UPDATE projects SET state = 'active' WHERE id = $1`, [PROJ])).rejects.toThrow(/through its closing steps/);
    // Stopping closing keeps the round as history.
    const view = await svc(U.admin, (tx, p) => moveClosure(tx, p, PROJ, { step: "cancel" }));
    expect(view.state).toBe("active");
    expect(view.history).toHaveLength(1);
    expect(view.history[0]!.cancelledAt).not.toBeNull();
  });
});

describe("the gate", () => {
  it("lists every open action, submission waiting for review, pending deadline request and the lessons", async () => {
    const open = await action(PROJ);
    const waiting = await action(PROJ, { status: "awaiting_review" });
    await action(PROJ, { status: "verified_complete" });
    await owner.query(
      `INSERT INTO deadline_change_requests (project_id, org_id, action_id, requested_by, proposed_due_date, reason) VALUES ($1,$2,$3,$4,'2099-06-01','x')`,
      [PROJ, ACME, open, U.cowner],
    );
    await svc(U.admin, (tx, p) => moveClosure(tx, p, PROJ, { step: "start" }));
    const rows = await blockers(U.admin, PROJ);
    expect(rows).toEqual(
      expect.arrayContaining([
        { kind: "action", action_id: open },
        { kind: "action", action_id: waiting },
        { kind: "review", action_id: waiting },
        { kind: "deadline_request", action_id: open },
        { kind: "lessons", action_id: null },
      ]),
    );
    expect(rows).toHaveLength(5);
    await expect(run(U.admin, `SELECT app_close_project($1)`, [PROJ])).rejects.toThrow(/settle every open item before closing \(5 left\)/);
    // Nobody outside the firm on the project gets rows.
    expect(await blockers(U.cadmin, PROJ)).toEqual([]);
    expect(await blockers(U.betaMgr, PROJ)).toEqual([]);
  });

  it("a disposition needs a reason, except a handover, which needs who sustains it before closing", async () => {
    const a = await action(PROJ);
    await svc(U.admin, (tx, p) => moveClosure(tx, p, PROJ, { step: "start" }));
    await expect(run(U.cons, `SELECT app_dispose_action($1, 'deferred', ' ', NULL, NULL)`, [a])).rejects.toThrow(/closure_item_reason/);
    await svc(U.cons, (tx, p) => disposeAction(tx, p, PROJ, a, { disposition: "handed_over" }));
    expect((await blockers(U.admin, PROJ)).map((r) => r.kind)).toEqual(["lessons", "sustainer"]);
    // Who sustains it must belong to the client: not the firm, not another client.
    for (const wrong of [U.cons, U.betaMgr]) {
      await expect(run(U.cons, `SELECT app_dispose_action($1, 'handed_over', NULL, $2, NULL)`, [a, wrong]), wrong).rejects.toThrow(
        /active account of the project.s organisation/,
      );
    }
    await svc(U.cons, (tx, p) => disposeAction(tx, p, PROJ, a, { disposition: "handed_over", sustainerContactId: CONTACT }));
    expect((await blockers(U.admin, PROJ)).map((r) => r.kind)).toEqual(["lessons"]);
    // Clients never dispose.
    await expect(run(U.cadmin, `SELECT app_dispose_action($1, 'withdrawn', 'no longer needed', NULL, NULL)`, [a])).rejects.toThrow();
  });

  it("the client's admin or sponsor names who sustains a handed-over action; nobody else at the client, nor another client", async () => {
    const a = await action(PROJ);
    await svc(U.admin, (tx, p) => moveClosure(tx, p, PROJ, { step: "start" }));
    await svc(U.cons, (tx, p) => disposeAction(tx, p, PROJ, a, { disposition: "handed_over" }));
    for (const who of [U.cmgr, U.cowner, U.betaMgr]) {
      await expect(run(who, `SELECT app_name_sustainer($1, $2, NULL)`, [a, U.cmgr]), who).rejects.toThrow();
    }
    const view = await svc(U.sponsor, (tx, p) => nameSustainer(tx, p, PROJ, a, { sustainerUserId: U.cmgr }));
    expect(view.items.find((i) => i.actionId === a)?.sustainer?.name).toBe("cmgr");
    expect(view.can.nameSustainer).toBe(true);
    await svc(U.cadmin, (tx, p) => nameSustainer(tx, p, PROJ, a, { sustainerUserId: U.sponsor }));
    // The client sees the decision, but never the blockers or lessons.
    const client = await svc(U.cadmin, (tx, p) => getClosure(tx, p, PROJ));
    expect(client.firm).toBe(false);
    expect(client.blockers).toEqual([]);
    expect(client.lessons).toBeNull();
    expect(client.items[0]).toMatchObject({ disposition: "handed_over", sustainer: { name: "sponsor" } });
  });

  it("closes once settled; the team and the sponsor are told", async () => {
    const a = await action(PROJ);
    const b = await action(PROJ, { status: "assigned" });
    await svc(U.admin, (tx, p) => moveClosure(tx, p, PROJ, { step: "start" }));
    await svc(U.cons, (tx, p) => disposeAction(tx, p, PROJ, a, { disposition: "handed_over", sustainerUserId: U.cmgr }));
    await svc(U.cons, (tx, p) => disposeAction(tx, p, PROJ, b, { disposition: "withdrawn", note: "Replaced by the new charter" }));
    await svc(U.cons, (tx, p) => writeLessons(tx, p, PROJ, { wentWell: "Sponsor engaged", toImprove: "Evidence earlier", nextTime: "Kick-off with IT" }));
    const view = await svc(U.admin, (tx, p) => moveClosure(tx, p, PROJ, { step: "close" }));
    expect(view.state).toBe("closed");
    expect(view.current?.closedBy).toBe("admin");
    const told = (await owner.query(`SELECT user_id FROM notifications WHERE kind = 'project.closed' ORDER BY user_id`)).rows.map((r) => r.user_id);
    expect(told).toEqual(expect.arrayContaining([U.lead, U.cons, U.sponsor]));
    expect(told).not.toContain(U.admin);
  });
});

describe("a closed project", () => {
  async function closeIt() {
    const a = await action(PROJ);
    await svc(U.admin, (tx, p) => moveClosure(tx, p, PROJ, { step: "start" }));
    await svc(U.cons, (tx, p) => disposeAction(tx, p, PROJ, a, { disposition: "deferred", note: "Phase two" }));
    await svc(U.cons, (tx, p) => writeLessons(tx, p, PROJ, { wentWell: "Good", toImprove: "Faster" }));
    await svc(U.admin, (tx, p) => moveClosure(tx, p, PROJ, { step: "close" }));
    return a;
  }

  it("is read-only for everyone: the firm admin, consultants and the client", async () => {
    const a = await closeIt();
    const writes: [string, string, unknown[]][] = [
      [U.admin, `INSERT INTO findings (project_id, org_id, title, created_by) VALUES ($1,$2,'Late',$3)`, [PROJ, ACME, U.admin]],
      [U.cons, `UPDATE actions SET title = 'Changed' WHERE id = $1`, [a]],
      [U.cons, `UPDATE recommendations SET title = 'Changed' WHERE id = $1`, [REC]],
      [U.cowner, `INSERT INTO progress_updates (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'more')`, [PROJ, ACME, a, U.cowner]],
      [U.admin, `UPDATE projects SET title = 'Renamed' WHERE id = $1`, [PROJ]],
      [U.admin, `INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [PROJ, U.lead]],
    ];
    for (const [who, sql, params] of writes) {
      await expect(run(who, sql, params), sql).rejects.toThrow(/closed|row-level security|permission/);
    }
    // The firm admin's write is refused by the closed project, not by its rights.
    await expect(run(U.admin, writes[0]![1], writes[0]![2])).rejects.toThrow(/this project is closed/);
    // The app check says the same, so the screens offer nothing.
    const view = await svc(U.admin, (tx, p) => getClosure(tx, p, PROJ));
    expect(view.can).toMatchObject({ start: false, close: false, dispose: false, reopen: true });
    // Jobs (no user) still run, and leaving the project stays possible.
    await owner.query(`UPDATE actions SET updated_at = now() WHERE id = $1`, [a]);
    await run(U.admin, `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [PROJ, U.cmgr]);
    await owner.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [PROJ, U.cmgr]);
  });

  it("reopens only by the firm admin, with a reason, kept in its history; then work goes on", async () => {
    await closeIt();
    await expect(svc(U.lead, (tx, p) => moveClosure(tx, p, PROJ, { step: "reopen", reason: "A late finding" }))).rejects.toThrow();
    await expect(run(U.admin, `SELECT app_reopen_project($1, 'no')`, [PROJ])).rejects.toThrow(/say why/);
    const view = await svc(U.admin, (tx, p) => moveClosure(tx, p, PROJ, { step: "reopen", reason: "The board asked for a follow-up review" }));
    expect(view.state).toBe("active");
    expect(view.history[0]).toMatchObject({ reopenReason: "The board asked for a follow-up review", reopenedBy: "admin" });
    await run(U.admin, `INSERT INTO findings (project_id, org_id, title, created_by) VALUES ($1,$2,'Late',$3)`, [PROJ, ACME, U.admin]);
    await owner.query(`DELETE FROM findings WHERE project_id = $1`, [PROJ]);
  });
});

describe("the client asks to close (N9)", () => {
  it("the sponsor or the client's admin asks; the firm admins and the lead are told; one request at a time", async () => {
    for (const who of [U.cmgr, U.cowner, U.betaMgr, U.cons]) {
      await expect(run(who, `SELECT app_request_closure($1, 'done')`, [PROJ]), who).rejects.toThrow();
    }
    const view = await svc(U.sponsor, (tx, p) => requestClosure(tx, p, PROJ, { note: "All delivered" }));
    expect(view.request).toMatchObject({ status: "pending", note: "All delivered" });
    expect(view.can.request).toBe(false);
    await expect(run(U.cadmin, `SELECT app_request_closure($1, NULL)`, [PROJ])).rejects.toThrow(/already has a request/);
    const told = (await owner.query(`SELECT user_id FROM notifications WHERE kind = 'closure.requested' ORDER BY user_id`)).rows.map((r) => r.user_id);
    expect(told.sort()).toEqual([U.admin, U.lead].sort());
    // Another client never sees it.
    expect((await as(U.betaMgr, (c) => c.query(`SELECT * FROM project_closure_requests`))).rows).toEqual([]);
  });

  it("the firm admin declines with a reason the client sees, or starts closing, which answers it", async () => {
    const asked = await svc(U.sponsor, (tx, p) => requestClosure(tx, p, PROJ, {}));
    await expect(svc(U.lead, (tx, p) => declineClosureRequest(tx, p, PROJ, asked.request!.id, { reply: "Two actions left" }))).rejects.toThrow();
    await svc(U.admin, (tx, p) => declineClosureRequest(tx, p, PROJ, asked.request!.id, { reply: "Two actions are still being worked" }));
    const client = await svc(U.sponsor, (tx, p) => getClosure(tx, p, PROJ));
    expect(client.request).toMatchObject({ status: "declined", reply: "Two actions are still being worked" });
    expect((await owner.query(`SELECT user_id FROM notifications WHERE kind = 'closure.declined'`)).rows).toEqual([{ user_id: U.sponsor }]);

    await svc(U.cadmin, (tx, p) => requestClosure(tx, p, PROJ, {}));
    await svc(U.admin, (tx, p) => moveClosure(tx, p, PROJ, { step: "start" }));
    const after = await svc(U.cadmin, (tx, p) => getClosure(tx, p, PROJ));
    expect(after.request?.status).toBe("accepted");
    expect(after.state).toBe("closing");
  });
});

describe("visibility", () => {
  it("another client sees nothing of the closing; the client never sees the lessons", async () => {
    const a = await action(PROJ);
    await svc(U.admin, (tx, p) => moveClosure(tx, p, PROJ, { step: "start" }));
    await svc(U.cons, (tx, p) => disposeAction(tx, p, PROJ, a, { disposition: "waived", note: "Accepted by the board" }));
    await svc(U.cons, (tx, p) => writeLessons(tx, p, PROJ, { wentWell: "Good", toImprove: "Faster" }));
    for (const table of ["project_closures", "project_closure_items", "project_closure_lessons"]) {
      expect((await as(U.betaMgr, (c) => c.query(`SELECT * FROM ${table}`))).rows, table).toEqual([]);
    }
    expect((await as(U.cadmin, (c) => c.query(`SELECT * FROM project_closure_lessons`))).rows).toEqual([]);
    expect((await as(U.cadmin, (c) => c.query(`SELECT disposition FROM project_closure_items`))).rows).toEqual([{ disposition: "waived" }]);
    await expect(svc(U.betaMgr, (tx, p) => getClosure(tx, p, PROJ))).rejects.toThrow();
  });

  it("reminders stop for an action once it has a disposition", async () => {
    const a = await action(PROJ);
    await owner.query(`UPDATE actions SET due_date = '2026-01-10' WHERE id = $1`, [a]);
    const due = async () => (await owner.query(`SELECT action_id FROM app_follow_ups_due('2026-01-20')`)).rows.map((r) => r.action_id);
    await svc(U.admin, (tx, p) => moveClosure(tx, p, PROJ, { step: "start" }));
    expect(await due()).toContain(a);
    await svc(U.cons, (tx, p) => disposeAction(tx, p, PROJ, a, { disposition: "deferred", note: "Next phase" }));
    expect(await due()).not.toContain(a);
  });

  it("a closed project's open actions are never overdue or waiting on the overview", async () => {
    const a = await action(PROJ, { status: "blocked" });
    await owner.query(`UPDATE actions SET due_date = '2026-01-10' WHERE id = $1`, [a]);
    const view = () => svc(U.cadmin, (tx, p) => dashboard(tx, p));
    expect((await view()).overdue).toBe(1);
    expect((await view()).attention.map((r) => r.id)).toContain(a);
    await owner.query(`UPDATE projects SET state = 'closed' WHERE id = $1`, [PROJ]);
    expect((await view()).overdue).toBe(0);
    expect((await view()).attention.map((r) => r.id)).not.toContain(a);
    expect((await view()).blocked).toBe(1);
  });
});

describe("parity with the TypeScript lists", () => {
  it("the frozen tables and the dispositions", async () => {
    const r = await owner.query(
      `SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname = 'project_open' AND NOT t.tgisinternal ORDER BY c.relname`,
    );
    expect(r.rows.map((x) => x.relname)).toEqual([...FROZEN_TABLES].sort());
    expect([...closureDisposition.enumValues]).toEqual([...DISPOSITIONS]);
    const e = await owner.query(`SELECT unnest(enum_range(NULL::closure_disposition))::text AS v`);
    expect(e.rows.map((x) => x.v)).toEqual([...DISPOSITIONS]);
  });
});
