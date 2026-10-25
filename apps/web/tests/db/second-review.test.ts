// A second consultant's sign-off on evidence (F22, migration 0062): when it
// applies (the client's rule or the action's own switch), who may give each
// sign-off, who may set the rule and the switch, and that nothing about it
// crosses to another client.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { secondReviewRule } from "@/db/schema";
import { SECOND_REVIEW_RULES } from "@/lib/second-review";
import { transitionAction } from "@/services/actions";
import { loadPrincipal } from "@/services/principal";
import { truncateAuditLog } from "./audit-reset";
import { getActionDetail } from "@/services/queries";
import {
  actionSecondReview,
  getClientReviewRule,
  reviewQueue,
  setActionSecondReview,
  setClientReviewRule,
  signOff,
} from "@/services/second-review";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-a2f2-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = {
  admin: id(11),
  lead: id(12), // Acme's lead, not staffed on the project
  dep: id(13), // Acme's deputy
  cons: id(14), // staffed on the Acme project
  cons2: id(15), // staffed on the Acme project
  outsider: id(16), // consultant on nothing
  obs: id(17), // observes the Acme project
  cadmin: id(18),
  cmgr: id(19), // Acme client manager, on the project
  cowner: id(20), // Acme action owner, on the project
  betaMgr: id(21), // client manager at Beta
  betaLead: id(22), // Beta's lead
};
const PROJ = id(31);
const BETA_PROJ = id(32);
const INTERNAL = id(33);
const REC = id(41); // medium priority
const REC_HIGH = id(42);
const REC_INT = id(43);
let n = 100;
const next = () => id(++n);

async function as<T>(userId: string, fn: (c: PoolClient) => Promise<T>, commit = true): Promise<T> {
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
const sql = (userId: string, text: string, params: unknown[] = []) => as(userId, (c) => c.query(text, params));
const svc = <T>(userId: string, fn: (tx: Tx, p: Principal) => Promise<T>) =>
  as(userId, async (c) => {
    const tx = drizzle(c, { schema }) as unknown as Tx;
    return fn(tx, (await loadPrincipal(tx, userId))!);
  });
const refused = (p: Promise<unknown>) =>
  p.then(
    () => "",
    (e: Error & { cause?: Error }) => `${e.name}: ${e.cause?.message ?? e.message}`,
  );

/** An action waiting for review, with one evidence file from `by` (the owner unless a consultant recorded it). */
async function waiting(opts: { rec?: string; project?: string; org?: string; by?: string; ownerId?: string | null } = {}) {
  const project = opts.project ?? PROJ;
  const org = opts.org ?? ACME;
  const aid = next();
  await owner.query(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, created_by)
     VALUES ($1,$2,$3,$4,'Adopt the charter',$5,'in_progress',$6)`,
    [aid, project, org, opts.rec ?? REC, opts.ownerId === undefined ? U.cowner : opts.ownerId, U.cons],
  );
  await submit(aid, opts.by ?? U.cowner, project, org);
  await owner.query(`UPDATE actions SET status = 'awaiting_review' WHERE id = $1`, [aid]);
  return aid;
}
async function submit(aid: string, by: string, project = PROJ, org = ACME) {
  const doc = next();
  await owner.query(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, storage_key, content_type, size_bytes, sha256, scan_status)
     VALUES ($1,$2,$3,$3,$4,'evidence','submitted','e.pdf','shared',$5,'application/pdf',1,'abc','clean')`,
    [doc, project, org, by, `k-${doc}`],
  );
  await owner.query(
    `INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by) VALUES ($1,$2,$3,$4,$5)`,
    [project, org, aid, doc, by],
  );
}
const statusOf = async (aid: string) => (await owner.query(`SELECT status FROM actions WHERE id = $1`, [aid])).rows[0]?.status;
const setRule = (rule: string) =>
  owner.query(
    `INSERT INTO client_review_settings (client_org_id, rule) VALUES ($1,$2) ON CONFLICT (client_org_id) DO UPDATE SET rule = EXCLUDED.rule`,
    [ACME, rule],
  );
const verify = (userId: string, aid: string) => svc(userId, (tx, p) => transitionAction(tx, p, aid, { to: "verified_complete" }));
const revise = (userId: string, aid: string) =>
  svc(userId, (tx, p) => transitionAction(tx, p, aid, { to: "revision_requested", reason: "Needs the signed copy" }));

