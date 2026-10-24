// The client's formal response to each recommendation (F10, 2026-10-24):
// agree, partly agree or disagree with the reason, the management response
// (what will be done, by whom, by when), and the disputed state. Responses are
// the client's record; the firm confirms what it recorded and answers once.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { STANCE_NEEDS, STANCES } from "@/lib/responses";
import { releaseRecord, withdrawRecord } from "@/services/plan-changes";
import { loadPrincipal } from "@/services/principal";
import { getProject } from "@/services/queries";
import { listNotifications } from "@/services/notifications";
import { projectDeviations } from "@/services/insight";
import { confirmResponse, getRecommendation, recordResponse, replyToResponse } from "@/services/responses";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c170-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2); // full engagement
const BETA = id(3); // restricted
const GAMMA = id(4); // consultant-managed: no client accounts
const U = {
  admin: id(11),
  lead: id(12),
  colleague: id(13),
  other: id(14),
  cadmin: id(15),
  sponsor: id(16),
  manager: id(17),
  cowner: id(18),
  betaAdmin: id(19),
  betaAdmin2: id(20),
};
const P = { acme: id(21), beta: id(22), gamma: id(23) };
const R = { acme: id(31), secret: id(32), beta: id(33), gamma: id(34), other: id(35) };

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
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(userId, async (c) => {
    const tx = drizzle(c, { schema }) as unknown as Tx;
    return fn(tx, (await loadPrincipal(tx, userId))!);
  });
/** The database's own words when a service call is refused by a rule (drizzle wraps them). */
const refused = (p: Promise<unknown>) =>
  p.then(
    () => "",
    (e: Error & { cause?: Error }) => e.cause?.message ?? e.message,
  );
const notes = async (uid: string, kind: string) =>
  Number((await owner.query(`SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND kind = $2`, [uid, kind])).rows[0].n);
const stanceOf = async (uid: string, pid: string, rid: string) =>
  (await svc(uid, (tx, p) => getProject(tx, p, pid))).recommendations.find((r) => r.id === rid)?.stance;
const agree = { stance: "agree" as const, plannedAction: "The board adopts a charter", targetDate: "2026-12-31", actionOwner: "Board secretary" };

