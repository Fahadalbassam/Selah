// The two-way thread on each action (F11, 2026-10-24): whoever can see the
// action reads and writes it, mentions reach only people who can see it, the
// people in the thread hear about new comments, and the author may remove
// their own comment (the text goes, a marker stays).
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { loadPrincipal } from "@/services/principal";
import { actionThread, postComment, removeComment } from "@/services/comments";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c180-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = {
  admin: id(11),
  lead: id(12),
  obs: id(13), // observes Acme's project
  other: id(14), // works for Beta only
  cadmin: id(15),
  hr: id(16), // client manager on the project, in HR
  manager: id(17), // client manager on the project, not in HR
  cowner: id(18), // owns the action
  cowner2: id(19), // an action owner who doesn't own it
  betaAdmin: id(20),
};
const P = { acme: id(21), beta: id(22) };
const R = { acme: id(31), secret: id(32), beta: id(33) };
const A = { open: id(41), secret: id(42), hr: id(43), beta: id(44) };
const HR = id(51);

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
const notes = async (uid: string, kind: string) =>
  Number((await owner.query(`SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND kind = $2`, [uid, kind])).rows[0].n);
const post = (uid: string, aid: string, body: string, mentions: string[] = []) => svc(uid, (tx, p) => postComment(tx, p, aid, { body, mentions }));
const people = async (uid: string, aid: string) => (await svc(uid, (tx, p) => actionThread(tx, p, aid))).people.map((x) => x.id).sort();

