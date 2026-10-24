// Correcting, releasing, withdrawing and deleting findings and recommendations
// (journey-map gap N1, 2026-10-24): until now they could only be created.
// Archive what was released, delete only what the client never saw.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { indexRecords } from "@/jobs/index-documents";
import { loadPrincipal } from "@/services/principal";
import { deleteRecord, releaseRecord, updateFinding, updateRecommendation, withdrawRecord } from "@/services/plan-changes";
import { getProject } from "@/services/queries";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c160-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = { admin: id(11), lead: id(12), other: id(13), cadmin: id(14), cowner: id(15), betaAdmin: id(16) };
const PROJ = id(21);
const BETA_PROJ = id(22);
const F = { shared: id(31), draft: id(32) };
const R = { live: id(41), secret: id(42), plain: id(43) };
const A = { open: id(51), draft: id(52), ended: id(53), secretDraft: id(54) };

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
const sql = (userId: string, text: string, params: unknown[] = []) => as(userId, (c) => c.query(text, params), true);
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    true,
  );
const rec = async (rid: string) => (await owner.query(`SELECT * FROM recommendations WHERE id = $1`, [rid])).rows[0];
const status = async (aid: string) => (await owner.query(`SELECT status, closure_outcome FROM actions WHERE id = $1`, [aid])).rows[0];

async function seed() {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [FIRM, ACME, BETA]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$7,'firm_admin'), ($2,$7,'consultant'), ($3,$7,'consultant'), ($4,$8,'client_admin'), ($5,$8,'action_owner'), ($6,$9,'client_admin')`,
    [U.admin, U.lead, U.other, U.cadmin, U.cowner, U.betaAdmin, FIRM, ACME, BETA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$3,$5,'Acme governance','active',$6), ($2,'client',$4,$5,'Beta strategy','active',$6)`,
    [PROJ, BETA_PROJ, ACME, BETA, FIRM, U.admin],
  );
  // "other" works for Beta only, so Acme's records are out of reach.
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($3,$4,true)`, [ACME, U.lead, BETA, U.other]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($4,$5)`, [PROJ, U.lead, U.cowner, BETA_PROJ, U.betaAdmin]);
  await q(
    `INSERT INTO findings (id, project_id, org_id, title, visibility, created_by) VALUES
      ($1,$3,$4,'No board charter','shared',$5), ($2,$3,$4,'Weak CFO','firm_private',$5)`,
    [F.shared, F.draft, PROJ, ACME, U.lead],
  );
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, finding_id, title, rationale, visibility, created_by) VALUES
      ($1,$4,$5,$6,'Adopt a board charter','Good practice','shared',$7),
      ($2,$4,$5,NULL,'Replace the CFO',NULL,'firm_private',$7),
      ($3,$4,$5,NULL,'Publish minutes',NULL,'shared',$7)`,
    [R.live, R.secret, R.plain, PROJ, ACME, F.shared, U.lead],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by) VALUES
      ($1,$5,$6,$7,'Draft the charter',$9,'in_progress',current_date + 10,$10),
      ($2,$5,$6,$7,'Train the board',NULL,'draft',NULL,$10),
      ($3,$5,$6,$7,'Name a secretary',$9,'assigned',current_date + 10,$10),
      ($4,$5,$6,$8,'Search firm brief',NULL,'draft',NULL,$10)`,
    [A.open, A.draft, A.ended, A.secretDraft, PROJ, ACME, R.live, R.secret, U.cowner, U.lead],
  );
}

