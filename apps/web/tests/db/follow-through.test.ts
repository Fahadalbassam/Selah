// Follow-through rules (migration 0011) against a real Postgres: who may
// write the plan, how actions close and reopen, evidence lists, deadline
// change requests, the reminder ladder and the implementation progress.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { runFollowUps } from "@/jobs/follow-ups";
import * as F from "@/services/follow-through";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const U = {
  admin: id(11), // firm admin, watches Acme
  lead: id(12), // Acme's lead consultant, not staffed on the project
  cons: id(13), // consultant staffed on the project
  outsider: id(14), // consultant on nothing
  cadmin: id(15),
  cmgr: id(16), // client manager staffed on the project
  cowner: id(17), // action owner staffed on the project
  former: id(18), // action owner who has left (inactive), still staffed
};
const PROJ = id(21);
const PROJ_STATS = id(22);
const REC = id(31);
const REC_STATS = id(32);
let n = 100;
const next = () => id(++n);

/** Run fn as `userId` on the app role; the transaction is rolled back. */
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
/** One statement as `userId`, committed. */
const run = (userId: string, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params), true);
/** One statement as `userId`, rolled back. */
const attempt = (userId: string, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params));

async function action(fields: { status?: string; due?: string; project?: string; closure?: string } = {}) {
  const aid = next();
  await owner.query(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by, closure_outcome)
     VALUES ($1,$2,$3,$4,'Write the policy',$5,$6,$7,$8,$9)`,
    [
      aid,
      fields.project ?? PROJ,
      ACME,
      fields.project === PROJ_STATS ? REC_STATS : REC,
      U.cowner,
      fields.status ?? "in_progress",
      fields.due ?? null,
      U.cons,
      fields.closure ?? null,
    ],
  );
  return aid;
}
const statusOf = async (aid: string) => (await owner.query(`SELECT * FROM actions WHERE id = $1`, [aid])).rows[0];

async function submitEvidence(aid: string, requestId: string | null) {
  const doc = next();
  await owner.query(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, storage_key, content_type, size_bytes, sha256, scan_status)
     VALUES ($1,$2,$3,$3,$4,'evidence','submitted','e.pdf','shared',$5,'application/pdf',1,'x','clean')`,
    [doc, PROJ, ACME, U.cowner, `k-${doc}`],
  );
  const sub = next();
  await owner.query(
    `INSERT INTO evidence_submissions (id, project_id, org_id, action_id, document_id, submitted_by, evidence_request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [sub, PROJ, ACME, aid, doc, U.cowner, requestId],
  );
  return sub;
}

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme')`, [FIRM, ACME]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$8,'firm_admin'), ($2,$8,'consultant'), ($3,$8,'consultant'), ($4,$8,'consultant'),
      ($5,$9,'client_admin'), ($6,$9,'client_manager'), ($7,$9,'action_owner')`,
    [U.admin, U.lead, U.cons, U.outsider, U.cadmin, U.cmgr, U.cowner, FIRM, ACME],
  );
  await q(`INSERT INTO org_memberships (user_id, org_id, role, active) VALUES ($1,$2,'action_owner',false)`, [U.former, ACME]);
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state) VALUES
      ($1,'client',$3,$4,'Acme governance','active'), ($2,'client',$3,$4,'Acme statistics','active')`,
    [PROJ, PROJ_STATS, ACME, FIRM],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($1,$3,false)`, [
    ACME,
    U.lead,
    U.cons,
  ]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4), ($5,$2)`, [
    PROJ,
    U.cons,
    U.cmgr,
    U.cowner,
    PROJ_STATS,
  ]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($3,$4)`, [PROJ, U.former, PROJ_STATS, U.cowner]);
  await q(`INSERT INTO watches (user_id, client_org_id) VALUES ($1,$2)`, [U.admin, ACME]);
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES ($1,$2,$4,'Board charter',$5), ($6,$3,$4,'Statistics',$5)`,
    [REC, PROJ, PROJ_STATS, ACME, U.cons, REC_STATS],
  );
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("the plan is the firm's", () => {
  it("consultants write recommendations, actions and meeting notes; clients cannot", async () => {
    const rec = `INSERT INTO recommendations (project_id, org_id, title, created_by) VALUES ($1,$2,'New',$3)`;
    await attempt(U.cons, rec, [PROJ, ACME, U.cons]);
    for (const u of [U.cadmin, U.cmgr]) {
      await expect(attempt(u, rec, [PROJ, ACME, u])).rejects.toThrow(/row-level security/);
    }
    const act = `INSERT INTO actions (project_id, org_id, recommendation_id, title, created_by) VALUES ($1,$2,$3,'New',$4)`;
    await attempt(U.cons, act, [PROJ, ACME, REC, U.cons]);
    await expect(attempt(U.cmgr, act, [PROJ, ACME, REC, U.cmgr])).rejects.toThrow(/row-level security/);
    const note = `INSERT INTO meeting_notes (project_id, org_id, author_id, held_on, title, body, visibility)
                  VALUES ($1,$2,$3,'2026-10-01','Kickoff','Notes','shared')`;
    await attempt(U.cons, note, [PROJ, ACME, U.cons]);
    await expect(attempt(U.cmgr, note, [PROJ, ACME, U.cmgr])).rejects.toThrow(/row-level security/);
    // A consultant cannot sign a note in someone else's name.
    await expect(attempt(U.cons, note, [PROJ, ACME, U.lead])).rejects.toThrow(/row-level security/);
  });

  it("the outsider consultant cannot write to a project they are not on", async () => {
    await expect(
      attempt(U.outsider, `INSERT INTO recommendations (project_id, org_id, title, created_by) VALUES ($1,$2,'x',$3)`, [
        PROJ,
        ACME,
        U.outsider,
      ]),
    ).rejects.toThrow(/row-level security/);
  });

  it("a new action starts as draft or assigned", async () => {
    await expect(
      attempt(
        U.cons,
        `INSERT INTO actions (project_id, org_id, recommendation_id, title, status, created_by) VALUES ($1,$2,$3,'x','verified_complete',$4)`,
        [PROJ, ACME, REC, U.cons],
      ),
    ).rejects.toThrow(/starts as draft or assigned/);
  });

  it("clients move their actions, managers reassign them, and nobody on the client side edits the plan", async () => {
    const aid = await action({ status: "assigned", due: "2026-12-01" });
    await attempt(U.cowner, `UPDATE actions SET status = 'in_progress' WHERE id = $1`, [aid]);
    await attempt(U.cmgr, `UPDATE actions SET owner_user_id = $2 WHERE id = $1`, [aid, U.cmgr]);
    await expect(attempt(U.cowner, `UPDATE actions SET owner_user_id = $2 WHERE id = $1`, [aid, U.cmgr])).rejects.toThrow(
      /only move/,
    );
    for (const u of [U.cowner, U.cmgr, U.cadmin]) {
      await expect(attempt(u, `UPDATE actions SET due_date = '2027-01-01' WHERE id = $1`, [aid])).rejects.toThrow(/only move/);
      await expect(attempt(u, `UPDATE actions SET title = 'Easier' WHERE id = $1`, [aid])).rejects.toThrow(/only move/);
    }
    await expect(attempt(U.cmgr, `DELETE FROM actions WHERE id = $1`, [aid])).resolves.toMatchObject({ rowCount: 0 });
    await attempt(U.cons, `UPDATE actions SET due_date = '2027-01-01' WHERE id = $1`, [aid]);
  });

  it("only the firm releases a draft", async () => {
    const aid = await action({ status: "draft" });
    await expect(attempt(U.cmgr, `UPDATE actions SET status = 'assigned' WHERE id = $1`, [aid])).rejects.toThrow(/only the firm/);
    await attempt(U.cons, `UPDATE actions SET status = 'assigned' WHERE id = $1`, [aid]);
  });

  it("a board decision records when it was decided", async () => {
    const rec = `INSERT INTO recommendations (project_id, org_id, title, created_by, source, decided_on) VALUES ($1,$2,'Board',$3,'board_decision',$4)`;
    await expect(attempt(U.cons, rec, [PROJ, ACME, U.cons, null])).rejects.toThrow(/board_decision_dated/);
    await attempt(U.cons, rec, [PROJ, ACME, U.cons, "2026-09-30"]);
  });
});

