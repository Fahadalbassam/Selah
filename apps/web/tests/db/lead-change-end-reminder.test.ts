// Two everyday gaps closed at Gate B (assessment area 6, migration 0109).
//
// 6.2 A change of a client's lead consultant tells the client's admins who
// their new lead is and the person who led before that the client was handed
// over, in-app and by mail by each person's choice. The handover note the
// admin may write is read by the firm's people on that client (new lead, old
// lead, deputy, firm admin) and never by the client or another firm.
//
// 6.1 The daily job tells the client's lead, deputy and the firm admins once
// when an open engagement is 30 days or less from its end date, and once more
// after the date if it is still open. Never anyone at the client.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { runFollowUps } from "@/jobs/follow-ups";
import { ENGAGEMENT_END_REMINDER_DAYS as DAYS } from "@/lib/engagements";
import { listNotifications } from "@/services/notifications";
import { loadPrincipal } from "@/services/principal";
import { getClientTeam, setDeputy, setLead } from "@/services/staffing";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c1d6-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const FIRM2 = id(4);
const U = {
  admin: id(11),
  oldLead: id(12),
  newLead: id(13),
  dep: id(14),
  other: id(15),
  betaLead: id(16),
  cadmin: id(17),
  cmanager: id(18),
  betaAdmin: id(19),
  admin2: id(20),
  cons2: id(21),
};
const P = { acme: id(31), acme2: id(32) };
const G = { acme: id(41) };
const NOTE = "Promised the board a draft policy by month end; the finance head prefers calls.";

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
const refused = (p: Promise<unknown>) =>
  p.then(
    () => "",
    (e: Error & { cause?: Error }) => e.cause?.message ?? e.message,
  );
const notices = async (kind: string) =>
  (await owner.query(`SELECT user_id FROM notifications WHERE kind = $1 ORDER BY user_id`, [kind])).rows.map((r) => r.user_id);
const mails = async (kind: string) =>
  (await owner.query(`SELECT to_email, link FROM outbound_emails WHERE kind = $1 ORDER BY to_email`, [kind])).rows;
const firmToday = async () => (await owner.query(`SELECT app_firm_today()::text AS d`)).rows[0].d as string;
const plus = async (base: string, days: number) => (await owner.query(`SELECT ($1::date + $2::int)::text AS d`, [base, days])).rows[0].d as string;