beforeAll(async () => {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await truncateAuditLog(owner);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [FIRM, ACME, BETA]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  for (const [uid, org, role] of [
    [U.admin, FIRM, "firm_admin"],
    [U.lead, FIRM, "consultant"],
    [U.dep, FIRM, "consultant"],
    [U.cons, FIRM, "consultant"],
    [U.cons2, FIRM, "consultant"],
    [U.outsider, FIRM, "consultant"],
    [U.obs, FIRM, "consultant"],
    [U.betaLead, FIRM, "consultant"],
    [U.cadmin, ACME, "client_admin"],
    [U.cmgr, ACME, "client_manager"],
    [U.cowner, ACME, "action_owner"],
    [U.betaMgr, BETA, "client_manager"],
  ])
    await q(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,$3)`, [uid, org, role]);
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state) VALUES
      ($1,'client',$4,$6,'Acme governance','active'), ($2,'client',$5,$6,'Beta plan','active'), ($3,'internal',$6,$6,'Methods','active')`,
    [PROJ, BETA_PROJ, INTERNAL, ACME, BETA, FIRM],
  );
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES
      ($1,$3,true,false), ($1,$4,false,true), ($1,$5,false,false), ($1,$6,false,false), ($1,$7,false,false), ($2,$8,true,false)`,
    [ACME, BETA, U.lead, U.dep, U.cons, U.cons2, U.obs, U.betaLead],
  );
  await q(
    `INSERT INTO project_members (project_id, user_id, observer) VALUES
      ($1,$2,false), ($1,$3,false), ($1,$4,false), ($1,$5,false), ($1,$6,true), ($7,$8,false), ($9,$2,false), ($9,$3,false)`,
    [PROJ, U.cons, U.cons2, U.cmgr, U.cowner, U.obs, BETA_PROJ, U.betaMgr, INTERNAL],
  );
  await q(`UPDATE project_members SET is_lead = true WHERE project_id = $1 AND user_id = $2`, [INTERNAL, U.cons]);
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, priority, created_by) VALUES
      ($1,$4,$6,'Board charter','medium',$7), ($2,$4,$6,'Conflicts policy','high',$7), ($3,$5,$8,'Templates','medium',$7)`,
    [REC, REC_HIGH, REC_INT, PROJ, INTERNAL, ACME, U.cons, FIRM],
  );
});