beforeAll(seed);
afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("release", () => {
  beforeEach(seed);

  it("shares a firm-only record one way, and stamps when", async () => {
    expect((await rec(R.secret)).released_at).toBeNull();
    expect((await rec(R.live)).released_at).not.toBeNull();
    await svc(U.lead, (tx, p) => releaseRecord(tx, p, "recommendation", R.secret));
    const after = await rec(R.secret);
    expect(after.visibility).toBe("shared");
    expect(after.released_at).not.toBeNull();
    // The client now sees it and its draft action.
    const view = await svc(U.cadmin, (tx, p) => getProject(tx, p, PROJ));
    expect(view.recommendations.map((r) => r.id)).toContain(R.secret);
    // Back to firm-only is refused, through the service and at the table.
    await expect(sql(U.lead, `UPDATE recommendations SET visibility = 'firm_private' WHERE id = $1`, [R.secret])).rejects.toThrow(/firm-only to shared/);
    await expect(svc(U.lead, (tx, p) => releaseRecord(tx, p, "recommendation", R.secret))).rejects.toThrow(/already shared/);
    // released_at is the database's, never written by hand.
    await sql(U.lead, `UPDATE recommendations SET released_at = '2020-01-01' WHERE id = $1`, [R.live]);
    expect((await rec(R.live)).released_at.getFullYear()).not.toBe(2020);
  });

  it("is the firm's on the client's own projects only", async () => {
    await expect(svc(U.cadmin, (tx, p) => releaseRecord(tx, p, "finding", F.shared))).rejects.toThrow(/forbidden/);
    // The client can't even find a firm-only record; another client's consultant can't either.
    await expect(svc(U.cadmin, (tx, p) => releaseRecord(tx, p, "finding", F.draft))).rejects.toThrow(/not found/i);
    await expect(svc(U.other, (tx, p) => releaseRecord(tx, p, "recommendation", R.secret))).rejects.toThrow(/not found/i);
    await expect(svc(U.betaAdmin, (tx, p) => releaseRecord(tx, p, "recommendation", R.live))).rejects.toThrow(/not found/i);
    // Past the service, row-level security keeps the client out.
    const { rowCount } = await sql(U.cadmin, `UPDATE findings SET visibility = 'shared' WHERE id = $1`, [F.draft]);
    expect(rowCount).toBe(0);
  });
});

describe("correct", () => {
  beforeEach(seed);

  it("changes a live record's text and keeps the history", async () => {
    await svc(U.lead, (tx, p) => updateRecommendation(tx, p, R.live, { title: "Adopt and publish a board charter", rationale: null, priority: "high" }));
    await svc(U.lead, (tx, p) => updateFinding(tx, p, F.shared, { description: "Found in the March interviews" }));
    const r = await rec(R.live);
    expect([r.title, r.rationale, r.priority]).toEqual(["Adopt and publish a board charter", null, "high"]);
    const events = (await owner.query(`SELECT entity_id, event FROM activity_events WHERE event = 'updated' AND entity_type IN ('recommendation','finding') ORDER BY entity_id`)).rows;
    expect(events).toEqual([
      { entity_id: F.shared, event: "updated" },
      { entity_id: R.live, event: "updated" },
    ]);
    await expect(svc(U.cadmin, (tx, p) => updateRecommendation(tx, p, R.live, { title: "x" }))).rejects.toThrow(/forbidden/);
    await expect(svc(U.lead, (tx, p) => updateRecommendation(tx, p, R.plain, { findingId: id(999) }))).rejects.toThrow(/not in this project/);
  });
});