async function seed() {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`TRUNCATE outbound_emails`);
  await truncateAuditLog(owner);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode) VALUES
      ($1,'firm','firm',NULL), ($2,'client','Acme','full'), ($3,'client','Beta','full'), ($4,'firm','other firm',NULL)`,
    [FIRM, ACME, BETA, FIRM2],
  );
  for (const [name, uid] of Object.entries(U))
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$11,'firm_admin'), ($2,$11,'consultant'), ($3,$11,'consultant'), ($4,$11,'consultant'), ($5,$11,'consultant'),
      ($6,$11,'consultant'), ($7,$12,'client_admin'), ($8,$12,'client_manager'), ($9,$13,'client_admin'), ($10,$14,'firm_admin'), ($15,$14,'consultant')`,
    [U.admin, U.oldLead, U.newLead, U.dep, U.other, U.betaLead, U.cadmin, U.cmanager, U.betaAdmin, U.admin2, FIRM, ACME, BETA, FIRM2, U.cons2],
  );
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES
      ($1,$3,true,false), ($1,$4,false,true), ($1,$5,false,false), ($1,$6,false,false), ($2,$7,true,false)`,
    [ACME, BETA, U.oldLead, U.dep, U.other, U.newLead, U.betaLead],
  );
}

beforeEach(seed);
afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("a change of lead consultant", () => {
  it("tells the client's admins who the new lead is, and the old lead that the client was handed over", async () => {
    await svc(U.admin, (tx, p) => setLead(tx, p, ACME, U.newLead, NOTE));

    expect(await notices("client.lead_changed")).toEqual([U.cadmin]);
    expect(await notices("client.handed_over")).toEqual([U.oldLead]);
    expect(await notices("client.lead")).toEqual([U.newLead]);
    // Mail right away by their (default) choice: a line and a link, no name, no note.
    expect(await mails("client.lead_changed")).toEqual([{ to_email: "cadmin@example.test", link: "/help" }]);
    expect(await mails("client.handed_over")).toEqual([{ to_email: "oldLead@example.test", link: "/notifications" }]);
    // Nobody at another client, no manager, nobody at the other firm.
    for (const u of [U.betaAdmin, U.cmanager, U.admin2, U.betaLead])
      expect((await owner.query(`SELECT 1 FROM notifications WHERE user_id = $1`, [u])).rowCount).toBe(0);

    // The client admin reads the new lead's name and opens Help.
    const forClient = await svc(U.cadmin, (tx, p) => listNotifications(tx, p));
    const line = forClient.items.find((n) => n.kind === "client.lead_changed")!;
    expect(line).toMatchObject({ name: "newLead", title: "Acme", href: "/help" });
    // The old lead reads which client and who leads it now.
    const forOld = await svc(U.oldLead, (tx, p) => listNotifications(tx, p));
    expect(forOld.items.find((n) => n.kind === "client.handed_over")).toMatchObject({ name: "newLead", title: "Acme", href: `/clients/${ACME}` });
    // The audit says who and whether a note was written, never the note.
    const log = (await owner.query(`SELECT meta FROM audit_log WHERE action = 'client_assignment.set_lead' AND resource_id = $1`, [ACME])).rows;
    expect(log.map((r) => r.meta)).toEqual([{ userId: U.newLead, from: U.oldLead, note: true }]);
    // Once off the client's team, the old lead's notice opens their home instead of a page they cannot open.
    await owner.query(`DELETE FROM client_assignments WHERE client_org_id = $1 AND user_id = $2`, [ACME, U.oldLead]);
    const offTeam = await svc(U.oldLead, (tx, p) => listNotifications(tx, p));
    expect(offTeam.items.find((n) => n.kind === "client.handed_over")).toMatchObject({ title: "Acme", href: "/" });
  });

  it("names the change only to its own audience, whatever notice rows someone writes for themselves", async () => {
    await svc(U.admin, (tx, p) => setLead(tx, p, ACME, U.newLead, NOTE));
    const [change] = (await owner.query(`SELECT id FROM client_lead_changes`)).rows;
    // Another client's admin, another firm's admin, a plain consultant on the team and a manager forge a notice for themselves.
    for (const u of [U.betaAdmin, U.admin2, U.other, U.cmanager]) {
      await sql(u, `INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1, 'client.lead_changed', 'lead_change', $2)`, [u, change.id]);
      expect((await sql(u, `SELECT * FROM app_lead_change_notices($1::uuid[])`, [[change.id]])).rows).toEqual([]);
      const mine = await svc(u, (tx, p) => listNotifications(tx, p));
      expect(mine.items.find((n) => n.entityId === change.id)).toMatchObject({ title: null, name: null, href: null });
    }
    // The real audience still reads it.
    expect((await sql(U.cadmin, `SELECT lead_name FROM app_lead_change_notices($1::uuid[])`, [[change.id]])).rows).toEqual([{ lead_name: "newLead" }]);
    expect((await sql(U.oldLead, `SELECT lead_name FROM app_lead_change_notices($1::uuid[])`, [[change.id]])).rows).toEqual([{ lead_name: "newLead" }]);
  });

  it("keeps the handover note for the firm's people on that client, never the client or another firm", async () => {
    await svc(U.admin, (tx, p) => setLead(tx, p, ACME, U.newLead, NOTE));
    const read = (u: string) => sql(u, `SELECT handover_note FROM client_lead_changes WHERE client_org_id = $1`, [ACME]).then((r) => r.rows);
    for (const u of [U.newLead, U.oldLead, U.dep, U.admin]) expect(await read(u)).toEqual([{ handover_note: NOTE }]);
    // A consultant on the team who is neither lead nor deputy, the client's people, another firm, another client's lead: nothing.
    for (const u of [U.other, U.cadmin, U.cmanager, U.betaAdmin, U.admin2, U.betaLead]) expect(await read(u)).toEqual([]);
    // The notice function answers only for one's own notices, and never with the note.
    const [change] = (await owner.query(`SELECT id FROM client_lead_changes`)).rows;
    expect((await sql(U.betaAdmin, `SELECT * FROM app_lead_change_notices($1::uuid[])`, [[change.id]])).rows).toEqual([]);
    const own = (await sql(U.cadmin, `SELECT * FROM app_lead_change_notices($1::uuid[])`, [[change.id]])).rows;
    expect(own).toHaveLength(1);
    expect(Object.values(own[0])).not.toContain(NOTE);

    // The new lead sees it on the client page; so may the deputy. A consultant who is neither does not.
    expect((await svc(U.newLead, (tx, p) => getClientTeam(tx, p, ACME))).handover).toMatchObject({ note: NOTE, author: "admin", fromName: "oldLead" });
    expect((await svc(U.dep, (tx, p) => getClientTeam(tx, p, ACME))).handover?.note).toBe(NOTE);
    expect((await svc(U.other, (tx, p) => getClientTeam(tx, p, ACME))).handover).toBeNull();
    expect((await svc(U.newLead, (tx, p) => getClientTeam(tx, p, ACME))).handover?.earlier).toBe(false);
    // The next change without a note: the old note is no longer shown as the latest.
    await svc(U.admin, (tx, p) => setLead(tx, p, ACME, U.other));
    expect((await svc(U.admin, (tx, p) => getClientTeam(tx, p, ACME))).handover).toBeNull();
    // Back to the lead it was written for (A to B, B to C, C to B): shown, and marked as from an earlier change,
    // for the admin and for the old lead, who reads only the first change.
    await svc(U.admin, (tx, p) => setLead(tx, p, ACME, U.newLead));
    for (const u of [U.admin, U.newLead, U.oldLead])
      expect((await svc(u, (tx, p) => getClientTeam(tx, p, ACME))).handover).toMatchObject({ note: NOTE, earlier: true });
  });

  it("clears the handover note with the rest when a minimal-records client is purged", async () => {
    const MIN = id(5);
    const PMIN = id(33);
    await owner.query(
      `INSERT INTO organizations (id, kind, name, engagement_mode, minimal_records, display_alias) VALUES ($1,'client','x','consultant_managed',true,'Client M')`,
      [MIN],
    );
    await owner.query(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state) VALUES ($1,'client',$2,$3,'Work','active')`, [PMIN, MIN, FIRM]);
    await owner.query(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [MIN, U.oldLead]);
    await svc(U.admin, (tx, p) => setLead(tx, p, MIN, U.newLead, NOTE));
    await owner.query(`UPDATE projects SET handover_on = app_firm_today() - 200 WHERE id = $1`, [PMIN]);
    await owner.query(`SELECT app_purge_minimal_records(app_firm_today())`);
    expect((await owner.query(`SELECT handover_note FROM client_lead_changes WHERE client_org_id = $1`, [MIN])).rows).toEqual([{ handover_note: null }]);
  });

  it("is recorded only by the firm admin of the firm that serves the client, for an active consultant of that firm", async () => {
    // Nobody writes the record directly, the admin included.
    for (const u of [U.admin, U.oldLead, U.dep, U.cadmin, U.admin2])
      expect(
        await refused(
          sql(u, `INSERT INTO client_lead_changes (client_org_id, firm_org_id, from_user_id, to_user_id, changed_by) VALUES ($1,$2,$3,$4,$5)`, [
            ACME,
            FIRM,
            U.oldLead,
            U.newLead,
            u,
          ]),
        ),
      ).toMatch(/permission denied/);
    const change = (u: string, client: string, to: string) => sql(u, `SELECT app_change_client_lead($1, $2, 'x')`, [client, to]);
    // The other firm's admin, for Acme (served by this firm): neither their own consultant nor this firm's.
    expect(await refused(change(U.admin2, ACME, U.cons2))).toMatch(/no such client/);
    expect(await refused(change(U.admin2, ACME, U.newLead))).toMatch(/no such client/);
    // Consultants, the lead and the client's admin: refused.
    for (const u of [U.oldLead, U.dep, U.cadmin]) expect(await refused(change(u, ACME, U.newLead))).toMatch(/no such client/);
    // This firm's admin, to someone of another firm or to a firm admin: refused.
    expect(await refused(change(U.admin, ACME, U.cons2))).toMatch(/active consultants/);
    expect(await refused(change(U.admin, ACME, U.admin))).toMatch(/active consultants/);
    expect((await owner.query(`SELECT count(*)::int AS n FROM client_lead_changes`)).rows[0].n).toBe(0);
    expect((await owner.query(`SELECT count(*)::int AS n FROM notifications`)).rows[0].n).toBe(0);
    // The old lead recorded is always the client's lead before the change.
    await svc(U.admin, (tx, p) => setLead(tx, p, ACME, U.newLead, NOTE));
    expect((await owner.query(`SELECT from_user_id, to_user_id, changed_by FROM client_lead_changes`)).rows).toEqual([
      { from_user_id: U.oldLead, to_user_id: U.newLead, changed_by: U.admin },
    ]);
    // Never changed or removed through the app.
    expect(await refused(sql(U.admin, `UPDATE client_lead_changes SET handover_note = 'x'`))).toMatch(/permission denied/);
    expect(await refused(sql(U.admin, `DELETE FROM client_lead_changes`))).toMatch(/permission denied/);
    // Naming the same lead again changes nothing and tells nobody.
    await svc(U.admin, (tx, p) => setLead(tx, p, ACME, U.newLead));
    expect((await owner.query(`SELECT count(*)::int AS n FROM client_lead_changes`)).rows[0].n).toBe(1);
    expect(await notices("client.lead_changed")).toEqual([U.cadmin]);
  });

  it("does not change an archived client's lead, and tells nobody about a change recorded for one", async () => {
    const today = await firmToday();
    await owner.query(`INSERT INTO engagements (firm_org_id, client_org_id, title, signed_on, scope) VALUES ($1,$2,'Beta letter',$3,'Plan')`, [FIRM, BETA, today]);
    await sql(U.admin, `SELECT app_archive_client($1, 30, NULL)`, [BETA]);
    await owner.query(`TRUNCATE notifications, outbound_emails`);
    expect(await refused(svc(U.admin, (tx, p) => setLead(tx, p, BETA, U.newLead)))).toMatch(/archived/);
    // A change recorded for it some other way (the departure handover leaves archived clients alone) tells nobody.
    await owner.query(`INSERT INTO client_lead_changes (client_org_id, firm_org_id, from_user_id, to_user_id) VALUES ($1,$2,$3,$4)`, [
      BETA,
      FIRM,
      U.betaLead,
      U.newLead,
    ]);
    for (const k of ["client.lead_changed", "client.handed_over", "client.lead"]) expect(await notices(k)).toEqual([]);
  });

  it("follows each reader's mail choice: a summary, or no mail", async () => {
    await owner.query(`INSERT INTO mail_preferences (user_id, updates) VALUES ($1,'daily'), ($2,'off')`, [U.cadmin, U.oldLead]);
    await svc(U.admin, (tx, p) => setLead(tx, p, ACME, U.newLead));
    expect(await mails("client.lead_changed")).toEqual([]);
    expect(await mails("client.handed_over")).toEqual([]);
    // In-app notices arrive whatever the choice.
    expect(await notices("client.lead_changed")).toEqual([U.cadmin]);
    expect(await notices("client.handed_over")).toEqual([U.oldLead]);
    await owner.query(`SELECT app_queue_digests(app_firm_today())`);
    expect((await mails("follow_up.digest")).map((m) => m.to_email)).toEqual(["cadmin@example.test"]);
  });

  it("is recorded and told when the old lead's work is handed over on leaving, the leaver mailed once in a summary", async () => {
    // The person leaving leads two clients.
    await svc(U.admin, (tx, p) => setLead(tx, p, BETA, U.oldLead));
    await owner.query(`TRUNCATE notifications, outbound_emails, client_lead_changes`);
    await sql(U.admin, `SELECT app_hand_over($1, $2, ARRAY['client_lead'])`, [U.oldLead, U.newLead]);
    const rows = (
      await owner.query(`SELECT client_org_id, from_user_id, to_user_id, changed_by, handover_note FROM client_lead_changes ORDER BY client_org_id`)
    ).rows;
    expect(rows).toEqual([
      { client_org_id: ACME, from_user_id: U.oldLead, to_user_id: U.newLead, changed_by: U.admin, handover_note: null },
      { client_org_id: BETA, from_user_id: U.oldLead, to_user_id: U.newLead, changed_by: U.admin, handover_note: null },
    ]);
    expect(await notices("client.lead_changed")).toEqual([U.cadmin, U.betaAdmin].sort());
    expect(await notices("client.handed_over")).toEqual([U.oldLead, U.oldLead]);
    expect(await notices("client.lead")).toEqual([U.newLead, U.newLead]);
    // No mail per client to the person leaving; the client admins are mailed as usual.
    expect(await mails("client.handed_over")).toEqual([]);
    expect((await mails("client.lead_changed")).map((m) => m.to_email)).toEqual(["betaAdmin@example.test", "cadmin@example.test"]);
    await owner.query(`SELECT app_queue_digests(app_firm_today())`);
    expect((await mails("follow_up.digest")).map((m) => m.to_email)).toEqual(["oldLead@example.test"]);
  });

  it("a deputy made lead is told like any new lead, and the old lead too", async () => {
    await svc(U.admin, (tx, p) => setLead(tx, p, ACME, U.dep));
    expect(await notices("client.handed_over")).toEqual([U.oldLead]);
    await svc(U.admin, (tx, p) => setDeputy(tx, p, ACME, U.other));
    expect((await sql(U.other, `SELECT 1 FROM client_lead_changes`)).rowCount).toBe(1);
  });
});

