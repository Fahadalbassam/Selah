// Mail choices that respect the Saudi week (migration 0019, wave 1 item 12):
// the sending-time rule, holding work mail, cadence per kind, muting one
// action, the summary mail, the reminder ladder on the action and the
// "delivery failed" marker, against a real Postgres.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { runFollowUps } from "@/jobs/follow-ups";
import { actionLadder, mailFailing } from "@/services/follow-through";
import * as N from "@/services/notifications";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 3 });

const id = (n: number) => `00000000-0000-4000-f900-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const PROJ = id(3);
const REC = id(4); // shared
const REC_PRIVATE = id(5); // firm-only
const U = {
  admin: id(11), // firm admin, watches Acme
  lead: id(12), // Acme's lead consultant
  cons: id(13), // consultant staffed on the project
  cadmin: id(14),
  cmgr: id(15), // client manager staffed on the project
  cowner: id(16), // action owner staffed on the project
};
let n = 100;
const next = () => id(++n);

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
const run = (userId: string, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params), true);
const attempt = (userId: string, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params));
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    true,
  );

async function action(fields: { due?: string; status?: string; rec?: string; owner?: string } = {}) {
  const aid = next();
  await owner.query(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
     VALUES ($1,$2,$3,$4,'Sign the charter',$5,$6,$7,$8)`,
    [aid, PROJ, ACME, fields.rec ?? REC, fields.owner ?? U.cowner, fields.status ?? "in_progress", fields.due ?? null, U.cons],
  );
  return aid;
}
const notify = (to: string, kind: string, aid: string) =>
  run(U.cons, `INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,$2,'action',$3)`, [to, kind, aid]);
const queued = async (kind: string) =>
  (await owner.query(`SELECT to_email, link, next_attempt_at, created_at FROM outbound_emails WHERE kind = $1 ORDER BY to_email`, [kind])).rows;