beforeEach(async () => {
  await owner.query(`DELETE FROM client_review_settings`);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("the rules", () => {
  it("the app and the database list the same rules", async () => {
    expect([...secondReviewRule.enumValues]).toEqual([...SECOND_REVIEW_RULES]);
    const e = await owner.query(`SELECT unnest(enum_range(NULL::second_review_rule))::text AS v`);
    expect(e.rows.map((r) => r.v)).toEqual([...SECOND_REVIEW_RULES]);
  });

  it("with no rule one consultant's accept verifies, as before", async () => {
    const aid = await waiting();
    const view = await svc(U.cons, (tx, p) => actionSecondReview(tx, p, aid));
    expect(view).toMatchObject({ required: false, rule: "off", can: { signOff: false, verify: true } });
    await verify(U.cons, aid);
    expect(await statusOf(aid)).toBe("verified_complete");
  });

  it("'all' asks for two sign-offs on every action of the client", async () => {
    await setRule("all");
    const aid = await waiting();
    expect(await svc(U.cons, (tx, p) => actionSecondReview(tx, p, aid))).toMatchObject({ required: true, reason: "all" });
  });

  it("'high_priority' covers high and critical work, and work sent back twice", async () => {
    await setRule("high_priority");
    const high = await waiting({ rec: REC_HIGH });
    const medium = await waiting();
    expect(await svc(U.cons, (tx, p) => actionSecondReview(tx, p, high))).toMatchObject({ required: true, reason: "high_priority" });
    expect(await svc(U.cons, (tx, p) => actionSecondReview(tx, p, medium))).toMatchObject({ required: false });
  });

  it("'repeat_revisions' starts after evidence goes back twice, and a reopen starts the count again", async () => {
    await setRule("repeat_revisions");
    const aid = await waiting();
    const round = async () => {
      await revise(U.cons, aid);
      await owner.query(`UPDATE actions SET status = 'in_progress' WHERE id = $1`, [aid]);
      await submit(aid, U.cowner);
      await owner.query(`UPDATE actions SET status = 'awaiting_review' WHERE id = $1`, [aid]);
    };
    await round();
    expect(await svc(U.cons, (tx, p) => actionSecondReview(tx, p, aid))).toMatchObject({ required: false, revisions: 1 });
    await round();
    expect(await svc(U.cons, (tx, p) => actionSecondReview(tx, p, aid))).toMatchObject({
      required: true,
      reason: "repeat_revisions",
      revisions: 2,
    });
    // Both sign-offs, then a reopen: the count is back to zero.
    await svc(U.cons, (tx, p) => signOff(tx, p, aid));
    await verify(U.cons2, aid);
    await svc(U.admin, (tx, p) => transitionAction(tx, p, aid, { to: "in_progress", reason: "The board changed it" }));
    await submit(aid, U.cowner);
    await owner.query(`UPDATE actions SET status = 'awaiting_review' WHERE id = $1`, [aid]);
    expect(await svc(U.cons, (tx, p) => actionSecondReview(tx, p, aid))).toMatchObject({ required: false, revisions: 0 });
  });
});

describe("two sign-offs", () => {
  it("the first sign-off keeps the action waiting; only someone else's accept verifies it", async () => {
    await setRule("all");
    const aid = await waiting();
    // An accept without the first sign-off is refused, in the app and in the database.
    expect(await refused(verify(U.cons, aid))).toMatch(/two sign-offs/);
    expect(
      await refused(
        as(U.cons, async (c) => {
          await c.query(`INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'accept')`, [
            PROJ,
            ACME,
            aid,
            U.cons,
          ]);
          await c.query(`UPDATE actions SET status = 'verified_complete' WHERE id = $1`, [aid]);
        }),
      ),
    ).toMatch(/second sign-off by another consultant/);

    await svc(U.cons, (tx, p) => signOff(tx, p, aid, "Checked the signatures"));
    expect(await statusOf(aid)).toBe("awaiting_review");
    const signoff = (await owner.query(`SELECT * FROM review_signoffs WHERE action_id = $1`, [aid])).rows[0];
    expect(signoff).toMatchObject({ reviewer_id: U.cons, note: "Checked the signatures", evidence_sha256: ["abc"] });
    expect(signoff.evidence_submission_ids).toHaveLength(1);
    // Once a round.
    expect(await refused(svc(U.cons2, (tx, p) => signOff(tx, p, aid)))).toMatch(/already has its first sign-off/);

    // The first reviewer can't give the second; the page doesn't offer it either.
    expect(await refused(verify(U.cons, aid))).toMatch(/ForbiddenError/);
    expect((await svc(U.cons, (tx, p) => getActionDetail(tx, p, aid))).moves).not.toContain("verified_complete");
    expect(
      await refused(
        as(U.cons, async (c) => {
          await c.query(`INSERT INTO reviews (project_id, org_id, action_id, reviewer_id, outcome) VALUES ($1,$2,$3,$4,'accept')`, [
            PROJ,
            ACME,
            aid,
            U.cons,
          ]);
          await c.query(`UPDATE actions SET status = 'verified_complete' WHERE id = $1`, [aid]);
        }),
      ),
    ).toMatch(/second sign-off by another consultant/);

    const second = await svc(U.cons2, (tx, p) => actionSecondReview(tx, p, aid));
    expect(second).toMatchObject({ required: true, signoff: { userId: U.cons, name: "cons" }, can: { signOff: false, verify: true } });
    expect((await svc(U.cons2, (tx, p) => getActionDetail(tx, p, aid))).moves).toContain("verified_complete");
    await verify(U.cons2, aid);
    expect(await statusOf(aid)).toBe("verified_complete");

    const audit = await owner.query(`SELECT actor_id FROM audit_log WHERE action = 'action.sign_off' AND resource_id = $1`, [aid]);
    expect(audit.rows).toEqual([{ actor_id: U.cons }]);
  });

  it("the second reviewer may ask for changes, and the next round needs both again", async () => {
    await setRule("all");
    const aid = await waiting();
    await svc(U.cons, (tx, p) => signOff(tx, p, aid));
    await revise(U.cons2, aid);
    expect(await statusOf(aid)).toBe("revision_requested");
    await owner.query(`UPDATE actions SET status = 'in_progress' WHERE id = $1`, [aid]);
    await submit(aid, U.cowner);
    await owner.query(`UPDATE actions SET status = 'awaiting_review' WHERE id = $1`, [aid]);
    expect(await svc(U.cons2, (tx, p) => actionSecondReview(tx, p, aid))).toMatchObject({
      signoff: null,
      can: { signOff: true, verify: false },
    });
  });

  it("tells whoever can give the second sign-off, never the first reviewer or the owner", async () => {
    await setRule("all");
    const aid = await waiting();
    const candidates = await svc(U.cons, (tx, p) => actionSecondReview(tx, p, aid).then((v) => v.candidates));
    // Before anyone signs off, everyone on the team who could review is listed; never the owner or the observer.
    expect(candidates.map((c) => c.id).sort()).toEqual([U.lead, U.dep, U.cons, U.cons2].sort());
    await svc(U.cons, (tx, p) => signOff(tx, p, aid));
    const told = await owner.query(`SELECT user_id FROM notifications WHERE kind = 'action.second_review' AND entity_id = $1`, [aid]);
    expect(told.rows.map((r) => r.user_id).sort()).toEqual([U.lead, U.dep, U.cons2].sort());
    const after = await svc(U.cons2, (tx, p) => actionSecondReview(tx, p, aid).then((v) => v.candidates));
    expect(after.map((c) => c.id).sort()).toEqual([U.lead, U.dep, U.cons2].sort());
  });

  it("falls back to the firm's admins when nobody else on the team can", async () => {
    // The internal project: cons leads, cons2 is the only other member and submitted the evidence.
    const aid = await waiting({ rec: REC_INT, project: INTERNAL, org: FIRM, by: U.cons2, ownerId: null });
    await svc(U.cons, (tx, p) => setActionSecondReview(tx, p, aid, true));
    await svc(U.cons, (tx, p) => signOff(tx, p, aid));
    const view = await svc(U.cons, (tx, p) => actionSecondReview(tx, p, aid));
    expect(view.candidates).toEqual([{ id: U.admin, name: "admin", fallback: true }]);
    expect(await refused(verify(U.cons2, aid))).toMatch(/ForbiddenError/); // submitted it
    await verify(U.admin, aid);
    expect(await statusOf(aid)).toBe("verified_complete");
  });

  it("nobody signs off work they submitted, and an observer, outsider or client signs off nothing", async () => {
    // On the internal project cons2 did the work: cons2 never signs it off.
    const own = await waiting({ rec: REC_INT, project: INTERNAL, org: FIRM, by: U.cons2, ownerId: null });
    await svc(U.cons, (tx, p) => setActionSecondReview(tx, p, own, true));
    expect(await refused(svc(U.cons2, (tx, p) => signOff(tx, p, own)))).toMatch(/ForbiddenError/);
    expect(await refused(sql(U.cons2, `SELECT app_sign_off($1, NULL)`, [own]))).toMatch(/own or submitted/);

    await setRule("all");
    const aid = await waiting();
    expect(await refused(sql(U.obs, `SELECT app_sign_off($1, NULL)`, [aid]))).toMatch(/observe this project/);
    expect(await refused(sql(U.outsider, `SELECT app_sign_off($1, NULL)`, [aid]))).toMatch(/not visible/);
    for (const u of [U.cmgr, U.cowner, U.cadmin, U.betaMgr]) {
      expect(await refused(sql(u, `SELECT app_sign_off($1, NULL)`, [aid]))).toMatch(/not visible/);
    }
    await svc(U.cons2, (tx, p) => signOff(tx, p, aid));
  });

  it("every evidence item is settled before the first sign-off", async () => {
    await setRule("all");
    const aid = await waiting();
    await owner.query(`INSERT INTO evidence_requests (project_id, org_id, action_id, title, created_by) VALUES ($1,$2,$3,'Signed minutes',$4)`, [
      PROJ,
      ACME,
      aid,
      U.cons,
    ]);
    expect(await refused(svc(U.cons, (tx, p) => signOff(tx, p, aid)))).toMatch(/every evidence request/);
  });

  it("work that needs one review can't be signed off half-way", async () => {
    const aid = await waiting();
    expect(await refused(svc(U.cons, (tx, p) => signOff(tx, p, aid)))).toMatch(/needs no second sign-off/);
  });

  it("sign-offs are history", async () => {
    await setRule("all");
    const aid = await waiting();
    await svc(U.cons, (tx, p) => signOff(tx, p, aid));
    await expect(owner.query(`UPDATE review_signoffs SET note = 'x' WHERE action_id = $1`, [aid])).rejects.toThrow(/append-only/);
    await expect(owner.query(`DELETE FROM review_signoffs WHERE action_id = $1`, [aid])).rejects.toThrow(/append-only/);
    expect(await refused(sql(U.cons, `UPDATE review_signoffs SET note = 'x' WHERE action_id = $1`, [aid]))).toMatch(/permission denied/);
    expect(
      await refused(
        sql(U.cons, `INSERT INTO review_signoffs (project_id, org_id, action_id, reviewer_id) VALUES ($1,$2,$3,$4)`, [PROJ, ACME, aid, U.cons]),
      ),
    ).toMatch(/permission denied/);
  });
});

describe("who asks for a second sign-off", () => {
  it("the lead, the deputy and the firm admin turn an action's switch on or off; nobody else does", async () => {
    const aid = await waiting();
    for (const u of [U.lead, U.dep, U.admin]) {
      await svc(u, (tx, p) => setActionSecondReview(tx, p, aid, true));
      expect(await svc(U.cons, (tx, p) => actionSecondReview(tx, p, aid))).toMatchObject({ required: true, reason: "flag", flagged: true });
      await svc(u, (tx, p) => setActionSecondReview(tx, p, aid, false));
    }
    expect(await refused(svc(U.cons, (tx, p) => setActionSecondReview(tx, p, aid, true)))).toMatch(/ForbiddenError/);
    // The database says the same to a direct write.
    expect(await refused(sql(U.cons, `UPDATE actions SET second_review = true WHERE id = $1`, [aid]))).toMatch(/only the lead or the firm admin/);
    expect(await refused(sql(U.cmgr, `UPDATE actions SET second_review = true WHERE id = $1`, [aid]))).toMatch(/only the lead|only move/);
    expect(await refused(sql(U.betaLead, `UPDATE actions SET second_review = true WHERE id = $1`, [aid]))).toBe("");
    expect((await owner.query(`SELECT second_review FROM actions WHERE id = $1`, [aid])).rows[0].second_review).toBe(false);
    const audit = await owner.query(`SELECT actor_id, meta FROM audit_log WHERE action = 'action.second_review' AND resource_id = $1 ORDER BY created_at`, [aid]);
    expect(audit.rows.map((r) => r.actor_id)).toEqual([U.lead, U.lead, U.dep, U.dep, U.admin, U.admin]);
  });

  it("on an internal project its lead does", async () => {
    const aid = await waiting({ rec: REC_INT, project: INTERNAL, org: FIRM, by: U.cons2, ownerId: null });
    expect(await refused(svc(U.cons2, (tx, p) => setActionSecondReview(tx, p, aid, true)))).toMatch(/ForbiddenError/);
    await svc(U.cons, (tx, p) => setActionSecondReview(tx, p, aid, true));
    expect(await svc(U.cons, (tx, p) => actionSecondReview(tx, p, aid))).toMatchObject({ required: true, rule: null, reason: "flag" });
  });

  it("the firm admin and the client's lead or deputy set the client's rule; nobody else does", async () => {
    for (const u of [U.admin, U.lead, U.dep]) {
      await svc(u, (tx, p) => setClientReviewRule(tx, p, ACME, "high_priority"));
      expect(await svc(U.cons, (tx, p) => getClientReviewRule(tx, p, ACME))).toMatchObject({ rule: "high_priority", canChange: false });
      expect(await svc(u, (tx, p) => getClientReviewRule(tx, p, ACME))).toMatchObject({ canChange: true, updatedBy: Object.keys(U).find((k) => U[k as keyof typeof U] === u) });
    }
    for (const u of [U.cons, U.betaLead, U.outsider]) {
      expect(await refused(svc(u, (tx, p) => setClientReviewRule(tx, p, ACME, "off")))).toMatch(/ForbiddenError/);
      expect(await refused(sql(u, `SELECT app_set_second_review_rule($1, 'off')`, [ACME]))).toMatch(/lead sets this/);
    }
    for (const u of [U.cadmin, U.cmgr]) {
      expect(await refused(svc(u, (tx, p) => setClientReviewRule(tx, p, ACME, "off")))).toMatch(/NotFoundError/);
      expect(await refused(sql(u, `SELECT app_set_second_review_rule($1, 'off')`, [ACME]))).toMatch(/lead sets this/);
    }
    const audit = await owner.query(`SELECT meta FROM audit_log WHERE action = 'organization.second_review' ORDER BY created_at`);
    expect(audit.rows[0].meta).toEqual({ from: "off", to: "high_priority" });
  });

  it("an archived client's rule stays as it was", async () => {
    await owner.query(`UPDATE organizations SET status = 'archived' WHERE id = $1`, [BETA]);
    try {
      expect(await refused(sql(U.admin, `SELECT app_set_second_review_rule($1, 'all')`, [BETA]))).toMatch(/not active/);
      expect(await svc(U.admin, (tx, p) => getClientReviewRule(tx, p, BETA))).toMatchObject({ canChange: false });
    } finally {
      await owner.query(`UPDATE organizations SET status = 'active' WHERE id = $1`, [BETA]);
    }
  });
});

describe("isolation", () => {
  it("the client sees a sign-off happened, never its rule; another client sees nothing", async () => {
    await setRule("all");
    const aid = await waiting();
    await svc(U.cons, (tx, p) => signOff(tx, p, aid));
    // Acme's manager reads the sign-off like a review, and gets no names of who could give the second.
    expect((await sql(U.cmgr, `SELECT reviewer_id FROM review_signoffs WHERE action_id = $1`, [aid])).rows).toHaveLength(1);
    expect(await svc(U.cmgr, (tx, p) => actionSecondReview(tx, p, aid))).toMatchObject({ required: true, candidates: [], can: { flag: false } });
    for (const u of [U.cmgr, U.cadmin, U.cowner]) {
      expect((await sql(u, `SELECT * FROM client_review_settings`)).rows).toEqual([]);
      expect((await sql(u, `SELECT * FROM app_second_reviewers($1)`, [aid])).rows).toEqual([]);
    }
    // Beta's people, and a consultant not on Acme, read none of it.
    for (const u of [U.betaMgr, U.outsider, U.betaLead]) {
      expect((await sql(u, `SELECT * FROM review_signoffs`)).rows).toEqual([]);
      expect((await sql(u, `SELECT * FROM app_second_review_state($1)`, [aid])).rows).toEqual([]);
      expect((await sql(u, `SELECT * FROM app_second_reviewers($1)`, [aid])).rows).toEqual([]);
    }
    expect((await sql(U.betaLead, `SELECT * FROM client_review_settings`)).rows).toEqual([]);
    expect((await sql(U.lead, `SELECT rule FROM client_review_settings`)).rows).toEqual([{ rule: "all" }]);
  });

  it("the review queue lists the wait, the stage, and whether the caller can act", async () => {
    await setRule("all");
    const aid = await waiting();
    await owner.query(`UPDATE actions SET awaiting_review_at = now() - interval '3 days' WHERE id = $1`, [aid]);
    await svc(U.cons, (tx, p) => signOff(tx, p, aid));
    const mine = (await svc(U.cons, (tx, p) => reviewQueue(tx, p))).find((r) => r.id === aid);
    expect(mine).toMatchObject({ required: true, signedBy: "cons", signedByMe: true, canAct: false, waitingDays: 3 });
    const theirs = (await svc(U.cons2, (tx, p) => reviewQueue(tx, p))).find((r) => r.id === aid);
    expect(theirs).toMatchObject({ signedByMe: false, canAct: true });
    expect(await svc(U.outsider, (tx, p) => reviewQueue(tx, p))).toEqual([]);
    expect(await svc(U.cmgr, (tx, p) => reviewQueue(tx, p))).toEqual([]);
  });
});