async function seed() {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode) VALUES
      ($1,'firm','firm',NULL), ($2,'client','Acme','full'), ($3,'client','Beta','restricted'), ($4,'client','Gamma','consultant_managed')`,
    [FIRM, ACME, BETA, GAMMA],
  );
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$11,'firm_admin'), ($2,$11,'consultant'), ($3,$11,'consultant'), ($4,$11,'consultant'),
      ($5,$12,'client_admin'), ($6,$12,'client_manager'), ($7,$12,'client_manager'), ($8,$12,'action_owner'),
      ($9,$13,'client_admin'), ($10,$13,'client_admin')`,
    [U.admin, U.lead, U.colleague, U.other, U.cadmin, U.sponsor, U.manager, U.cowner, U.betaAdmin, U.betaAdmin2, FIRM, ACME, BETA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$4,$7,'Acme governance','active',$8), ($2,'client',$5,$7,'Beta strategy','active',$8), ($3,'client',$6,$7,'Gamma family charter','active',$8)`,
    [P.acme, P.beta, P.gamma, ACME, BETA, GAMMA, FIRM, U.admin],
  );
  // "other" works for Beta only, so Acme's and Gamma's records are out of reach.
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$4,true), ($2,$5,true), ($3,$4,true), ($3,$6,false)`,
    [ACME, BETA, GAMMA, U.lead, U.other, U.colleague],
  );
  await q(
    `INSERT INTO project_members (project_id, user_id) VALUES ($1,$4), ($1,$5), ($1,$6), ($1,$7), ($2,$8), ($2,$9), ($3,$4), ($3,$10)`,
    [P.acme, P.beta, P.gamma, U.lead, U.sponsor, U.manager, U.cowner, U.other, U.betaAdmin2, U.colleague],
  );
  await q(`INSERT INTO project_client_roles (project_id, org_id, role, user_id) VALUES ($1,$2,'sponsor',$3)`, [P.acme, ACME, U.sponsor]);
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES
      ($1,$6,$9,'Adopt a board charter','shared',$12),
      ($2,$6,$9,'Replace the CFO','firm_private',$12),
      ($3,$7,$10,'Write a five-year plan','shared',$13),
      ($4,$8,$11,'Write the family charter','shared',$12),
      ($5,$6,$9,'Publish minutes','shared',$12)`,
    [R.acme, R.secret, R.beta, R.gamma, R.other, P.acme, P.beta, P.gamma, ACME, BETA, GAMMA, U.lead, U.other],
  );
}

beforeEach(seed);
afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("who responds", () => {
  it("is the client's admin or the sponsor in a full engagement; nobody else", async () => {
    await svc(U.cadmin, (tx, p) => recordResponse(tx, p, R.acme, agree));
    await svc(U.sponsor, (tx, p) => recordResponse(tx, p, R.other, { stance: "disagree", reason: "Minutes stay internal" }));
    // A manager who isn't the sponsor, an action owner, and the firm (the client has accounts) are refused.
    await expect(svc(U.manager, (tx, p) => recordResponse(tx, p, R.acme, agree))).rejects.toThrow(/can't take a response/);
    await expect(svc(U.cowner, (tx, p) => recordResponse(tx, p, R.acme, agree))).rejects.toThrow(/forbidden|not found/i);
    await expect(svc(U.lead, (tx, p) => recordResponse(tx, p, R.acme, { ...agree, receivedVia: "meeting", receivedOn: "2026-10-01" }))).rejects.toThrow(
      /can't take a response/,
    );
    // Past the service, row-level security refuses the same people.
    const insert = `INSERT INTO recommendation_responses (project_id, org_id, recommendation_id, stance, reason, recorded_by) VALUES ($1,$2,$3,'disagree','no',$4)`;
    await expect(sql(U.manager, insert, [P.acme, ACME, R.acme, U.manager])).rejects.toThrow(/row-level security/);
    await expect(sql(U.cadmin, insert, [P.acme, ACME, R.acme, U.sponsor])).rejects.toThrow(/row-level security/);
  });

  it("is the client's admins in a restricted engagement (it has no other accounts)", async () => {
    await svc(U.betaAdmin2, (tx, p) => recordResponse(tx, p, R.beta, { stance: "disagree", reason: "Not this year" }));
    await svc(U.betaAdmin, (tx, p) => recordResponse(tx, p, R.beta, agree));
    expect(await stanceOf(U.other, P.beta, R.beta)).toBe("agree");
  });

  it("never reaches across clients, or a firm-only, withdrawn or closed recommendation", async () => {
    // Another client's admin and another client's consultant can't find it.
    await expect(svc(U.betaAdmin, (tx, p) => recordResponse(tx, p, R.acme, agree))).rejects.toThrow(/not found/i);
    await expect(svc(U.other, (tx, p) => getRecommendation(tx, p, R.gamma))).rejects.toThrow(/not found/i);
    await expect(sql(U.betaAdmin, `SELECT * FROM recommendation_responses`)).resolves.toMatchObject({ rowCount: 0 });
    // The client can't see a firm-only recommendation; the firm can't respond to one.
    await expect(svc(U.cadmin, (tx, p) => recordResponse(tx, p, R.secret, agree))).rejects.toThrow(/not found/i);
    // Withdrawn: no more responses.
    await svc(U.lead, (tx, p) => withdrawRecord(tx, p, "recommendation", R.other, { reason: "Board dropped it" }));
    await expect(svc(U.cadmin, (tx, p) => recordResponse(tx, p, R.other, agree))).rejects.toThrow(/can't take a response/);
    // Closed project: frozen like the rest of its record.
    await svc(U.cadmin, (tx, p) => recordResponse(tx, p, R.acme, agree));
    await owner.query(`ALTER TABLE projects DISABLE TRIGGER USER`);
    await owner.query(`UPDATE projects SET state = 'closed' WHERE id = $1`, [P.acme]);
    await owner.query(`ALTER TABLE projects ENABLE TRIGGER USER`);
    await expect(svc(U.cadmin, (tx, p) => recordResponse(tx, p, R.acme, agree))).rejects.toThrow(/can't take a response/);
    const [resp] = (await owner.query(`SELECT id FROM recommendation_responses WHERE recommendation_id = $1`, [R.acme])).rows;
    expect(await refused(svc(U.lead, (tx, p) => replyToResponse(tx, p, resp.id, { reply: "Noted" })))).toMatch(/closed/);
  });
});

describe("what a response says", () => {
  it("agreeing gives the plan and its date; partly agreeing or disagreeing gives the reason", async () => {
    await expect(svc(U.cadmin, (tx, p) => recordResponse(tx, p, R.acme, { stance: "agree", plannedAction: "Do it" }))).rejects.toThrow(/planned action/);
    await expect(svc(U.cadmin, (tx, p) => recordResponse(tx, p, R.acme, { ...agree, stance: "partly_agree" }))).rejects.toThrow(/reason/);
    await expect(svc(U.cadmin, (tx, p) => recordResponse(tx, p, R.acme, { stance: "disagree", reason: "  " }))).rejects.toThrow(/reason/);
    // A disagreement keeps no plan, even if one is sent.
    await svc(U.cadmin, (tx, p) => recordResponse(tx, p, R.acme, { stance: "disagree", reason: "Too costly", plannedAction: "x", targetDate: "2026-12-01" }));
    const row = (await owner.query(`SELECT * FROM recommendation_responses WHERE recommendation_id = $1`, [R.acme])).rows[0];
    expect(row).toMatchObject({ stance: "disagree", planned_action: null, target_date: null, source: "client_portal", recorded_by: U.cadmin });
  });

  it("STANCE_NEEDS is check_recommendation_response()", async () => {
    expect([...schema.responseStance.enumValues]).toEqual([...STANCES]);
    for (const stance of STANCES) {
      for (const plan of [false, true]) {
        for (const reason of [false, true]) {
          const c = await app.connect();
          try {
            await c.query("BEGIN");
            await c.query("SELECT set_config('selah.user_id', $1, true)", [U.cadmin]);
            const ok = await c
              .query(
                `INSERT INTO recommendation_responses (project_id, org_id, recommendation_id, stance, reason, planned_action, target_date, recorded_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [P.acme, ACME, R.acme, stance, reason ? "why" : null, plan ? "what" : null, plan ? "2026-12-31" : null, U.cadmin],
              )
              .then(() => true)
              .catch(() => false);
            const needs = STANCE_NEEDS[stance];
            expect(ok, `${stance} plan=${plan} reason=${reason}`).toBe((!needs.plan || plan) && (!needs.reason || reason));
          } finally {
            await c.query("ROLLBACK");
            c.release();
          }
        }
      }
    }
  });

  it("is never edited or deleted; the latest response is where it stands", async () => {
    const first = await svc(U.cadmin, (tx, p) => recordResponse(tx, p, R.acme, { stance: "disagree", reason: "Not now" }));
    expect(await stanceOf(U.lead, P.acme, R.acme)).toBe("disagree");
    // The client can't change it (the firm's update policy), the firm can't rewrite it, nobody deletes it.
    expect((await sql(U.cadmin, `UPDATE recommendation_responses SET reason = 'x' WHERE id = $1`, [first.id])).rowCount).toBe(0);
    await expect(sql(U.lead, `UPDATE recommendation_responses SET reason = 'x' WHERE id = $1`, [first.id])).rejects.toThrow(/not edited/);
    await expect(sql(U.lead, `DELETE FROM recommendation_responses WHERE id = $1`, [first.id])).rejects.toThrow(/permission denied/);
    // A new response supersedes it; both stay on record.
    await svc(U.sponsor, (tx, p) => recordResponse(tx, p, R.acme, agree));
    expect(await stanceOf(U.cadmin, P.acme, R.acme)).toBe("agree");
    const view = await svc(U.cadmin, (tx, p) => getRecommendation(tx, p, R.acme));
    expect(view.responses.map((r) => r.stance)).toEqual(["agree", "disagree"]);
    expect(view.stance?.responseId).toBe(view.responses[0]!.id);
  });
});