describe("closing and reopening", () => {
  it("only the firm closes, always with an outcome, and the closer is recorded", async () => {
    const aid = await action();
    await expect(
      attempt(U.cmgr, `UPDATE actions SET status = 'closed', closure_outcome = 'not_applicable' WHERE id = $1`, [aid]),
    ).rejects.toThrow(/only move|only the firm/);
    await expect(attempt(U.cons, `UPDATE actions SET status = 'closed' WHERE id = $1`, [aid])).rejects.toThrow(
      /closure_matches_status/,
    );
    await run(
      U.cons,
      `UPDATE actions SET status = 'closed', closure_outcome = 'not_applicable', closure_note = 'Law changed' WHERE id = $1`,
      [aid],
    );
    const row = await statusOf(aid);
    expect(row.closed_by).toBe(U.cons);
    expect(row.closed_at).not.toBeNull();
  });

  it("risk accepted needs a statement signed by the client's admin or manager", async () => {
    const aid = await action();
    const close = `UPDATE actions SET status = 'closed', closure_outcome = 'risk_accepted' WHERE id = $1`;
    await expect(attempt(U.cons, close, [aid])).rejects.toThrow(/signed statement/);

    const sign = `INSERT INTO risk_acceptances (project_id, org_id, action_id, accepted_by, statement) VALUES ($1,$2,$3,$4,'We accept the risk')`;
    // Not the firm, not an action owner, not in someone else's name.
    await expect(attempt(U.cons, sign, [PROJ, ACME, aid, U.cons])).rejects.toThrow(/row-level security/);
    await expect(attempt(U.cowner, sign, [PROJ, ACME, aid, U.cowner])).rejects.toThrow(/row-level security/);
    await expect(attempt(U.cmgr, sign, [PROJ, ACME, aid, U.cadmin])).rejects.toThrow(/row-level security/);
    await run(U.cmgr, sign, [PROJ, ACME, aid, U.cmgr]);
    // Signed statements cannot be withdrawn or edited.
    await expect(attempt(U.cmgr, `DELETE FROM risk_acceptances WHERE action_id = $1`, [aid])).rejects.toThrow(
      /permission denied/,
    );

    await run(U.cons, close, [aid]);
    expect((await statusOf(aid)).closure_outcome).toBe("risk_accepted");
  });

  it("superseded names a successor in the same project", async () => {
    const aid = await action();
    const other = await action({ project: PROJ_STATS });
    const same = await action();
    const close = `UPDATE actions SET status = 'closed', closure_outcome = 'superseded', superseded_by = $2 WHERE id = $1`;
    await expect(
      attempt(U.cons, `UPDATE actions SET status = 'closed', closure_outcome = 'superseded' WHERE id = $1`, [aid]),
    ).rejects.toThrow(/same project|superseded_names_successor/);
    await expect(attempt(U.admin, close, [aid, other])).rejects.toThrow(/same project/);
    await run(U.cons, close, [aid, same]);
    await owner.query(`DELETE FROM actions WHERE id = $1`, [other]); // keeps the statistics project clean
  });

  it("the firm reopens a closed action and the closure is cleared; the client cannot", async () => {
    const aid = await action();
    await run(U.cons, `UPDATE actions SET status = 'closed', closure_outcome = 'partially_implemented' WHERE id = $1`, [aid]);
    await expect(attempt(U.cadmin, `UPDATE actions SET status = 'in_progress' WHERE id = $1`, [aid])).rejects.toThrow(
      /only the firm/,
    );
    await run(U.cons, `UPDATE actions SET status = 'in_progress' WHERE id = $1`, [aid]);
    const row = await statusOf(aid);
    expect([row.status, row.closure_outcome, row.closed_by, row.closed_at]).toEqual(["in_progress", null, null, null]);
  });

  it("after a reopen, verifying needs a new accept review", async () => {
    const aid = await action({ status: "awaiting_review" });
    const accept = () =>
      owner.query(`INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'accept')`, [
        PROJ,
        ACME,
        aid,
        U.cons,
      ]);
    const verify = `UPDATE actions SET status = 'verified_complete' WHERE id = $1`;
    await accept();
    await run(U.cons, verify, [aid]);
    await run(U.cons, `UPDATE actions SET status = 'in_progress' WHERE id = $1`, [aid]);
    await run(U.cowner, `UPDATE actions SET status = 'awaiting_review' WHERE id = $1`, [aid]);
    await expect(attempt(U.cons, verify, [aid])).rejects.toThrow(/accept review of this round/);
    await accept();
    await run(U.cons, verify, [aid]);
  });

  it("after a reopen, an old risk acceptance no longer counts, nor one from someone who left", async () => {
    const aid = await action();
    const sign = (by: string) =>
      run(
        by,
        `INSERT INTO risk_acceptances (project_id, org_id, action_id, accepted_by, statement) VALUES ($1,$2,$3,$4,'Accepted')`,
        [PROJ, ACME, aid, by],
      );
    const close = `UPDATE actions SET status = 'closed', closure_outcome = 'risk_accepted' WHERE id = $1`;
    await sign(U.cmgr);
    await run(U.cons, close, [aid]);
    await run(U.cons, `UPDATE actions SET status = 'in_progress' WHERE id = $1`, [aid]);
    await expect(attempt(U.cons, close, [aid])).rejects.toThrow(/signed statement/);
    await sign(U.cadmin);
    await owner.query(`UPDATE org_memberships SET active = false WHERE user_id = $1`, [U.cadmin]);
    try {
      await expect(attempt(U.cons, close, [aid])).rejects.toThrow(/signed statement/);
    } finally {
      await owner.query(`UPDATE org_memberships SET active = true WHERE user_id = $1`, [U.cadmin]);
    }
    await run(U.cons, close, [aid]);
  });

  it("clients cannot touch the columns the rules depend on", async () => {
    const aid = await action();
    for (const set of ["awaiting_review_at = now()", "reopened_at = now()", "closure_note = 'done'"]) {
      await expect(attempt(U.cmgr, `UPDATE actions SET ${set} WHERE id = $1`, [aid]), set).rejects.toThrow(/only move/);
    }
  });

  it("the owner is an active member of the project team", async () => {
    const aid = await action();
    const owner_ = `UPDATE actions SET owner_user_id = $2 WHERE id = $1`;
    for (const u of [U.outsider, U.former, U.lead]) {
      await expect(attempt(U.cmgr, owner_, [aid, u]), u).rejects.toThrow(/active member of the project team/);
    }
    await expect(attempt(U.cons, owner_, [aid, U.outsider])).rejects.toThrow(/active member/);
    await attempt(U.cmgr, owner_, [aid, U.cmgr]);
  });

  it("only drafts are deleted", async () => {
    const released = await action();
    const draft = await action({ status: "draft" });
    expect((await attempt(U.cons, `DELETE FROM actions WHERE id = $1`, [released])).rowCount).toBe(0);
    expect((await attempt(U.cons, `DELETE FROM actions WHERE id = $1`, [draft])).rowCount).toBe(1);
  });

  it("a closed action cannot jump to verified", async () => {
    const aid = await action();
    await run(U.cons, `UPDATE actions SET status = 'closed', closure_outcome = 'not_applicable' WHERE id = $1`, [aid]);
    await expect(
      attempt(U.cons, `UPDATE actions SET status = 'verified_complete', closure_outcome = null WHERE id = $1`, [aid]),
    ).rejects.toThrow(/invalid action status change/);
  });
});