async function seed() {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode, departments_enabled) VALUES
      ($1,'firm','firm',NULL,false), ($2,'client','Acme','full',true), ($3,'client','Beta','full',false)`,
    [FIRM, ACME, BETA],
  );
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$11,'firm_admin'), ($2,$11,'consultant'), ($3,$11,'consultant'), ($4,$11,'consultant'),
      ($5,$12,'client_admin'), ($6,$12,'client_manager'), ($7,$12,'client_manager'), ($8,$12,'action_owner'), ($9,$12,'action_owner'),
      ($10,$13,'client_admin')`,
    [U.admin, U.lead, U.obs, U.other, U.cadmin, U.hr, U.manager, U.cowner, U.cowner2, U.betaAdmin, FIRM, ACME, BETA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$3,$5,'Acme governance','active',$6), ($2,'client',$4,$5,'Beta strategy','active',$6)`,
    [P.acme, P.beta, ACME, BETA, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$3,true), ($2,$4,true)`, [ACME, BETA, U.lead, U.other]);
  await q(
    `INSERT INTO project_members (project_id, user_id, observer) VALUES
      ($1,$3,false), ($1,$4,true), ($1,$5,false), ($1,$6,false), ($1,$7,false), ($1,$8,false), ($2,$9,false)`,
    [P.acme, P.beta, U.lead, U.obs, U.hr, U.manager, U.cowner, U.cowner2, U.other],
  );
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$2,'الموارد البشرية','HR')`, [HR, ACME]);
  await q(`INSERT INTO department_members (department_id, user_id) VALUES ($1,$2)`, [HR, U.hr]);
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES
      ($1,$4,$6,'Adopt a board charter','shared',$8), ($2,$4,$6,'Replace the CFO','firm_private',$8), ($3,$5,$7,'Write a plan','shared',$9)`,
    [R.acme, R.secret, R.beta, P.acme, P.beta, ACME, BETA, U.lead, U.other],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, created_by, department_id) VALUES
      ($1,$5,$7,$9,'Sign the charter',$12,'in_progress',$14,NULL),
      ($2,$5,$7,$10,'Find candidates',NULL,'draft',$14,NULL),
      ($3,$5,$7,$9,'Train HR',NULL,'assigned',$14,$15),
      ($4,$6,$8,$11,'Draft the plan',NULL,'assigned',$13,NULL)`,
    [A.open, A.secret, A.hr, A.beta, P.acme, P.beta, ACME, BETA, R.acme, R.secret, R.beta, U.cowner, U.other, U.lead, HR],
  );
}

beforeEach(seed);
afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("the thread", () => {
  it("is read and written by both sides, oldest first, and tells the people in it", async () => {
    await post(U.lead, A.open, "Please send the signed charter by Thursday.");
    await post(U.cowner, A.open, "  The board meets Wednesday; I'll send it after.  ");
    const thread = await svc(U.manager, (tx, p) => actionThread(tx, p, A.open));
    expect(thread.comments.map((c) => [c.authorName, c.body])).toEqual([
      ["lead", "Please send the signed charter by Thursday."],
      ["cowner", "The board meets Wednesday; I'll send it after."],
    ]);
    expect(thread.can.write).toBe(true);
    // The firm's comment reached the owner; the client's reply reached the firm's team and the earlier writer.
    expect(await notes(U.cowner, "action.commented")).toBe(1);
    expect(await notes(U.lead, "action.commented")).toBe(1);
    // Someone who isn't in the thread, and isn't the firm's team, isn't told.
    expect(await notes(U.manager, "action.commented")).toBe(0);
    // The observer reads it but isn't told (their work notifications skip them).
    expect((await svc(U.obs, (tx, p) => actionThread(tx, p, A.open))).comments).toHaveLength(2);
    expect(await notes(U.obs, "action.commented")).toBe(0);
  });

  it("mentions reach only people who can see the action", async () => {
    // On the open action: both firm staff on it, the client's admin and managers on the project, and its owner.
    expect(await people(U.lead, A.open)).toEqual([U.admin, U.obs, U.cadmin, U.hr, U.manager, U.cowner].sort());
    await post(U.lead, A.open, "Can you check this?", [U.manager]);
    expect(await notes(U.manager, "action.mentioned")).toBe(1);
    expect(await notes(U.manager, "action.commented")).toBe(0);
    // An action owner who doesn't own it, another client's admin, and a consultant off the client are refused.
    for (const who of [U.cowner2, U.betaAdmin, U.other]) {
      expect(await refused(post(U.lead, A.open, "hi", [who]))).toMatch(/mentions only other people who can see/);
    }
    // Past the service, the database refuses the same mentions, and the author mentioning themselves.
    const insert = `INSERT INTO action_comments (project_id, org_id, action_id, author_id, body, mentions) VALUES ($1,$2,$3,$4,'hi',$5)`;
    for (const who of [U.cowner2, U.betaAdmin, U.lead]) {
      await expect(sql(U.lead, insert, [P.acme, ACME, A.open, U.lead, [who]])).rejects.toThrow(/mentions only other people/);
    }
  });

  it("keeps a firm-only action's thread from the client", async () => {
    await post(U.lead, A.secret, "Shortlist ready.");
    expect(await people(U.lead, A.secret)).toEqual([U.admin, U.obs].sort());
    await expect(svc(U.cadmin, (tx, p) => actionThread(tx, p, A.secret))).rejects.toThrow(/not found|forbidden/i);
    expect((await sql(U.cadmin, `SELECT id FROM action_comments WHERE action_id = $1`, [A.secret])).rowCount).toBe(0);
    expect(await refused(post(U.lead, A.secret, "hi", [U.cadmin]))).toMatch(/mentions only/);
    const insert = `INSERT INTO action_comments (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'hi')`;
    await expect(sql(U.cadmin, insert, [P.acme, ACME, A.secret, U.cadmin])).rejects.toThrow(/row-level security/);
  });

  it("follows departments: only the department, the admin and the firm see a department's action", async () => {
    await post(U.hr, A.hr, "Training is booked.");
    expect((await sql(U.manager, `SELECT id FROM action_comments WHERE action_id = $1`, [A.hr])).rowCount).toBe(0);
    expect((await sql(U.cadmin, `SELECT id FROM action_comments WHERE action_id = $1`, [A.hr])).rowCount).toBe(1);
    // The department check no longer lets an unowned action through (it did before this migration).
    expect((await sql(U.manager, `SELECT app_can_see_action($1) AS ok`, [A.hr])).rows[0].ok).toBe(false);
    expect(await people(U.lead, A.hr)).toEqual([U.admin, U.obs, U.cadmin, U.hr].sort());
    expect(await notes(U.lead, "action.commented")).toBe(1);
  });

  it("never reaches across clients", async () => {
    await post(U.lead, A.open, "Acme only.");
    await expect(svc(U.other, (tx, p) => actionThread(tx, p, A.open))).rejects.toThrow(/not found|forbidden/i);
    expect((await sql(U.other, `SELECT id FROM action_comments`)).rowCount).toBe(0);
    expect((await sql(U.betaAdmin, `SELECT id FROM action_comments`)).rowCount).toBe(0);
    // A comment can't be filed against another project's action.
    const insert = `INSERT INTO action_comments (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'hi')`;
    await expect(sql(U.other, insert, [P.beta, BETA, A.open, U.other])).rejects.toThrow(/row-level security/);
    // Nor written in someone else's name.
    await expect(sql(U.lead, insert, [P.acme, ACME, A.open, U.cowner])).rejects.toThrow(/row-level security/);
  });
});

describe("removing a comment", () => {
  it("is its author's alone, once; the text goes and a marker stays", async () => {
    const { id: cid } = await post(U.cowner, A.open, "Wrong file, sorry.");
    await expect(svc(U.lead, (tx, p) => removeComment(tx, p, cid))).rejects.toThrow(/not found/i);
    expect((await sql(U.lead, `UPDATE action_comments SET removed_at = now() WHERE id = $1`, [cid])).rowCount).toBe(0);
    await svc(U.cowner, (tx, p) => removeComment(tx, p, cid));
    const [c] = (await svc(U.lead, (tx, p) => actionThread(tx, p, A.open))).comments;
    expect(c!.body).toBe("");
    expect(c!.removedAt).not.toBeNull();
    await expect(svc(U.cowner, (tx, p) => removeComment(tx, p, cid))).rejects.toThrow(/already removed/);
    expect(await refused(sql(U.cowner, `UPDATE action_comments SET body = 'edited' WHERE id = $1`, [cid]))).toMatch(/already removed/);
    expect((await owner.query(`SELECT count(*) AS n FROM audit_log WHERE action = 'action_comment.remove'`)).rows[0].n).toBe("1");
  });

  it("changes nothing but removal, and nothing is deleted", async () => {
    const { id: cid } = await post(U.cowner, A.open, "First draft.");
    expect(await refused(sql(U.cowner, `UPDATE action_comments SET body = 'Second draft' WHERE id = $1`, [cid]))).toMatch(/only its author removes/);
    await expect(owner.query(`DELETE FROM action_comments WHERE id = $1`, [cid])).rejects.toThrow(/comments are kept/);
  });
});

describe("limits", () => {
  it("an observer reads but doesn't write; a closed project takes no comments", async () => {
    await expect(post(U.obs, A.open, "Looks good.")).rejects.toThrow(/forbidden|observer/i);
    const insert = `INSERT INTO action_comments (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'hi')`;
    expect(await refused(sql(U.obs, insert, [P.acme, ACME, A.open, U.obs]))).toMatch(/observ/);
    await owner.query(`UPDATE projects SET state = 'closed' WHERE id = $1`, [P.acme]);
    expect(await refused(post(U.lead, A.open, "One more thing."))).toMatch(/forbidden/);
    expect(await refused(sql(U.lead, insert, [P.acme, ACME, A.open, U.lead]))).toMatch(/closed/);
  });

  it("refuses an empty comment", async () => {
    const insert = `INSERT INTO action_comments (project_id, org_id, action_id, author_id, body) VALUES ($1,$2,$3,$4,'   ')`;
    await expect(sql(U.lead, insert, [P.acme, ACME, A.open, U.lead])).rejects.toThrow(/needs text/);
  });

  it("mails the people it reached, by their mail choices", async () => {
    await post(U.lead, A.open, "Can you check the minutes?", [U.manager]);
    const mails = await owner.query(`SELECT to_email, kind, link FROM outbound_emails WHERE kind LIKE 'action.%' ORDER BY to_email`);
    expect(mails.rows).toEqual([
      { to_email: "cowner@example.test", kind: "action.commented", link: `/actions/${A.open}` },
      { to_email: "manager@example.test", kind: "action.mentioned", link: `/actions/${A.open}` },
    ]);
  });
});