describe("the disputed state", () => {
  it("a disagreement shows on the firm's deviations until the client agrees", async () => {
    expect(await stanceOf(U.cadmin, P.acme, R.acme)).toBe("awaiting");
    expect(await stanceOf(U.lead, P.acme, R.secret)).toBeNull(); // firm-only: nothing to answer yet
    await svc(U.cadmin, (tx, p) => recordResponse(tx, p, R.acme, { stance: "disagree", reason: "Too costly" }));
    const disputed = (await svc(U.lead, (tx, p) => projectDeviations(tx, p, P.acme))).filter((d) => d.rule === "disputed");
    expect(disputed).toMatchObject([{ entityType: "recommendation", entityId: R.acme, title: "Adopt a board charter" }]);
    // The deviation rules are the firm's.
    await expect(svc(U.cadmin, (tx, p) => projectDeviations(tx, p, P.acme))).rejects.toThrow(/forbidden/);
    await svc(U.cadmin, (tx, p) => recordResponse(tx, p, R.acme, { ...agree, stance: "partly_agree", reason: "Not the budget part" }));
    expect((await svc(U.lead, (tx, p) => projectDeviations(tx, p, P.acme))).some((d) => d.rule === "disputed")).toBe(false);
  });
});

describe("the firm's side", () => {
  it("answers a response once, and the one who gave it is told", async () => {
    const r = await svc(U.sponsor, (tx, p) => recordResponse(tx, p, R.acme, { stance: "disagree", reason: "Too costly" }));
    // The firm's team on the project hears of the response.
    expect(await notes(U.lead, "recommendation.responded")).toBe(1);
    expect(await notes(U.sponsor, "recommendation.responded")).toBe(0);
    await expect(svc(U.cadmin, (tx, p) => replyToResponse(tx, p, r.id, { reply: "Hm" }))).rejects.toThrow(/forbidden/);
    await svc(U.lead, (tx, p) => replyToResponse(tx, p, r.id, { reply: "We'll phase it over two years" }));
    expect(await notes(U.sponsor, "recommendation.answered")).toBe(1);
    expect(await refused(svc(U.lead, (tx, p) => replyToResponse(tx, p, r.id, { reply: "Again" })))).toMatch(/already answered/);
    // At the table: the answer is stamped with who and when, and can't be someone else's.
    const row = (await owner.query(`SELECT * FROM recommendation_responses WHERE id = $1`, [r.id])).rows[0];
    expect(row).toMatchObject({ firm_reply: "We'll phase it over two years", replied_by: U.lead });
    const r2 = await svc(U.cadmin, (tx, p) => recordResponse(tx, p, R.other, agree));
    await expect(sql(U.lead, `UPDATE recommendation_responses SET firm_reply = 'x', replied_by = $2 WHERE id = $1`, [r2.id, U.admin])).rejects.toThrow(
      /recorded by the one answering/,
    );
    // The client reads the answer; the notification leads to the recommendation.
    const seen = await svc(U.sponsor, (tx, p) => getRecommendation(tx, p, R.acme));
    expect(seen.responses[0]).toMatchObject({ firmReply: "We'll phase it over two years", repliedByName: "lead", can: { reply: false, confirm: false } });
    const { items } = await svc(U.sponsor, (tx, p) => listNotifications(tx, p));
    expect(items.find((n) => n.kind === "recommendation.answered")).toMatchObject({ href: `/recommendations/${R.acme}`, title: "Adopt a board charter" });
  });

  it("releasing a recommendation tells who answers for the client", async () => {
    await svc(U.lead, (tx, p) => releaseRecord(tx, p, "recommendation", R.secret));
    expect(await notes(U.cadmin, "recommendation.released")).toBe(1);
    expect(await notes(U.sponsor, "recommendation.released")).toBe(1);
    expect(await notes(U.manager, "recommendation.released")).toBe(0);
    expect(await notes(U.cowner, "recommendation.released")).toBe(0);
    // Nobody fakes the notice: the client can't send it, and it must match the recommendation.
    await expect(sql(U.cadmin, `SELECT app_notify_recommendation($1, 'recommendation.released')`, [R.secret])).rejects.toThrow(/does not match/);
    await expect(sql(U.lead, `SELECT app_notify_recommendation($1, 'recommendation.answered')`, [R.acme])).resolves.toMatchObject({
      rows: [{ app_notify_recommendation: 0 }],
    });
    await expect(sql(U.other, `SELECT app_notify_recommendation($1, 'recommendation.released')`, [R.acme])).rejects.toThrow(/not visible/);
  });
});