describe("an engagement near its end", () => {
  let ends: string;
  beforeEach(async () => {
    const today = await firmToday();
    ends = await plus(today, 200);
    await owner.query(
      `INSERT INTO engagements (id, firm_org_id, client_org_id, title, signed_on, scope, ends_on) VALUES ($1,$2,$3,'Acme governance retainer',$4,'Governance',$5)`,
      [G.acme, FIRM, ACME, today, ends],
    );
    await owner.query(
      `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, engagement_id) VALUES
        ($1,'client',$3,$4,'Phase 1','closed',$5), ($2,'client',$3,$4,'Phase 2','active',$5)`,
      [P.acme, P.acme2, ACME, FIRM, G.acme],
    );
  });
  const run = async (day: string) => runFollowUps(owner, day);
  const told = async () =>
    (await owner.query(`SELECT user_id, kind FROM notifications WHERE entity_type = 'engagement' ORDER BY kind, user_id`)).rows.map((r) => [r.kind, r.user_id]);

  it("tells the lead, the deputy and the firm admin once at the threshold, again once after the end, never the client", async () => {
    expect((await owner.query(`SELECT app_engagement_reminder_days() AS n`)).rows[0].n).toBe(DAYS);
    await run(await plus(ends, -DAYS - 1));
    expect(await told()).toEqual([]);

    await run(await plus(ends, -DAYS));
    const ending = [U.admin, U.oldLead, U.dep].sort().map((u) => ["engagement.ending", u]);
    expect(await told()).toEqual(ending);
    // A second run that day, and the days after, send nothing more.
    await run(await plus(ends, -DAYS));
    await run(await plus(ends, -10));
    await run(ends);
    expect(await told()).toEqual(ending);

    await run(await plus(ends, 1));
    const ended = [U.admin, U.oldLead, U.dep].sort().map((u) => ["engagement.ended", u]);
    expect(await told()).toEqual([...ended, ...ending]);
    await run(await plus(ends, 1));
    await run(await plus(ends, 9));
    expect(await told()).toEqual([...ended, ...ending]);

    // Nobody at the client, no other consultant, no other firm.
    for (const u of [U.cadmin, U.cmanager, U.other, U.newLead, U.admin2, U.betaAdmin])
      expect((await owner.query(`SELECT 1 FROM notifications WHERE user_id = $1`, [u])).rowCount).toBe(0);

    // The lead reads the engagement's title and end date, and opens it.
    const lines = await svc(U.oldLead, (tx, p) => listNotifications(tx, p));
    expect(lines.items.find((n) => n.kind === "engagement.ending")).toMatchObject({
      title: "Acme governance retainer",
      date: ends,
      href: `/engagements/${G.acme}`,
    });
  });

  it("goes into the reminders summary by each person's choice", async () => {
    await owner.query(`INSERT INTO mail_preferences (user_id, reminders) VALUES ($1,'off')`, [U.dep]);
    await run(await plus(ends, -DAYS));
    expect((await mails("follow_up.digest")).map((m) => m.to_email)).toEqual(["admin@example.test", "oldLead@example.test"]);
  });

  it("says nothing after the end when every project is closed, and a new end date sends it again", async () => {
    await owner.query(`UPDATE projects SET state = 'closed' WHERE id = $1`, [P.acme2]);
    await run(await plus(ends, 1));
    expect(await told()).toEqual([]);

    await owner.query(`UPDATE projects SET state = 'active', closed_at = NULL WHERE id = $1`, [P.acme2]);
    await run(await plus(ends, -5));
    expect((await told()).filter(([k]) => k === "engagement.ending")).toHaveLength(3);
    const later = await plus(ends, 60);
    await owner.query(`UPDATE engagements SET ends_on = $2 WHERE id = $1`, [G.acme, later]);
    await run(await plus(later, -20));
    expect((await told()).filter(([k]) => k === "engagement.ending")).toHaveLength(6);
  });

  it("after the end, tells only within the window: one that ended long ago, with or without projects, gets nothing", async () => {
    await run(await plus(ends, DAYS + 1));
    expect(await told()).toEqual([]);
    const today = await firmToday();
    const OLD = id(42);
    await owner.query(
      `INSERT INTO engagements (id, firm_org_id, client_org_id, title, signed_on, scope, ends_on) VALUES ($1,$2,$3,'Old letter',$4,'Governance',$4::date + 1)`,
      [OLD, FIRM, ACME, today],
    );
    // No projects, ended more than the window ago: nothing.
    await run(await plus(today, DAYS + 2));
    expect(await told()).toEqual([]);
    // A day after its end, within the window: told once to the three.
    await run(await plus(today, 2));
    expect((await owner.query(`SELECT count(*)::int AS n FROM notifications WHERE entity_id = $1 AND kind = 'engagement.ended'`, [OLD])).rows[0].n).toBe(3);
  });

  it("is sent only by the job", async () => {
    expect(await refused(sql(U.admin, `SELECT app_remind_engagements(app_firm_today())`))).toMatch(/permission denied/);
    expect(await refused(sql(U.admin, `SELECT * FROM engagement_reminders`))).toMatch(/permission denied/);
  });
});
