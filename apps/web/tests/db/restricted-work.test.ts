// A restricted client's admin does the owner's work on the actions they own
// (phase 3 assessment, area 7 item 1; owner decision 19 Nov 2026). A
// restricted client has admin accounts only and the firm records only for
// clients it runs, so before RESTRICTED_POLICY (src/authz/policy.ts) and
// migration 0107 nobody could move a restricted client's actions. Checked
// through the services the API and the action page use, and in the database
// itself. A full client's admin keeps today's rights. Reviewing stays the
// firm's, and whoever recorded a round cannot review it.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { nextStep } from "@/lib/action-next";
import { transitionAction } from "@/services/actions";
import { submitEvidence } from "@/services/evidence";
import { actionFollowThrough, requestDeadlineChange } from "@/services/follow-through";
import { loadPrincipal } from "@/services/principal";
import { addProgressUpdate } from "@/services/progress";
import { getActionDetail } from "@/services/queries";

vi.mock("@/services/storage", () => ({ putObject: async () => undefined, copyObject: async () => undefined }));

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-a7a7-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const FULL = id(2); // full: its people sign in
const RESTR = id(3); // restricted: admins only
const MANAGED = id(4); // consultant-managed: the firm records for it
const U = {
  admin: id(11), // firm admin
  lead: id(12), // leads every client, staffed everywhere
  cons: id(13), // staffed everywhere: a second reviewer
  fadmin: id(14), // the full client's admin
  fowner: id(15), // the full client's action owner
  radmin: id(16), // the restricted client's admin
  radmin2: id(17), // its second admin
};
const P = { full: id(21), restr: id(22), managed: id(23) };
const REC = { full: id(31), restr: id(32), managed: id(33) };
const orgOf = { [P.full]: FULL, [P.restr]: RESTR, [P.managed]: MANAGED };
const recOf = { [P.full]: REC.full, [P.restr]: REC.restr, [P.managed]: REC.managed };
let n = 100;
const next = () => id(++n);

const file = { bytes: new Uint8Array([37, 80, 68, 70]), fileName: "minutes.pdf", contentType: "application/pdf", sha256: "x", scanned: true, scanMs: 1 };

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
const attempt = (userId: string, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params));
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>, commit = true) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    commit,
  );

