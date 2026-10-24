// A firm-only recommendation keeps its actions firm-only (journey-map gap N2,
// 2026-10-24). The recommendation's label was checked, but its actions and
// everything under them were checked only against the project, so a client
// on the project could read an action the firm was still drafting privately.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-a960-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const U = { admin: id(11), cons: id(12), cadmin: id(13), cmgr: id(14), owner: id(15) };
const P = id(21);
const REC = { shared: id(31), private: id(32) };
const A = { shared: id(41), private: id(42) };
const DOC = { shared: id(51), private: id(52) };

async function as<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    const out = await fn(c);
    await c.query("ROLLBACK");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
const ids = (userId: string, sql: string) => as(userId, async (c) => (await c.query(sql)).rows.map((r) => r.action_id ?? r.id).sort());

const CHILDREN = ["progress_updates", "evidence_requests", "evidence_submissions", "reviews", "risk_acceptances", "deadline_change_requests", "follow_ups"];

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme')`, [FIRM, ACME]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$6,'firm_admin'), ($2,$6,'consultant'), ($3,$7,'client_admin'), ($4,$7,'client_manager'), ($5,$7,'action_owner')`,
    [U.admin, U.cons, U.cadmin, U.cmgr, U.owner, FIRM, ACME],
  );
  await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Acme governance','active',$4)`, [
    P,
    ACME,
    FIRM,
    U.admin,
  ]);
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [ACME, U.cons]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4)`, [P, U.cons, U.cmgr, U.owner]);
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES
      ($1,$3,$4,'Board charter','shared',$5), ($2,$3,$4,'Replace the CFO','firm_private',$5)`,
    [REC.shared, REC.private, P, ACME, U.cons],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by) VALUES
      ($1,$3,$4,$5,'Adopt the charter',$7,'in_progress',current_date - 3,$8),
      ($2,$3,$4,$6,'Search for a new CFO',$7,'in_progress',current_date - 3,$8)`,
    [A.shared, A.private, P, ACME, REC.shared, REC.private, U.owner, U.cons],
  );
  for (const [key, act] of Object.entries(A)) {
    const docId = DOC[key as keyof typeof DOC];
    await q(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, storage_key, content_type, size_bytes, sha256, scan_status)
       VALUES ($1,$2,$3,$3,$4,'evidence','submitted',$5,'shared',$6,'application/pdf',1,'s','clean')`,
      [docId, P, ACME, U.owner, `evidence ${key}`, `k-${docId}`],
    );
    await q(`INSERT INTO progress_updates (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'started')`, [P, ACME, act, U.owner]);
    await q(`INSERT INTO evidence_requests (project_id, org_id, action_id, title, created_by) VALUES ($1,$2,$3,'signed copy',$4)`, [P, ACME, act, U.cons]);
    await q(`INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by) VALUES ($1,$2,$3,$4,$5)`, [
      P,
      ACME,
      act,
      docId,
      U.owner,
    ]);
    await q(`INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'revise')`, [
      P,
      ACME,
      act,
      U.cons,
    ]);
    await q(`INSERT INTO risk_acceptances (project_id, org_id, action_id, accepted_by, statement) VALUES ($1,$2,$3,$4,'we accept')`, [
      P,
      ACME,
      act,
      U.cadmin,
    ]);
    await q(
      `INSERT INTO deadline_change_requests (project_id, org_id, action_id, requested_by, proposed_due_date, reason) VALUES ($1,$2,$3,$4,current_date + 30,'busy')`,
      [P, ACME, act, U.owner],
    );
    await q(`INSERT INTO follow_ups (project_id, org_id, action_id, title, visibility, created_by) VALUES ($1,$2,$3,'chase','shared',$4)`, [
      P,
      ACME,
      act,
      U.cons,
    ]);
  }
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("an action under a firm-only recommendation", () => {
  it("is hidden from every client role, and seen by the firm", async () => {
    for (const u of [U.cadmin, U.cmgr, U.owner]) expect(await ids(u, `SELECT id FROM actions`)).toEqual([A.shared]);
    for (const u of [U.admin, U.cons]) expect(await ids(u, `SELECT id FROM actions`)).toEqual([A.shared, A.private]);
  });

  it.each(CHILDREN)("hides its %s from the client", async (table) => {
    for (const u of [U.cadmin, U.cmgr, U.owner]) expect(await ids(u, `SELECT action_id FROM ${table}`)).toEqual([A.shared]);
    expect(await ids(U.cons, `SELECT action_id FROM ${table}`)).toEqual([A.shared, A.private]);
  });

  it("can't be written to by the client", async () => {
    await expect(
      as(U.owner, (c) =>
        c.query(`INSERT INTO progress_updates (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'done')`, [P, ACME, A.private, U.owner]),
      ),
    ).rejects.toThrow(/row-level security/);
    const moved = await as(U.cmgr, (c) => c.query(`UPDATE actions SET status = 'blocked', blocked_reason = 'x' WHERE id = $1`, [A.private]));
    expect(moved.rowCount).toBe(0);
  });

  it("stays out of the client's trace, schedule and changes", async () => {
    const trace = await as(U.cadmin, async (c) => (await c.query(`SELECT node_id FROM app_trace($1) WHERE node_type = 'action'`, [P])).rows.map((r) => r.node_id));
    expect(trace).toEqual([A.shared]);
    const schedule = await as(U.cadmin, async (c) => (await c.query(`SELECT item_id FROM v_schedule WHERE item_type = 'action'`)).rows.map((r) => r.item_id));
    expect(schedule).toEqual([A.shared]);
    const changed = await as(U.cadmin, async (c) =>
      (await c.query(`SELECT action_id FROM app_changed_actions($1, now() - interval '1 day')`, [P])).rows.map((r) => r.action_id),
    );
    expect(changed).toEqual([A.shared]);
  });

  it("sends the client no notification about it", async () => {
    await owner.query(`DELETE FROM notifications`);
    await owner.query(
      `INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,'action.assigned','action',$3), ($1,'action.assigned','action',$4), ($2,'action.assigned','action',$4)`,
      [U.owner, U.cons, A.shared, A.private],
    );
    const left = (await owner.query(`SELECT user_id, entity_id FROM notifications ORDER BY entity_id, user_id`)).rows;
    expect(left).toEqual([
      { user_id: U.owner, entity_id: A.shared },
      { user_id: U.cons, entity_id: A.private },
    ]);
    await owner.query(`DELETE FROM notifications`);
  });

  it("is left out of a meeting's agenda, which the client may see", async () => {
    const agenda = (await owner.query(`SELECT app_meeting_agenda($1, now(), 'en') AS md`, [P])).rows[0].md as string;
    expect(agenda).toContain("Adopt the charter");
    expect(agenda).not.toContain("Search for a new CFO");
  });

  it("reaches the client once the recommendation is shared", async () => {
    const seen = await as(U.cons, async (c) => {
      await c.query(`UPDATE recommendations SET visibility = 'shared' WHERE id = $1`, [REC.private]);
      await c.query(`SELECT set_config('selah.user_id', $1, true)`, [U.owner]);
      return (await c.query(`SELECT id FROM actions ORDER BY id`)).rows.map((r) => r.id);
    });
    expect(seen).toEqual([A.shared, A.private]);
  });
});