const choose = (uid: string, values: Record<string, unknown>) =>
  owner.query(
    `INSERT INTO mail_preferences (user_id, ${Object.keys(values).join(", ")}) VALUES ($1, ${Object.keys(values)
      .map((_, i) => `$${i + 2}`)
      .join(", ")})
     ON CONFLICT (user_id) DO UPDATE SET ${Object.keys(values)
       .map((k) => `${k} = EXCLUDED.${k}`)
       .join(", ")}`,
    [uid, ...Object.values(values)],
  );

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`TRUNCATE outbound_emails`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme')`, [FIRM, ACME]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$7,'firm_admin'), ($2,$7,'consultant'), ($3,$7,'consultant'),
      ($4,$8,'client_admin'), ($5,$8,'client_manager'), ($6,$8,'action_owner')`,
    [U.admin, U.lead, U.cons, U.cadmin, U.cmgr, U.cowner, FIRM, ACME],
  );
  await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state) VALUES ($1,'client',$2,$3,'Acme governance','active')`, [
    PROJ,
    ACME,
    FIRM,
  ]);
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($1,$3,false)`, [ACME, U.lead, U.cons]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4)`, [PROJ, U.cons, U.cmgr, U.cowner]);
  await q(`INSERT INTO watches (user_id, client_org_id) VALUES ($1,$2)`, [U.admin, ACME]);
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, created_by, visibility) VALUES
      ($1,$3,$4,'Charter',$5,'shared'), ($2,$3,$4,'Private',$5,'firm_private')`,
    [REC, REC_PRIVATE, PROJ, ACME, U.cons],
  );
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("when work mail may go out", () => {
  // 2026-10-21 Wednesday, 22 Thursday, 23 Friday, 24 Saturday, 25 Sunday (Riyadh, UTC+3).
  const at = async (
    when: string,
    o: { from?: string | null; to?: string | null; sat?: boolean; rStarts?: string | null; rEnds?: string | null } = {},
  ) => {
    const { rows } = await owner.query(
      `SELECT to_char(app_mail_send_time($1::timestamptz, $2::time, $3::time, $4, $5::date, $6::date, '10:00', '15:00') AT TIME ZONE 'Asia/Riyadh', 'Dy YYYY-MM-DD HH24:MI') AS t`,
      [when, o.from === undefined ? "20:00" : o.from, o.to === undefined ? "07:00" : o.to, o.sat ?? false, o.rStarts ?? null, o.rEnds ?? null],
    );
    return rows[0].t as string;
  };

  it("goes at once inside the working day and waits out quiet hours over midnight", async () => {
    expect(await at("2026-10-21 12:00+03")).toBe("Wed 2026-10-21 12:00");
    expect(await at("2026-10-21 03:00+03")).toBe("Wed 2026-10-21 07:00");
    expect(await at("2026-10-21 21:30+03")).toBe("Thu 2026-10-22 07:00");
  });

  it("never on Friday, and Saturday only for people who ask", async () => {
    expect(await at("2026-10-22 21:00+03")).toBe("Sun 2026-10-25 07:00");
    expect(await at("2026-10-22 21:00+03", { sat: true })).toBe("Sat 2026-10-24 07:00");
    expect(await at("2026-10-23 10:00+03", { from: null, to: null, sat: true })).toBe("Sat 2026-10-24 00:00");
    expect(await at("2026-10-23 10:00+03", { from: null, to: null })).toBe("Sun 2026-10-25 00:00");
  });

  it("handles quiet hours inside the day, and none at all", async () => {
    expect(await at("2026-10-21 14:00+03", { from: "13:00", to: "16:00" })).toBe("Wed 2026-10-21 16:00");
    expect(await at("2026-10-21 12:00+03", { from: "13:00", to: "16:00" })).toBe("Wed 2026-10-21 12:00");
    expect(await at("2026-10-21 23:59+03", { from: null, to: null })).toBe("Wed 2026-10-21 23:59");
  });

  it("in Ramadan sends only in the Ramadan hours, whatever the quiet hours", async () => {
    const r = { rStarts: "2026-10-01", rEnds: "2026-10-29" };
    expect(await at("2026-10-21 14:00+03", r)).toBe("Wed 2026-10-21 14:00");
    expect(await at("2026-10-21 16:00+03", r)).toBe("Thu 2026-10-22 10:00");
    expect(await at("2026-10-21 08:00+03", { ...r, from: null, to: null })).toBe("Wed 2026-10-21 10:00");
    // The day after Ramadan ends, the person's own hours apply again.
    expect(await at("2026-10-29 16:00+03", r)).toBe("Sun 2026-11-01 07:00");
  });

  it("holds work mail to a member until their sending time, and leaves account mail alone", async () => {
    await owner.query(`TRUNCATE outbound_emails`);
    await choose(U.cmgr, { quiet_from: null, quiet_to: null, saturday: true });
    await owner.query(
      `INSERT INTO outbound_emails (to_email, kind, link) VALUES
        ('cowner@example.test','follow_up.digest','/notifications'), ('CMGR@example.test','access_review.due','/team'),
        ('cowner@example.test','invitation','/invite/x'), ('stranger@example.test','action.assigned','/actions/x')`,
    );
    const rows = (
      await owner.query(
        `SELECT o.kind, o.next_attempt_at, app_mail_send_at(u.id, o.created_at) AS expected, o.created_at
         FROM outbound_emails o LEFT JOIN "user" u ON lower(u.email) = lower(o.to_email) ORDER BY o.kind`,
      )
    ).rows;
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
    const held = (r: { next_attempt_at: Date | null; expected: Date; created_at: Date }) =>
      r.expected > r.created_at ? r.next_attempt_at?.getTime() === r.expected.getTime() : r.next_attempt_at === null;
    expect(held(byKind["follow_up.digest"])).toBe(true);
    expect(held(byKind["access_review.due"])).toBe(true);
    expect(byKind["invitation"].next_attempt_at).toBeNull();
    expect(byKind["action.assigned"].next_attempt_at).toBeNull(); // no account behind the address
    await owner.query(`DELETE FROM mail_preferences`);
  });
});

describe("each person's choices", () => {
  beforeEach(() => owner.query(`DELETE FROM mail_preferences`));

  it("start from the defaults and are saved by the person alone", async () => {
    const mine = await svc(U.cowner, (tx, p) => N.getMailPreferences(tx, p));
    expect(mine).toMatchObject({ updates: "instant", reminders: "daily", quietFrom: "20:00", quietTo: "07:00", saturday: false, ramadan: true });
    const saved = await svc(U.cowner, (tx, p) => N.setMailPreferences(tx, p, { updates: "weekly", quietFrom: null, quietTo: null }));
    expect(saved).toMatchObject({ updates: "weekly", reminders: "daily", quietFrom: null, quietTo: null });
    await expect(attempt(U.cmgr, `INSERT INTO mail_preferences (user_id) VALUES ($1)`, [U.cowner])).rejects.toThrow(/row-level security/);
    expect((await attempt(U.cmgr, `UPDATE mail_preferences SET updates = 'off'`)).rowCount).toBe(0);
    expect((await attempt(U.cmgr, `DELETE FROM mail_preferences`)).rowCount).toBe(0);
  });

  it("refuses half-set or empty quiet hours and instant reminders", async () => {
    await expect(svc(U.cowner, (tx, p) => N.setMailPreferences(tx, p, { quietFrom: null }))).rejects.toThrow(/quiet_hours/);
    await expect(svc(U.cowner, (tx, p) => N.setMailPreferences(tx, p, { quietFrom: "07:00" }))).rejects.toThrow(/quiet_hours/);
    await expect(run(U.cowner, `INSERT INTO mail_preferences (user_id, quiet_from, quiet_to) VALUES ($1, '08:00', NULL)`, [U.cowner])).rejects.toThrow(
      /mail_quiet_hours/,
    );
    await expect(run(U.cowner, `INSERT INTO mail_preferences (user_id, reminders) VALUES ($1, 'instant')`, [U.cowner])).rejects.toThrow(
      /mail_reminders_cadence/,
    );
  });

  it("show when a mail queued now would go out, and the firm's Ramadan", async () => {
    await owner.query(
      `INSERT INTO firm_settings (org_id, ramadan_starts, ramadan_ends) VALUES ($1, '2027-02-08', '2027-03-09')
       ON CONFLICT (org_id) DO UPDATE SET ramadan_starts = EXCLUDED.ramadan_starts, ramadan_ends = EXCLUDED.ramadan_ends`,
      [FIRM],
    );
    const mine = await svc(U.cowner, (tx, p) => N.getMailPreferences(tx, p));
    expect(mine.firmRamadan).toEqual({ starts: "2027-02-08", ends: "2027-03-09", mailFrom: "10:00", mailTo: "15:00" });
    const expected = (await owner.query(`SELECT app_mail_send_at($1, now()) AS t`, [U.cowner])).rows[0].t as Date;
    expect(Math.abs(mine.nextMailAt!.getTime() - expected.getTime())).toBeLessThan(5000);
  });

  it("the firm's Ramadan runs 29 or 30 days, with hours that run forward", async () => {
    const set = (starts: string | null, ends: string | null, from = "10:00", to = "15:00") =>
      owner.query(
        `UPDATE firm_settings SET ramadan_starts = $2, ramadan_ends = $3, ramadan_mail_from = $4, ramadan_mail_to = $5 WHERE org_id = $1`,
        [FIRM, starts, ends, from, to],
      );
    await expect(set("2027-02-08", null)).rejects.toThrow(/ramadan_dates/);
    await expect(set("2027-02-08", "2027-03-20")).rejects.toThrow(/ramadan_dates/);
    await expect(set("2027-02-08", "2027-03-09", "15:00", "10:00")).rejects.toThrow(/ramadan_mail_hours/);
    await set("2027-02-08", "2027-03-08");
    await set(null, null);
  });
});

describe("cadence per kind, and muting one action", () => {
  beforeEach(async () => {
    await owner.query(`DELETE FROM mail_preferences`);
    await owner.query(`DELETE FROM mail_mutes`);
    await owner.query(`TRUNCATE outbound_emails`);
    // Earlier tests' notices are read, so each test sees only its own.
    await owner.query(`UPDATE notifications SET read_at = now() WHERE read_at IS NULL`);
  });

  it("an owner who batches updates gets no instant mail, and the summary picks it up", async () => {
    await choose(U.cowner, { updates: "daily" });
    const aid = await action({ status: "assigned" });
    await notify(U.cowner, "action.assigned", aid);
    expect(await queued("action.assigned")).toEqual([]);
    expect(await owner.query(`SELECT app_queue_digests('2027-05-24') AS n`).then((r) => r.rows[0].n)).toBe(1);
    expect((await queued("follow_up.digest")).map((m) => [m.to_email, m.link])).toEqual([["cowner@example.test", "/notifications"]]);
    // Summarised once: a second run has nothing new.
    await owner.query(`TRUNCATE outbound_emails`);
    expect(await owner.query(`SELECT app_queue_digests('2027-05-24') AS n`).then((r) => r.rows[0].n)).toBe(0);
  });

  it("weekly comes on Sunday only; off never comes", async () => {
    await choose(U.cowner, { updates: "weekly" });
    await choose(U.cmgr, { reminders: "off" });
    const aid = await action({ status: "assigned" });
    await notify(U.cowner, "action.assigned", aid);
    await notify(U.cmgr, "follow_up.overdue.2", aid);
    expect(await owner.query(`SELECT app_queue_digests('2027-05-24') AS n`).then((r) => r.rows[0].n)).toBe(0); // Monday
    expect(await owner.query(`SELECT app_queue_digests('2027-05-23') AS n`).then((r) => r.rows[0].n)).toBe(1); // Sunday
    expect((await queued("follow_up.digest")).map((m) => m.to_email)).toEqual(["cowner@example.test"]);
  });

  it("information request reminders ride the reminders summary, by its cadence", async () => {
    await run(U.cons, `INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,'info_request.overdue','project',$2)`, [U.cadmin, PROJ]);
    await run(U.cons, `INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,'info_request.received','project',$2)`, [U.cmgr, PROJ]);
    await choose(U.cadmin, { reminders: "weekly" });
    expect(await owner.query(`SELECT app_queue_digests('2027-05-24') AS n`).then((r) => r.rows[0].n)).toBe(0); // Monday
    await choose(U.cadmin, { reminders: "daily" });
    expect(await owner.query(`SELECT app_queue_digests('2027-05-24') AS n`).then((r) => r.rows[0].n)).toBe(1);
    expect((await queued("follow_up.digest")).map((m) => m.to_email)).toEqual(["cadmin@example.test"]);
  });

  it("instant owners still get instant mail and no summary for it", async () => {
    const aid = await action({ status: "assigned" });
    await notify(U.cowner, "action.assigned", aid);
    expect((await queued("action.assigned")).map((m) => m.to_email)).toEqual(["cowner@example.test"]);
    expect(await owner.query(`SELECT app_queue_digests('2027-05-24') AS n`).then((r) => r.rows[0].n)).toBe(0);
  });

  it("a muted action sends no mail of any kind, and the notices still arrive", async () => {
    const aid = await action({ status: "assigned", due: "2027-05-20" });
    expect(await svc(U.cowner, (tx, p) => N.setActionMuted(tx, p, aid, true))).toEqual({ muted: true });
    await notify(U.cowner, "action.assigned", aid);
    expect(await queued("action.assigned")).toEqual([]);
    const { sent, mailed } = await runFollowUps(owner, "2027-05-21");
    expect(sent).toBeGreaterThan(0);
    expect(mailed).toBe(0);
    expect((await owner.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND entity_id = $2`, [U.cowner, aid])).rows[0].n).toBe(2);
    const listed = await svc(U.cowner, (tx, p) => N.getMailPreferences(tx, p));
    expect(listed.muted.map((m) => m.actionId)).toEqual([aid]);
    expect(await svc(U.cowner, (tx, p) => N.setActionMuted(tx, p, aid, false))).toEqual({ muted: false });
    expect(await svc(U.cowner, (tx, p) => N.isActionMuted(tx, p, aid))).toBe(false);
  });

  it("nobody mutes an action they can't see, or for someone else", async () => {
    const hidden = await action({ rec: REC_PRIVATE });
    await expect(svc(U.cmgr, (tx, p) => N.setActionMuted(tx, p, hidden, true))).rejects.toThrow(/action/);
    await expect(run(U.cmgr, `INSERT INTO mail_mutes (user_id, action_id) VALUES ($1,$2)`, [U.cmgr, hidden])).rejects.toThrow(/row-level security/);
    const shown = await action();
    await expect(run(U.cmgr, `INSERT INTO mail_mutes (user_id, action_id) VALUES ($1,$2)`, [U.cowner, shown])).rejects.toThrow(/row-level security/);
    await run(U.cowner, `INSERT INTO mail_mutes (user_id, action_id) VALUES ($1,$2)`, [U.cowner, shown]);
    expect((await attempt(U.cmgr, `SELECT * FROM mail_mutes`)).rows).toEqual([]);
  });
});