describe("consultant-managed clients", () => {
  it("the firm records what the client said, and a colleague confirms it before it counts", async () => {
    await expect(svc(U.lead, (tx, p) => recordResponse(tx, p, R.gamma, agree))).rejects.toThrow(/how and when/);
    const r = await svc(U.lead, (tx, p) => recordResponse(tx, p, R.gamma, { ...agree, receivedVia: "meeting", receivedOn: "2026-10-20" }));
    const row = (await owner.query(`SELECT * FROM recommendation_responses WHERE id = $1`, [r.id])).rows[0];
    expect(row).toMatchObject({ source: "consultant_recorded", received_via: "meeting", confirmed_by: null });
    expect(await stanceOf(U.lead, P.gamma, R.gamma)).toBe("unconfirmed");
    // Not by the one who recorded it.
    const mine = await svc(U.lead, (tx, p) => getRecommendation(tx, p, R.gamma));
    expect(mine.responses[0]!.can.confirm).toBe(false);
    expect(await refused(svc(U.lead, (tx, p) => confirmResponse(tx, p, r.id)))).toMatch(/other than the one/);
    expect((await svc(U.colleague, (tx, p) => getRecommendation(tx, p, R.gamma))).responses[0]!.can.confirm).toBe(true);
    await svc(U.colleague, (tx, p) => confirmResponse(tx, p, r.id));
    expect(await stanceOf(U.lead, P.gamma, R.gamma)).toBe("agree");
    expect(await refused(svc(U.admin, (tx, p) => confirmResponse(tx, p, r.id)))).toMatch(/already confirmed/);
    // A future date is refused at the table.
    expect(
      await refused(svc(U.lead, (tx, p) => recordResponse(tx, p, R.gamma, { stance: "disagree", reason: "No", receivedVia: "phone", receivedOn: "2999-01-01" }))),
    ).toMatch(/future/);
  });

  it("only a response the firm recorded is confirmed", async () => {
    const r = await svc(U.cadmin, (tx, p) => recordResponse(tx, p, R.acme, agree));
    expect(await refused(svc(U.lead, (tx, p) => confirmResponse(tx, p, r.id)))).toMatch(/only a response the firm recorded/);
  });
});

describe("minimal records", () => {
  it("the purge blanks a response's written text", async () => {
    const r = await svc(U.lead, (tx, p) => recordResponse(tx, p, R.gamma, { ...agree, stance: "partly_agree", reason: "Only the core", receivedVia: "email", receivedOn: "2026-10-20" }));
    await svc(U.colleague, (tx, p) => replyToResponse(tx, p, r.id, { reply: "Fine" }));
    await owner.query(`UPDATE organizations SET minimal_records = true, display_alias = 'Client G' WHERE id = $1`, [GAMMA]);
    await owner.query(`ALTER TABLE projects DISABLE TRIGGER USER`);
    await owner.query(`UPDATE projects SET handover_on = current_date - 400 WHERE id = $1`, [P.gamma]);
    await owner.query(`ALTER TABLE projects ENABLE TRIGGER USER`);
    await owner.query(`SELECT app_purge_minimal_records(current_date)`);
    const row = (await owner.query(`SELECT * FROM recommendation_responses WHERE id = $1`, [r.id])).rows[0];
    expect(row).toMatchObject({ reason: "—", planned_action: "—", firm_reply: "—", stance: "partly_agree" });
  });
});
