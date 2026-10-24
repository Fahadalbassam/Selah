// Deadline slips and aging (F17, 2026-10-24): every move of a released
// action's due date is kept, the slip is read against the date agreed at
// release, a request raised after the due date is marked, and the third
// move later needs the client's lead consultant or a firm admin.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { agingBucket, EXTENSIONS_BEFORE_LEAD } from "@/lib/slips";
import { decideDeadlineChange, projectProgress, requestDeadlineChange } from "@/services/follow-through";
import { projectDeviations } from "@/services/insight";
import { updateAction } from "@/services/plan";
import { loadPrincipal } from "@/services/principal";
import { actionSlip } from "@/services/slips";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c190-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = { admin: id(11), lead: id(12), cons: id(13), other: id(14), cadmin: id(15), cowner: id(16) };
const P = { acme: id(21), beta: id(22) };
const R = { acme: id(31), secret: id(32) };
const A = { open: id(41), secret: id(42), late: id(43) };

/** A date n days from today (Riyadh), as YYYY-MM-DD. */
let today = "";
const day = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

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
const sql = (userId: string, text: string, params: unknown[] = []) => as(userId, (c) => c.query(text, params));
const svc = <T>(userId: string, fn: (tx: Tx, p: Principal) => Promise<T>) =>
  as(userId, async (c) => {
    const tx = drizzle(c, { schema }) as unknown as Tx;
    return fn(tx, (await loadPrincipal(tx, userId))!);
  });
/** The database's own words when a call is refused by a rule (drizzle wraps them). */
const refused = (p: Promise<unknown>) =>
  p.then(
    () => "",
    (e: Error & { cause?: Error }) => e.cause?.message ?? e.message,
  );
/** Ask for a new date (the owner) and decide it (a consultant). */
async function extend(decider: string, to: string, aid = A.open) {
  const { id: rid } = await svc(U.cowner, (tx, p) => requestDeadlineChange(tx, p, aid, { proposedDueDate: to, reason: "Board moved" }));
  await svc(decider, (tx, p) => decideDeadlineChange(tx, p, rid, { approve: true }));
  return rid;
}
const pending = async () =>
  (await owner.query(`SELECT id FROM deadline_change_requests WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1`)).rows[0].id as string;