describe("the reminder ladder on the action", () => {
  it("shows each step, its day and who it reaches, then when it went out", async () => {
    const aid = await action({ due: "2027-06-10" });
    const ladder = await svc(U.cowner, (tx, p) => actionLadder(tx, p, aid));
    expect(ladder.running).toBe(true);
    expect(ladder.steps.map((s) => [s.level, s.onDate, s.audience, s.sentAt])).toEqual([
      [0, "2027-06-07", ["owner"], null],
      [1, "2027-06-11", ["owner"], null],
      [2, "2027-06-17", ["owner", "client_managers", "client_lead"], null],
      [3, "2027-06-24", ["owner", "client_managers", "client_lead", "sponsor", "client_admins", "watching_firm_admins"], null],
    ]);
    await runFollowUps(owner, "2027-06-11");
    const after = await svc(U.cons, (tx, p) => actionLadder(tx, p, aid));
    expect(after.steps.map((s) => s.sentAt !== null)).toEqual([false, true, false, false]);
  });

  it("names the people app_follow_ups_due() picks at the top step", async () => {
    const aid = await action({ due: "2027-06-01" });
    const [due] = (await owner.query(`SELECT recipients FROM app_follow_ups_due('2027-06-20') WHERE action_id = $1`, [aid])).rows;
    // owner, client manager, lead, client admin, watching firm admin (no sponsor named here)
    expect([...due.recipients].sort()).toEqual([U.cowner, U.cmgr, U.lead, U.cadmin, U.admin].sort());
  });

  it("is paused while waiting on the firm, starts at level 2 for an owner who left, and is hidden with the action", async () => {
    const waiting = await action({ due: "2027-06-10", status: "awaiting_review" });
    expect((await svc(U.cowner, (tx, p) => actionLadder(tx, p, waiting))).running).toBe(false);
    const orphan = await action({ due: "2027-06-10", owner: U.cmgr });
    await owner.query(`UPDATE org_memberships SET active = false WHERE user_id = $1`, [U.cmgr]);
    const levels = (await svc(U.cons, (tx, p) => actionLadder(tx, p, orphan))).steps.map((s) => s.level);
    await owner.query(`UPDATE org_memberships SET active = true WHERE user_id = $1`, [U.cmgr]);
    expect(levels).toEqual([2, 3]);
    const hidden = await action({ due: "2027-06-10", rec: REC_PRIVATE });
    expect((await attempt(U.cmgr, `SELECT * FROM app_action_ladder($1)`, [hidden])).rows).toEqual([]);
    expect((await attempt(U.cons, `SELECT * FROM app_action_ladder($1)`, [hidden])).rows).toHaveLength(4);
  });
});