async function action(project: string, fields: { owner?: string | null; ownerName?: string; status?: string } = {}) {
  const aid = next();
  await owner.query(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, owner_name, status, created_by)
     VALUES ($1,$2,$3,$4,'Form the family council',$5,$6,$7,$8)`,
    [aid, project, orgOf[project], recOf[project], fields.owner ?? null, fields.ownerName ?? null, fields.status ?? "assigned", U.lead],
  );
  return aid;
}
const statusOf = async (aid: string) => (await owner.query(`SELECT status FROM actions WHERE id = $1`, [aid])).rows[0].status as string;
const firmDay = async (plus: number) => (await owner.query(`SELECT (app_firm_today() + $1::int)::text AS d`, [plus])).rows[0].d as string;

/** What the action page offers this reader: the moves, the file and note rights, and the one card. */
async function page(userId: string, aid: string) {
  return svc(
    userId,
    async (tx, p) => {
      const detail = await getActionDetail(tx, p, aid);
      const follow = await actionFollowThrough(tx, p, aid);
      const plan = nextStep({
        status: detail.action.status,
        moves: detail.moves,
        canSubmitEvidence: detail.can.submitEvidence,
        canRequestDate: follow.can.requestDeadline,
        canAsk: false,
        canSignRisk: false,
        canMute: false,
        firm: p.orgKind === "firm",
        second: null,
        dateToDecide: false,
        items: { open: 0, submitted: 0 },
      });
      return { moves: detail.moves, can: detail.can, requestDeadline: follow.can.requestDeadline, plan };
    },
    false,
  );
}

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode) VALUES
      ($1,'firm','firm',NULL), ($2,'client','Full','full'), ($3,'client','Quiet','restricted'), ($4,'client','Family','consultant_managed')`,
    [FIRM, FULL, RESTR, MANAGED],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$8,'firm_admin'), ($2,$8,'consultant'), ($3,$8,'consultant'),
      ($4,$9,'client_admin'), ($5,$9,'action_owner'), ($6,$10,'client_admin'), ($7,$10,'client_admin')`,
    [U.admin, U.lead, U.cons, U.fadmin, U.fowner, U.radmin, U.radmin2, FIRM, FULL, RESTR],
  );
  for (const project of [P.full, P.restr, P.managed]) {
    const org = orgOf[project]!;
    await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($1,$3,false)`, [org, U.lead, U.cons]);
    await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Governance','active',$4)`, [
      project,
      org,
      FIRM,
      U.admin,
    ]);
    await q(`INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES ($1,$2,$3,'Family council',$4)`, [
      recOf[project],
      project,
      org,
      U.lead,
    ]);
    await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3)`, [project, U.lead, U.cons]);
  }
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($4,$5), ($4,$6)`, [
    P.restr,
    U.radmin,
    U.radmin2,
    P.full,
    U.fadmin,
    U.fowner,
  ]);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("a restricted client's admin, on an action they own", () => {
  it("is offered the owner's steps on the action page", async () => {
    const aid = await action(P.restr, { owner: U.radmin });
    const before = await page(U.radmin, aid);
    expect(before.moves).toContain("in_progress");
    expect(before.plan.main).toBe("start");
    expect(before.plan.waiting).toBeNull();
    expect(before.can.addUpdate).toBe(true);
    expect(before.requestDeadline).toBe(true);
    expect(before.plan.links).toContain("moreTime");
  });

  it("starts, is stuck, resumes, writes progress, asks for more time, sends for review and sends the revised file", async () => {
    const aid = await action(P.restr, { owner: U.radmin });
    // Start.
    await svc(U.radmin, (tx, p) => transitionAction(tx, p, aid, { to: "in_progress" }));
    expect(await statusOf(aid)).toBe("in_progress");
    const working = await page(U.radmin, aid);
    expect(working.plan.main).toBe("send");
    expect(working.plan.links).toContain("stuck");
    expect(working.can.submitEvidence).toBe(true);
    // I am stuck, then resume.
    await svc(U.radmin, (tx, p) => transitionAction(tx, p, aid, { to: "blocked", reason: "Waiting for the board" }));
    expect(await statusOf(aid)).toBe("blocked");
    expect((await page(U.radmin, aid)).plan.main).toBe("resume");
    await svc(U.radmin, (tx, p) => transitionAction(tx, p, aid, { to: "in_progress" }));
    // Progress.
    await svc(U.radmin, (tx, p) => addProgressUpdate(tx, p, aid, "The council met for the first time."));
    const progress = await owner.query(`SELECT source FROM progress_updates WHERE action_id = $1`, [aid]);
    expect(progress.rows).toEqual([{ source: "client_portal" }]);
    // More time.
    await svc(U.radmin, (tx, p) => requestDeadlineChange(tx, p, aid, { proposedDueDate: "2099-06-30", reason: "The council meets quarterly" }));
    expect((await owner.query(`SELECT requested_by FROM deadline_change_requests WHERE action_id = $1`, [aid])).rows).toEqual([{ requested_by: U.radmin }]);
    // Evidence, sent for review in one step.
    await svc(U.radmin, (tx, p) => submitEvidence(tx, p, aid, { file, submitForReview: true }));
    expect(await statusOf(aid)).toBe("awaiting_review");
    const ev = await owner.query(
      `SELECT e.source, d.visibility FROM evidence_submissions e JOIN documents d ON d.id = e.document_id WHERE e.action_id = $1`,
      [aid],
    );
    // Evidence is shared by submitting it, so the firm can verify it.
    expect(ev.rows).toEqual([{ source: "client_portal", visibility: "shared" }]);
    // The admin never reviews it: that stays the firm's.
    await expect(svc(U.radmin, (tx, p) => transitionAction(tx, p, aid, { to: "verified_complete" }))).rejects.toThrow(/forbidden/);
    // The firm sends it back; the admin sends the revised file.
    await svc(U.lead, (tx, p) => transitionAction(tx, p, aid, { to: "revision_requested", reason: "Add the signed minutes" }));
    const sentBack = await page(U.radmin, aid);
    expect(sentBack.plan.main).toBe("resend");
    await svc(U.radmin, (tx, p) => submitEvidence(tx, p, aid, { file, submitForReview: true }));
    expect(await statusOf(aid)).toBe("awaiting_review");
    await svc(U.lead, (tx, p) => transitionAction(tx, p, aid, { to: "verified_complete" }));
    expect(await statusOf(aid)).toBe("verified_complete");
  });
});