describe("evidence lists", () => {
  const ask = (aid: string, by = U.cons) =>
    as(
      by,
      async (c) =>
        (
          await c.query(
            `INSERT INTO evidence_requests (id, project_id, org_id, action_id, title, created_by, status) VALUES ($1,$2,$3,$4,'Signed charter',$5,'accepted')`,
            [next(), PROJ, ACME, aid, by],
          )
        ).rowCount,
      true,
    );
  const requestsOf = async (aid: string) =>
    (await owner.query(`SELECT * FROM evidence_requests WHERE action_id = $1 ORDER BY created_at`, [aid])).rows;

  it("the firm writes the list, the client reads it, and a new item starts open", async () => {
    const aid = await action();
    await expect(ask(aid, U.cmgr)).rejects.toThrow(/row-level security/);
    await ask(aid);
    const [item] = await requestsOf(aid);
    expect(item.status).toBe("open");
    const seen = await attempt(U.cowner, `SELECT id FROM evidence_requests WHERE action_id = $1`, [aid]);
    expect(seen.rowCount).toBe(1);
    await expect(
      attempt(U.cowner, `UPDATE evidence_requests SET status = 'waived' WHERE id = $1`, [item.id]),
    ).resolves.toMatchObject({
      rowCount: 0,
    });
  });

  it("a file marks its item submitted, and only an item of the same action", async () => {
    const aid = await action();
    const other = await action();
    await ask(aid);
    await ask(other);
    const [item] = await requestsOf(aid);
    await expect(submitEvidence(other, item.id)).rejects.toThrow(/not open on this action/);
    await submitEvidence(aid, item.id);
    expect((await requestsOf(aid))[0].status).toBe("submitted");
  });

  it("verified complete needs every item accepted or waived, and decisions record who decided", async () => {
    const aid = await action({ status: "awaiting_review" });
    await ask(aid);
    await ask(aid);
    const [a, b] = await requestsOf(aid);
    const sub = await submitEvidence(aid, a.id);
    await owner.query(
      `INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome, evidence_submission_ids) VALUES ($1,$2,$3,$4,'accept',$5::uuid[])`,
      [PROJ, ACME, aid, U.cons, `{${sub}}`],
    );
    const verify = `UPDATE actions SET status = 'verified_complete' WHERE id = $1`;
    await expect(attempt(U.cons, verify, [aid])).rejects.toThrow(/accepted or waived/);
    // A client cannot pretend an item was submitted.
    await expect(attempt(U.cons, `UPDATE evidence_requests SET status = 'submitted' WHERE id = $1`, [b.id])).rejects.toThrow(
      /invalid evidence request change/,
    );
    await run(U.cons, `UPDATE evidence_requests SET status = 'accepted' WHERE id = $1`, [a.id]);
    await run(U.cons, `UPDATE evidence_requests SET status = 'waived', decision_note = 'Not needed' WHERE id = $1`, [b.id]);
    const decided = await requestsOf(aid);
    expect(decided.map((r) => [r.status, r.decided_by])).toEqual([
      ["accepted", U.cons],
      ["waived", U.cons],
    ]);
    await run(U.cons, verify, [aid]);
  });

  it("a waiver says why, and only a scanned file answers an item", async () => {
    const aid = await action();
    await ask(aid);
    const [item] = await requestsOf(aid);
    await expect(attempt(U.cons, `UPDATE evidence_requests SET status = 'waived' WHERE id = $1`, [item.id])).rejects.toThrow(
      /waiver_explained/,
    );
    const doc = next();
    await owner.query(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, storage_key, content_type, size_bytes, sha256, scan_status)
       VALUES ($1,$2,$3,$3,$4,'evidence','submitted','e.pdf','shared',$5,'application/pdf',1,'x','pending')`,
      [doc, PROJ, ACME, U.cowner, `k-${doc}`],
    );
    await expect(
      owner.query(
        `INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by, evidence_request_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [PROJ, ACME, aid, doc, U.cowner, item.id],
      ),
    ).rejects.toThrow(/virus scan/);
  });

  it("a rejected item can be asked again, and an accepted one cannot be undone", async () => {
    const aid = await action();
    await ask(aid);
    const [item] = await requestsOf(aid);
    await expect(attempt(U.cons, `UPDATE evidence_requests SET status = 'rejected' WHERE id = $1`, [item.id])).rejects.toThrow(
      /invalid evidence request change/,
    );
    await submitEvidence(aid, item.id);
    await run(U.cons, `UPDATE evidence_requests SET status = 'rejected' WHERE id = $1`, [item.id]);
    await run(U.cons, `UPDATE evidence_requests SET status = 'open' WHERE id = $1`, [item.id]);
    // Nobody answered the item again yet, so it cannot be accepted.
    await expect(attempt(U.cons, `UPDATE evidence_requests SET status = 'accepted' WHERE id = $1`, [item.id])).rejects.toThrow(
      /invalid evidence request change/,
    );
    await submitEvidence(aid, item.id);
    await run(U.cons, `UPDATE evidence_requests SET status = 'accepted' WHERE id = $1`, [item.id]);
    for (const status of ["open", "rejected", "waived"]) {
      await expect(attempt(U.cons, `UPDATE evidence_requests SET status = $2 WHERE id = $1`, [item.id, status])).rejects.toThrow(
        /invalid evidence request change/,
      );
    }
  });
});