describe("mail that isn't getting through", () => {
  beforeEach(() => owner.query(`TRUNCATE outbound_emails`));

  it("firm staff see it for a person whose last mail failed, or keeps failing; clients never do", async () => {
    await owner.query(
      `INSERT INTO outbound_emails (to_email, kind, sent_at, created_at) VALUES ('cowner@example.test','invitation', now() - interval '2 days', now() - interval '2 days')`,
    );
    await owner.query(
      `INSERT INTO outbound_emails (to_email, kind, attempts, failed_at, last_error) VALUES ('cowner@example.test','password_reset.notice', 8, now(), 'mailbox unavailable')`,
    );
    await owner.query(
      `INSERT INTO outbound_emails (to_email, kind, attempts, last_error, next_attempt_at) VALUES ('cmgr@example.test','password_reset.notice', 3, 'timeout', now() + interval '1 hour')`,
    );
    const seen = await svc(U.cons, (tx, p) => mailFailing(tx, p, [U.cowner, U.cmgr, U.cadmin]));
    expect([...seen.keys()].sort()).toEqual([U.cowner, U.cmgr].sort());
    expect((await svc(U.cadmin, (tx, p) => mailFailing(tx, p, [U.cowner]))).size).toBe(0);
    expect((await attempt(U.cadmin, `SELECT * FROM app_mail_failing($1::uuid[])`, [`{${U.cowner}}`])).rows).toEqual([]);
    // A later mail that went through clears it.
    await owner.query(`INSERT INTO outbound_emails (to_email, kind, sent_at) VALUES ('cowner@example.test','invitation', now() + interval '1 minute')`);
    expect((await svc(U.cons, (tx, p) => mailFailing(tx, p, [U.cowner]))).size).toBe(0);
  });
});