describe("a restricted client's admin, on an action they do not own", () => {
  it("is offered nothing to do on it, and the server refuses each step", async () => {
    const aid = await action(P.restr, { owner: U.radmin2, status: "in_progress" });
    const seen = await page(U.radmin, aid);
    expect(seen.moves).toEqual([]);
    expect(seen.can).toMatchObject({ addUpdate: false, submitEvidence: false });
    expect(seen.requestDeadline).toBe(false);
    expect(seen.plan.main).toBeNull();
    expect(seen.plan.waiting).toBe("withOwner");
    await expect(svc(U.radmin, (tx, p) => transitionAction(tx, p, aid, { to: "blocked", reason: "x" }))).rejects.toThrow(/forbidden/);
    await expect(svc(U.radmin, (tx, p) => addProgressUpdate(tx, p, aid, "Not mine"))).rejects.toThrow(/forbidden/);
    await expect(
      svc(U.radmin, (tx, p) => requestDeadlineChange(tx, p, aid, { proposedDueDate: "2099-06-30", reason: "x" })),
    ).rejects.toThrow(/forbidden/);
    await expect(svc(U.radmin, (tx, p) => submitEvidence(tx, p, aid, { file, submitForReview: false }))).rejects.toThrow(/forbidden/);
    // Its owner, the other admin, can.
    await svc(U.radmin2, (tx, p) => addProgressUpdate(tx, p, aid, "Mine"));
  });

  it("is refused by the database too (migration 0107)", async () => {
    const aid = await action(P.restr, { owner: U.radmin2, status: "in_progress" });
    const unowned = await action(P.restr, { owner: null, status: "in_progress" });
    for (const target of [aid, unowned]) {
      await expect(
        attempt(U.radmin, `INSERT INTO progress_updates (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'x')`, [
          P.restr,
          RESTR,
          target,
          U.radmin,
        ]),
      ).rejects.toThrow(/row-level security/);
      await expect(
        attempt(
          U.radmin,
          `INSERT INTO deadline_change_requests (project_id, org_id, action_id, requested_by, proposed_due_date, reason) VALUES ($1,$2,$3,$4,'2099-06-30','x')`,
          [P.restr, RESTR, target, U.radmin],
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(attempt(U.radmin, `UPDATE actions SET status = 'blocked', blocked_reason = 'x' WHERE id = $1`, [target])).rejects.toThrow(
        /moves only the actions they own/,
      );
    }
    const doc = next();
    await owner.query(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, storage_key, content_type, size_bytes, sha256, scan_status)
       VALUES ($1,$2,$3,$3,$4,'evidence','submitted','e.pdf','shared',$5,'application/pdf',1,'x','clean')`,
      [doc, P.restr, RESTR, U.radmin, `k-${doc}`],
    );
    await expect(
      attempt(U.radmin, `INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by) VALUES ($1,$2,$3,$4,$5)`, [
        P.restr,
        RESTR,
        aid,
        doc,
        U.radmin,
      ]),
    ).rejects.toThrow(/row-level security/);
    // The owner's own work passes the same rule.
    await attempt(U.radmin2, `UPDATE actions SET status = 'blocked', blocked_reason = 'x' WHERE id = $1`, [aid]);
  });

  it("and the firm still records nothing for a restricted client", async () => {
    const aid = await action(P.restr, { owner: U.radmin, status: "in_progress" });
    await expect(svc(U.lead, (tx, p) => addProgressUpdate(tx, p, aid, "Told us by phone", { receivedVia: "phone", receivedOn: "2026-10-01" }))).rejects.toThrow(
      /forbidden/,
    );
    expect((await page(U.lead, aid)).moves).not.toContain("blocked");
  });
});

describe("a full client's admin (no change)", () => {
  it("still does not record progress or evidence, even on an action they own", async () => {
    const aid = await action(P.full, { owner: U.fadmin, status: "in_progress" });
    const seen = await page(U.fadmin, aid);
    expect(seen.moves).toEqual([]);
    expect(seen.can).toMatchObject({ addUpdate: false, submitEvidence: false });
    expect(seen.requestDeadline).toBe(false);
    await expect(svc(U.fadmin, (tx, p) => transitionAction(tx, p, aid, { to: "blocked", reason: "x" }))).rejects.toThrow(/forbidden/);
    await expect(svc(U.fadmin, (tx, p) => addProgressUpdate(tx, p, aid, "x"))).rejects.toThrow(/forbidden/);
    await expect(svc(U.fadmin, (tx, p) => submitEvidence(tx, p, aid, { file, submitForReview: false }))).rejects.toThrow(/forbidden/);
    await expect(
      svc(U.fadmin, (tx, p) => requestDeadlineChange(tx, p, aid, { proposedDueDate: "2099-06-30", reason: "x" })),
    ).rejects.toThrow(/forbidden/);
  });

  it("and the full client's action owner works as before", async () => {
    const aid = await action(P.full, { owner: U.fowner });
    expect((await page(U.fowner, aid)).plan.main).toBe("start");
    await svc(U.fowner, (tx, p) => transitionAction(tx, p, aid, { to: "in_progress" }));
    await svc(U.fowner, (tx, p) => addProgressUpdate(tx, p, aid, "Started"));
    expect(await statusOf(aid)).toBe("in_progress");
  });

  it("is not touched by the restricted rule in the database", async () => {
    // The database lets a full client's admin write here as before (the service decides who works).
    const aid = await action(P.full, { owner: U.fowner, status: "in_progress" });
    await attempt(U.fadmin, `INSERT INTO progress_updates (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'x')`, [
      P.full,
      FULL,
      aid,
      U.fadmin,
    ]);
    await attempt(U.fadmin, `UPDATE actions SET status = 'blocked', blocked_reason = 'x' WHERE id = $1`, [aid]);
  });
});

describe("separation of duties", () => {
  it("the firm cannot review a round it recorded for a client it runs; a colleague can", async () => {
    const aid = await action(P.managed, { ownerName: "Office manager", status: "in_progress" });
    const on = await firmDay(0);
    await svc(U.lead, (tx, p) => submitEvidence(tx, p, aid, { file, submitForReview: true, received: { receivedVia: "email", receivedOn: on } }));
    expect(await statusOf(aid)).toBe("awaiting_review");
    const leadSees = await page(U.lead, aid);
    expect(leadSees.moves).not.toContain("verified_complete");
    await expect(svc(U.lead, (tx, p) => transitionAction(tx, p, aid, { to: "verified_complete" }))).rejects.toThrow(/forbidden/);
    await expect(svc(U.lead, (tx, p) => transitionAction(tx, p, aid, { to: "revision_requested", reason: "x" }))).rejects.toThrow(/forbidden/);
    expect((await page(U.cons, aid)).moves).toContain("verified_complete");
    await svc(U.cons, (tx, p) => transitionAction(tx, p, aid, { to: "verified_complete" }));
    expect(await statusOf(aid)).toBe("verified_complete");
  });

  it("the restricted admin who recorded a round is not its reviewer; the firm reviews it", async () => {
    const aid = await action(P.restr, { owner: U.radmin, status: "in_progress" });
    await svc(U.radmin, (tx, p) => submitEvidence(tx, p, aid, { file, submitForReview: true }));
    expect((await page(U.radmin, aid)).moves).toEqual([]);
    await expect(
      attempt(U.radmin, `INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'accept')`, [P.restr, RESTR, aid, U.radmin]),
    ).rejects.toThrow(/row-level security/);
    expect((await page(U.cons, aid)).moves).toContain("verified_complete");
  });
});