describe("withdraw", () => {
  beforeEach(seed);

  it("needs a reason, and no open or draft action, at the table", async () => {
    await expect(
      sql(U.lead, `UPDATE recommendations SET withdrawn_at = now(), withdrawn_by = $2, withdrawn_reason = ' ' WHERE id = $1`, [R.plain, U.lead]),
    ).rejects.toThrow(/needs a reason/);
    await expect(
      sql(U.lead, `UPDATE recommendations SET withdrawn_at = now(), withdrawn_by = $2, withdrawn_reason = 'dropped' WHERE id = $1`, [R.live, U.lead]),
    ).rejects.toThrow(/open actions/);
    await expect(sql(U.lead, `UPDATE recommendations SET withdrawn_reason = 'half' WHERE id = $1`, [R.plain])).rejects.toThrow(/recorded whole/);
  });

  it("closes open actions as not applicable, deletes drafts and keeps finished work", async () => {
    // One action already ended, partly done: it stays as it is.
    await owner.query(`UPDATE actions SET status = 'closed', closure_outcome = 'partially_implemented', closure_note = 'done in part' WHERE id = $1`, [A.ended]);
    const out = await svc(U.lead, (tx, p) => withdrawRecord(tx, p, "recommendation", R.live, { reason: "The board dropped it" }));
    expect(out).toMatchObject({ closedActions: 1, deletedDrafts: 1 });
    expect(await status(A.open)).toEqual({ status: "closed", closure_outcome: "not_applicable" });
    expect(await status(A.ended)).toEqual({ status: "closed", closure_outcome: "partially_implemented" });
    expect(await status(A.draft)).toBeUndefined();
    const r = await rec(R.live);
    expect([r.withdrawn_by, r.withdrawn_reason]).toEqual([U.lead, "The board dropped it"]);
    // The client still sees it, marked, with the reason.
    const view = await svc(U.cadmin, (tx, p) => getProject(tx, p, PROJ));
    expect(view.recommendations.find((x) => x.id === R.live)?.withdrawnReason).toBe("The board dropped it");
  });

  it("is final: no edits, no new actions, no reopening", async () => {
    await owner.query(`UPDATE actions SET status = 'closed', closure_outcome = 'not_applicable', closure_note = 'n/a' WHERE recommendation_id = $1 AND status <> 'draft'`, [R.live]);
    await svc(U.lead, (tx, p) => withdrawRecord(tx, p, "recommendation", R.live, { reason: "Superseded by the new law" }));
    await expect(svc(U.lead, (tx, p) => updateRecommendation(tx, p, R.live, { title: "again" }))).rejects.toThrow(/withdrawn/);
    await expect(sql(U.lead, `UPDATE recommendations SET title = 'again' WHERE id = $1`, [R.live])).rejects.toThrow(/withdrawn recommendation cannot change/);
    await expect(
      sql(U.lead, `INSERT INTO actions (project_id, org_id, recommendation_id, title, created_by) VALUES ($1,$2,$3,'More',$4)`, [PROJ, ACME, R.live, U.lead]),
    ).rejects.toThrow(/was withdrawn/);
    await expect(sql(U.lead, `UPDATE actions SET status = 'in_progress' WHERE id = $1`, [A.open])).rejects.toThrow(/was withdrawn/);
    await expect(svc(U.lead, (tx, p) => withdrawRecord(tx, p, "recommendation", R.live, { reason: "twice" }))).rejects.toThrow(/withdrawn/);
  });

  it("takes a finding back once no live recommendation answers it", async () => {
    await expect(svc(U.lead, (tx, p) => withdrawRecord(tx, p, "finding", F.shared, { reason: "Wrong" }))).rejects.toThrow(/answer this finding/);
    await owner.query(`UPDATE recommendations SET finding_id = NULL WHERE id = $1`, [R.live]);
    await svc(U.lead, (tx, p) => withdrawRecord(tx, p, "finding", F.shared, { reason: "Wrong department" }));
    await expect(svc(U.lead, (tx, p) => updateRecommendation(tx, p, R.plain, { findingId: F.shared }))).rejects.toThrow(/finding was withdrawn/);
  });

  it("is refused for what the client never saw (that is deleted)", async () => {
    await expect(svc(U.lead, (tx, p) => withdrawRecord(tx, p, "recommendation", R.secret, { reason: "x" }))).rejects.toThrow(/deleted, not withdrawn/);
  });

  it("drops the assistant's passages, and the index job skips it", async () => {
    const vec = `[${Array.from({ length: 1024 }, () => 0.01).join(",")}]`;
    await owner.query(
      `INSERT INTO ai_chunks (project_id, org_id, source_type, source_id, visibility, chunk_index, content, embedding)
       VALUES ($1,$2,'recommendation',$3,'shared',0,'Publish minutes',$4)`,
      [PROJ, ACME, R.plain, vec],
    );
    await svc(U.lead, (tx, p) => withdrawRecord(tx, p, "recommendation", R.plain, { reason: "Already done" }));
    expect((await owner.query(`SELECT 1 FROM ai_chunks WHERE source_id = $1`, [R.plain])).rowCount).toBe(0);
    const embed = async (texts: string[]) => texts.map(() => Array.from({ length: 1024 }, () => 0.01));
    await indexRecords(owner, embed);
    expect((await owner.query(`SELECT 1 FROM ai_chunks WHERE source_id = $1`, [R.plain])).rowCount).toBe(0);
    expect((await owner.query(`SELECT 1 FROM ai_chunks WHERE source_id = $1`, [R.live])).rowCount).toBe(1);
  });

  it("still lets the minimal-records purge blank its text", async () => {
    await svc(U.lead, (tx, p) => withdrawRecord(tx, p, "recommendation", R.plain, { reason: "Already done" }));
    const c = await owner.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('selah.purge', 'on', true)`);
      await c.query(`UPDATE recommendations SET rationale = '—' WHERE id = $1`, [R.plain]);
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });
});

describe("delete", () => {
  beforeEach(seed);

  it("removes a firm-only record never released, with its drafts", async () => {
    await svc(U.lead, (tx, p) => deleteRecord(tx, p, "recommendation", R.secret));
    expect(await rec(R.secret)).toBeUndefined();
    expect(await status(A.secretDraft)).toBeUndefined();
    await svc(U.lead, (tx, p) => deleteRecord(tx, p, "finding", F.draft));
    const { rows } = await owner.query(`SELECT action FROM audit_log WHERE action LIKE '%.deleted' ORDER BY action`);
    expect(rows.map((r) => r.action)).toEqual(["finding.deleted", "recommendation.deleted"]);
  });

  it("refuses what was released, or has released actions, or answers", async () => {
    await expect(svc(U.lead, (tx, p) => deleteRecord(tx, p, "recommendation", R.plain))).rejects.toThrow(/withdrawn, not deleted/);
    await expect(sql(U.lead, `DELETE FROM recommendations WHERE id = $1`, [R.plain])).rejects.toThrow(/withdrawn, not deleted/);
    // Released, then: never deleted, even if the label could go back (it can't).
    await svc(U.lead, (tx, p) => releaseRecord(tx, p, "finding", F.draft));
    await expect(sql(U.lead, `DELETE FROM findings WHERE id = $1`, [F.draft])).rejects.toThrow(/withdrawn, not deleted/);
    // A firm-only recommendation whose action was released (to the firm's eyes only) is kept.
    await owner.query(`UPDATE actions SET status = 'assigned', owner_user_id = $2, due_date = current_date + 5 WHERE id = $1`, [A.secretDraft, U.cowner]);
    await expect(svc(U.lead, (tx, p) => deleteRecord(tx, p, "recommendation", R.secret))).rejects.toThrow(/released actions/);
    await expect(sql(U.lead, `DELETE FROM recommendations WHERE id = $1`, [R.secret])).rejects.toThrow(/released actions/);
    // The client can't delete anything.
    const { rowCount } = await sql(U.cadmin, `DELETE FROM findings WHERE id = $1`, [F.shared]).catch(() => ({ rowCount: 0 }));
    expect(rowCount).toBe(0);
  });

  it("offers on the project page only what will work", async () => {
    const firm = await svc(U.lead, (tx, p) => getProject(tx, p, PROJ));
    const can = Object.fromEntries(firm.recommendations.map((r) => [r.title, r.can]));
    expect(can["Replace the CFO"]).toEqual({ edit: true, release: true, withdraw: false, delete: true });
    expect(can["Adopt a board charter"]).toEqual({ edit: true, release: false, withdraw: true, delete: false });
    const f = Object.fromEntries(firm.findings.map((x) => [x.title, x.can]));
    // A live recommendation answers it, so it can't be withdrawn yet.
    expect(f["No board charter"]).toEqual({ edit: true, release: false, withdraw: false, delete: false });
    expect(f["Weak CFO"]).toEqual({ edit: true, release: true, withdraw: false, delete: true });
    const client = await svc(U.cadmin, (tx, p) => getProject(tx, p, PROJ));
    for (const r of client.recommendations) expect(r.can).toEqual({ edit: false, release: false, withdraw: false, delete: false });
  });
});