async function seed() {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  today = (await q(`SELECT app_firm_today()::text AS d`)).rows[0].d;
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name, engagement_mode) VALUES ($1,'firm','firm',NULL), ($2,'client','Acme','full'), ($3,'client','Beta','full')`, [
    FIRM,
    ACME,
    BETA,
  ]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$7,'firm_admin'), ($2,$7,'consultant'), ($3,$7,'consultant'), ($4,$7,'consultant'), ($5,$8,'client_admin'), ($6,$8,'action_owner')`,
    [U.admin, U.lead, U.cons, U.other, U.cadmin, U.cowner, FIRM, ACME],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$3,$5,'Acme governance','active',$6), ($2,'client',$4,$5,'Beta plan','active',$6)`,
    [P.acme, P.beta, ACME, BETA, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$3,true), ($1,$4,false), ($2,$5,true)`, [
    ACME,
    BETA,
    U.lead,
    U.cons,
    U.other,
  ]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4)`, [P.acme, U.lead, U.cons, U.cowner]);
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES
      ($1,$3,$4,'Adopt a board charter','shared',$5), ($2,$3,$4,'Replace the CFO','firm_private',$5)`,
    [R.acme, R.secret, P.acme, ACME, U.lead],
  );
  // Released with a due date: that date is the baseline.
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, created_by, due_date) VALUES
      ($1,$4,$5,$6,'Sign the charter',$8,'in_progress',$9,$10),
      ($2,$4,$5,$7,'Find candidates',NULL,'assigned',$9,$10),
      ($3,$4,$5,$6,'Publish minutes',$8,'in_progress',$9,$11)`,
    [A.open, A.secret, A.late, P.acme, ACME, R.acme, R.secret, U.cowner, U.lead, day(10), day(-40)],
  );
}

beforeEach(seed);
afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("the database agrees with lib/slips.ts", () => {
  it("on the extensions before the lead decides, and on the aging buckets", async () => {
    expect((await owner.query(`SELECT app_extensions_before_lead() AS n`)).rows[0].n).toBe(EXTENSIONS_BEFORE_LEAD);
    const days = [-5, 0, 1, 30, 31, 60, 61, 90, 91, 400];
    const r = await owner.query(`SELECT d, app_aging_bucket(d) AS b FROM unnest($1::int[]) d`, [days]);
    expect(r.rows.map((x) => x.b)).toEqual(days.map((d) => agingBucket(d)));
  });
});

describe("date history", () => {
  it("keeps every move of a released action's date, by request or by the plan", async () => {
    const rid = await extend(U.cons, day(20));
    await svc(U.lead, (tx, p) => updateAction(tx, p, A.open, { dueDate: day(15) }));
    const slip = await svc(U.cadmin, (tx) => actionSlip(tx, P.acme, A.open));
    expect(slip.history.map((h) => [h.from, h.to, h.by, h.viaRequest])).toEqual([
      [day(10), day(20), "cons", true],
      [day(20), day(15), "lead", false],
    ]);
    expect((await owner.query(`SELECT request_id FROM action_due_changes ORDER BY created_at LIMIT 1`)).rows[0].request_id).toBe(rid);
    // Moving later counts as an extension; moving earlier doesn't. The slip is against the release date.
    expect(slip).toMatchObject({ baseline: day(10), extensions: 1, slipDays: 5, daysLate: 0, bucket: null });
  });

  it("is append-only, written only by the database, and as visible as the action", async () => {
    await extend(U.cons, day(20));
    await sql(U.cons, `UPDATE actions SET due_date = $2 WHERE id = $1`, [A.secret, day(12)]);
    await expect(sql(U.lead, `INSERT INTO action_due_changes (project_id, org_id, action_id) VALUES ($1,$2,$3)`, [P.acme, ACME, A.open])).rejects.toThrow(
      /permission denied/,
    );
    await expect(owner.query(`UPDATE action_due_changes SET to_date = to_date + 1`)).rejects.toThrow(/append-only/);
    await expect(owner.query(`DELETE FROM action_due_changes`)).rejects.toThrow(/append-only/);
    // The client sees the shared action's history, never the firm-only one's; another client's consultant sees none.
    expect((await sql(U.cadmin, `SELECT action_id FROM action_due_changes`)).rows.map((r) => r.action_id)).toEqual([A.open]);
    expect((await sql(U.lead, `SELECT action_id FROM action_due_changes`)).rowCount).toBe(2);
    expect((await sql(U.other, `SELECT action_id FROM action_due_changes`)).rowCount).toBe(0);
  });
});

describe("the third extension", () => {
  it("needs the client's lead consultant or a firm admin, by request or in the plan", async () => {
    await extend(U.cons, day(20));
    await extend(U.cons, day(30));
    // A third request: the consultant can't approve it, in the service or past it.
    await svc(U.cowner, (tx, p) => requestDeadlineChange(tx, p, A.open, { proposedDueDate: day(40), reason: "Again" }));
    const rid = await pending();
    await expect(svc(U.cons, (tx, p) => decideDeadlineChange(tx, p, rid, { approve: true }))).rejects.toThrow(/needs the lead/);
    await expect(sql(U.cons, `UPDATE deadline_change_requests SET status = 'approved' WHERE id = $1`, [rid])).rejects.toThrow(/needs the lead/);
    expect(await refused(svc(U.cons, (tx, p) => updateAction(tx, p, A.open, { dueDate: day(40) })))).toMatch(/needs the lead/);
    expect((await svc(U.cons, (tx) => actionSlip(tx, P.acme, A.open))).canExtend).toBe(false);
    // Declining it, or moving the date earlier, is still theirs.
    await svc(U.cons, (tx, p) => updateAction(tx, p, A.open, { dueDate: day(25) }));
    // The lead approves the next one, and a firm admin the one after.
    expect((await svc(U.lead, (tx) => actionSlip(tx, P.acme, A.open))).canExtend).toBe(true);
    await svc(U.lead, (tx, p) => decideDeadlineChange(tx, p, rid, { approve: true }));
    await extend(U.admin, day(50));
    const slip = await svc(U.lead, (tx) => actionSlip(tx, P.acme, A.open));
    expect(slip.extensions).toBe(4);
    expect(slip.slipDays).toBe(40);
  });
});

describe("late requests and aging", () => {
  it("marks a request raised after the due date had passed", async () => {
    await svc(U.cowner, (tx, p) => requestDeadlineChange(tx, p, A.late, { proposedDueDate: day(5), reason: "Late" }));
    await svc(U.cowner, (tx, p) => requestDeadlineChange(tx, p, A.open, { proposedDueDate: day(12), reason: "Early" }));
    const r = await owner.query(`SELECT action_id, due_date_then::text, raised_late FROM deadline_change_requests ORDER BY action_id`);
    expect(r.rows).toEqual([
      { action_id: A.open, due_date_then: day(10), raised_late: false },
      { action_id: A.late, due_date_then: day(-40), raised_late: true },
    ]);
    // Nobody rewrites them.
    await expect(sql(U.lead, `UPDATE deadline_change_requests SET raised_late = false, status = 'rejected' WHERE action_id = $1`, [A.late])).rejects.toThrow(
      /only the decision can change/,
    );
  });

  it("ages open actions against the original date, in the project's numbers and the slipped rule", async () => {
    // Forty days past its release date, then moved twice.
    await extend(U.cons, day(5), A.late);
    await extend(U.cons, day(9), A.late);
    const slip = await svc(U.lead, (tx) => actionSlip(tx, P.acme, A.late));
    expect(slip).toMatchObject({ extensions: 2, slipDays: 49, daysLate: 40, bucket: "d31_60" });
    const progress = await svc(U.lead, (tx, p) => projectProgress(tx, p, P.acme));
    expect(progress).toMatchObject({ extended: 1, extendedTwice: 1, slipDays: 49, late: { d1_30: 0, d31_60: 1, d61_90: 0, d90_plus: 0 } });
    // A plan edit counts toward "slipped" too: two moves later flag the action.
    await svc(U.lead, (tx, p) => updateAction(tx, p, A.open, { dueDate: day(11) }));
    await svc(U.lead, (tx, p) => updateAction(tx, p, A.open, { dueDate: day(12) }));
    const slipped = (await svc(U.lead, (tx, p) => projectDeviations(tx, p, P.acme))).filter((d) => d.rule === "slipped").map((d) => d.entityId);
    expect(slipped.sort()).toEqual([A.open, A.late].sort());
  });
});