describe("firm notes on an action", () => {
  it("are visible to the staffed firm only, and append-only", async () => {
    const aid = await action();
    await run(
      U.cons,
      `INSERT INTO action_notes (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'Client is slow')`,
      [PROJ, ACME, aid, U.cons],
    );
    const read = `SELECT body FROM action_notes WHERE action_id = $1`;
    expect((await attempt(U.cons, read, [aid])).rowCount).toBe(1);
    expect((await attempt(U.admin, read, [aid])).rowCount).toBe(1);
    expect((await attempt(U.lead, read, [aid])).rowCount).toBe(1);
    for (const u of [U.outsider, U.cadmin, U.cmgr, U.cowner]) expect((await attempt(u, read, [aid])).rowCount, u).toBe(0);
    await expect(
      attempt(U.cmgr, `INSERT INTO action_notes (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'x')`, [
        PROJ,
        ACME,
        aid,
        U.cmgr,
      ]),
    ).rejects.toThrow(/row-level security/);
    await expect(attempt(U.cons, `UPDATE action_notes SET body = 'x' WHERE action_id = $1`, [aid])).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("deadline change requests", () => {
  const request = (aid: string, by: string, status = "pending") =>
    run(
      by,
      `INSERT INTO deadline_change_requests (id, project_id, org_id, action_id, requested_by, proposed_due_date, reason, status)
       VALUES ($1,$2,$3,$4,$5,'2099-02-01','Board meets in January',$6)`,
      [next(), PROJ, ACME, aid, by, status],
    );
  const requestsOf = async (aid: string) =>
    (await owner.query(`SELECT * FROM deadline_change_requests WHERE action_id = $1`, [aid])).rows;

  it("the owner asks, the firm decides once, and approval moves the due date", async () => {
    const aid = await action({ due: "2026-12-01" });
    await expect(request(aid, U.cowner, "approved")).rejects.toThrow(/row-level security/);
    await request(aid, U.cowner);
    const [req] = await requestsOf(aid);
    expect(
      (await attempt(U.cmgr, `UPDATE deadline_change_requests SET status = 'approved' WHERE id = $1`, [req.id])).rowCount,
    ).toBe(0);
    await expect(
      attempt(U.cons, `UPDATE deadline_change_requests SET proposed_due_date = '2099-03-01', status = 'approved' WHERE id = $1`, [
        req.id,
      ]),
    ).rejects.toThrow(/only the decision/);
    await run(U.cons, `UPDATE deadline_change_requests SET status = 'approved' WHERE id = $1`, [req.id]);
    expect((await statusOf(aid)).due_date).toEqual(new Date("2099-02-01T00:00:00"));
    expect((await requestsOf(aid))[0].decided_by).toBe(U.cons);
    await expect(
      attempt(U.cons, `UPDATE deadline_change_requests SET status = 'rejected' WHERE id = $1`, [req.id]),
    ).rejects.toThrow(/final/);
    await expect(attempt(U.cowner, `DELETE FROM deadline_change_requests WHERE id = $1`, [req.id])).rejects.toThrow(
      /permission denied/,
    );
  });

  it("only the owner, the client's managers and admins, or the firm ask, and for a real new date", async () => {
    const aid = await action({ due: "2099-01-01" });
    await owner.query(`UPDATE actions SET owner_user_id = $2 WHERE id = $1`, [aid, U.cmgr]);
    await expect(request(aid, U.cowner)).rejects.toThrow(/row-level security/);
    await request(aid, U.cadmin);
    const other = await action({ due: "2099-01-01" });
    const ask = (date: string) =>
      attempt(
        U.cowner,
        `INSERT INTO deadline_change_requests (project_id, org_id, action_id, requested_by, proposed_due_date, reason) VALUES ($1,$2,$3,$4,$5,'x')`,
        [PROJ, ACME, other, U.cowner, date],
      );
    await expect(ask("2099-01-01")).rejects.toThrow(/new date/);
    await expect(ask("2020-01-01")).rejects.toThrow(/new date/);
  });

  it("finished actions take no new deadline", async () => {
    const aid = await action({ status: "closed", closure: "not_applicable" });
    await expect(request(aid, U.cowner)).rejects.toThrow(/open actions/);
  });
});

/** Runs a service as the user, committed. */
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    true,
  );

describe("the action page's evidence list and date requests", () => {
  it("show each side what it may see and do", async () => {
    const aid = await action({ due: "2099-01-01" });
    await svc(U.cons, (tx, p) => F.addEvidenceRequest(tx, p, aid, { title: "Signed policy", dueDate: "2099-01-15" }));
    const client = await svc(U.cowner, (tx, p) => F.actionFollowThrough(tx, p, aid));
    expect(client.items.map((i) => [i.title, i.status, i.files])).toEqual([["Signed policy", "open", []]]);
    expect(client.can).toEqual({ manageItems: false, requestDeadline: true, decideDeadline: false });
    expect((await svc(U.cons, (tx, p) => F.actionFollowThrough(tx, p, aid))).can).toMatchObject({
      manageItems: true,
      decideDeadline: true,
    });

    await svc(U.cowner, (tx, p) =>
      F.requestDeadlineChange(tx, p, aid, { proposedDueDate: "2099-02-01", reason: "Board meets late" }),
    );
    const waiting = await svc(U.cowner, (tx, p) => F.actionFollowThrough(tx, p, aid));
    expect(waiting.deadlines.map((d) => [d.proposedDueDate, d.status])).toEqual([["2099-02-01", "pending"]]);
    // One request waits at a time.
    expect(waiting.can.requestDeadline).toBe(false);
    await svc(U.cons, (tx, p) => F.decideDeadlineChange(tx, p, waiting.deadlines[0]!.id, { approve: true }));
    expect((await statusOf(aid)).due_date).toEqual(new Date("2099-02-01T00:00:00"));
    expect((await svc(U.cowner, (tx, p) => F.actionFollowThrough(tx, p, aid))).can.requestDeadline).toBe(true);

    // Someone outside the project gets nothing.
    await expect(svc(U.outsider, (tx, p) => F.actionFollowThrough(tx, p, aid))).rejects.toThrow();
  });
});

describe("reminders and the escalation ladder", () => {
  const TODAY = "2027-03-20";
  const due = async (ids: string[]) =>
    (
      await owner.query(
        `SELECT action_id, kind, level, recipients FROM app_follow_ups_due($1) WHERE action_id = ANY($2::uuid[])`,
        [TODAY, `{${ids.join(",")}}`],
      )
    ).rows;
  const sorted = (...u: string[]) => [...u].sort();

  it("climbs from the owner to the managers and lead, then the client admins and watchers", async () => {
    const soon = await action({ due: "2027-03-22" });
    const late = await action({ due: "2027-03-18" });
    const later = await action({ due: "2027-03-10" });
    const latest = await action({ due: "2027-03-01" });
    const rows = await due([soon, late, later, latest]);
    const byId = Object.fromEntries(rows.map((r) => [r.action_id, r]));
    expect([byId[soon].kind, byId[soon].level, byId[soon].recipients]).toEqual(["due_soon", 0, [U.cowner]]);
    expect([byId[late].kind, byId[late].level, byId[late].recipients]).toEqual(["overdue", 1, [U.cowner]]);
    expect([byId[later].level, byId[later].recipients]).toEqual([2, sorted(U.cowner, U.cmgr, U.lead)]);
    expect([byId[latest].level, byId[latest].recipients]).toEqual([3, sorted(U.cowner, U.cmgr, U.lead, U.cadmin, U.admin)]);
  });

  it("skips actions waiting on the firm, finished ones and ones already reminded", async () => {
    const waiting = await action({ status: "awaiting_review", due: "2027-03-01" });
    const closed = await action({ status: "closed", closure: "not_applicable", due: "2027-03-01" });
    const sent = await action({ due: "2027-03-18" });
    await owner.query(
      `INSERT INTO follow_up_log (action_id, kind, level, due_date, recipients) VALUES ($1,'overdue',1,'2027-03-18',$2::uuid[])`,
      [sent, `{${U.cowner}}`],
    );
    expect(await due([waiting, closed, sent])).toEqual([]);
    // A new due date re-arms the reminders.
    await owner.query(`UPDATE actions SET due_date = '2027-03-19' WHERE id = $1`, [sent]);
    expect((await due([sent])).map((r) => r.level)).toEqual([1]);
  });

  it("an owner who has left is skipped and the ladder starts at level 2", async () => {
    const aid = await action({ due: "2027-03-18" });
    await owner.query(`UPDATE actions SET owner_user_id = $2 WHERE id = $1`, [aid, U.former]);
    const [row] = await due([aid]);
    expect([row.level, row.recipients]).toEqual([2, sorted(U.cmgr, U.lead)]);
  });

  it("the daily job notifies each recipient once, however often it runs", async () => {
    const aid = await action({ due: "2027-03-15" });
    const notes = async () =>
      (await owner.query(`SELECT user_id, kind FROM notifications WHERE entity_id = $1 ORDER BY user_id`, [aid])).rows;
    await runFollowUps(owner, TODAY);
    await Promise.all([runFollowUps(owner, TODAY), runFollowUps(owner, TODAY)]);
    expect(await notes()).toEqual([{ user_id: U.cowner, kind: "follow_up.overdue.1" }]);
  });

  it("only the job runs it; the app role cannot read the log", async () => {
    await expect(attempt(U.admin, `SELECT * FROM app_follow_ups_due('2027-03-20')`)).rejects.toThrow(/permission denied/);
    await expect(attempt(U.admin, `SELECT * FROM follow_up_log`)).rejects.toThrow(/permission denied/);
  });
});

describe("telling the firm-side team", () => {
  it("only the person who signed or asked can announce it", async () => {
    const aid = await action();
    const notify = (kind: string) => `SELECT app_notify_project_team($1, '${kind}', '{}') AS n`;
    const sent = await as(U.cmgr, async (c) => {
      await c.query(
        `INSERT INTO risk_acceptances (project_id, org_id, action_id, accepted_by, statement) VALUES ($1,$2,$3,$4,'Accepted')`,
        [PROJ, ACME, aid, U.cmgr],
      );
      return Number((await c.query(notify("risk.accepted"), [aid])).rows[0].n);
    });
    expect(sent).toBe(3); // the client's lead, the staffed consultant, the watching admin
    await expect(attempt(U.cowner, notify("risk.accepted"), [aid])).rejects.toThrow(/does not match/);
    await expect(attempt(U.cowner, notify("deadline.requested"), [aid])).rejects.toThrow(/does not match/);
  });
});

describe("implementation progress", () => {
  it("an issued report's numbers are frozen; sharing it is the only change", async () => {
    const rid = next();
    await run(
      U.cons,
      `INSERT INTO reports (id, project_id, org_id, title, body_md, generated_by, period_start, period_end, metrics)
       VALUES ($1,$2,$3,'October','',$4,'2026-10-01','2026-10-31','{"implementedPct": 25}')`,
      [rid, PROJ, ACME, U.cons],
    );
    await expect(attempt(U.cons, `UPDATE reports SET metrics = '{"implementedPct": 90}' WHERE id = $1`, [rid])).rejects.toThrow(
      /cannot change/,
    );
    await expect(attempt(U.cons, `DELETE FROM reports WHERE id = $1`, [rid])).rejects.toThrow(/cannot change/);
    await attempt(U.cons, `UPDATE reports SET visibility = 'shared', shared_at = now() WHERE id = $1`, [rid]);
  });

  it("a report stays with the firm until it is shared, once", async () => {
    const { id: rid } = await svc(U.cons, (tx, p) =>
      F.snapshotReport(tx, p, PROJ, { title: "Quarter", periodStart: "2026-07-01", periodEnd: "2026-09-30" }),
    );
    const titles = (userId: string) => svc(userId, async (tx, p) => (await F.listReports(tx, p, PROJ)).reports.map((r) => r.id));
    expect(await titles(U.cons)).toContain(rid);
    expect(await titles(U.cmgr)).not.toContain(rid);
    await expect(svc(U.cmgr, (tx, p) => F.getReport(tx, p, rid))).rejects.toThrow(/not found/i);
    await expect(svc(U.cmgr, (tx, p) => F.shareReport(tx, p, rid))).rejects.toThrow(/not found/i);
    expect((await svc(U.cmgr, (tx, p) => F.listReports(tx, p, PROJ))).can.write).toBe(false);

    expect((await svc(U.cons, (tx, p) => F.getReport(tx, p, rid))).can.share).toBe(true);
    await svc(U.cons, (tx, p) => F.shareReport(tx, p, rid));
    await expect(svc(U.cons, (tx, p) => F.shareReport(tx, p, rid))).rejects.toThrow(/already shared/);
    const seen = await svc(U.cmgr, (tx, p) => F.getReport(tx, p, rid));
    expect(seen.report.visibility).toBe("shared");
    expect(seen.can.share).toBe(false);
    expect(await titles(U.cmgr)).toContain(rid);
    // Action owners don't read reports.
    await expect(svc(U.cowner, (tx, p) => F.listReports(tx, p, PROJ))).rejects.toThrow();
  });

  it("counts verified over what still applies, as the caller sees it", async () => {
    await action({ project: PROJ_STATS, status: "verified_complete" });
    await action({ project: PROJ_STATS, status: "closed", closure: "partially_implemented" });
    await action({ project: PROJ_STATS, status: "closed", closure: "risk_accepted" });
    await action({ project: PROJ_STATS, status: "closed", closure: "not_applicable" });
    await action({ project: PROJ_STATS, status: "in_progress", due: "2026-01-01" });
    await action({ project: PROJ_STATS, status: "draft" });
    const stats = `SELECT * FROM app_project_progress($1, '2026-10-20')`;
    const { rows } = await attempt(U.cons, stats, [PROJ_STATS]);
    expect(rows[0]).toMatchObject({
      total: 5,
      verified: 1,
      partially: 1,
      risk_accepted: 1,
      not_applicable: 1,
      open: 1,
      overdue: 1,
    });
    // 1 verified / (5 - 1 not applicable) = 25%; partial work is counted, not credited
    expect(Number(rows[0].implemented_pct)).toBe(25);
    // Someone who cannot see the project gets nothing.
    const hidden = await attempt(U.outsider, stats, [PROJ_STATS]);
    expect(hidden.rows[0]).toMatchObject({ total: 0, implemented_pct: null });
  });
});
