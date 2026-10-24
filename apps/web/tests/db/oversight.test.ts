// Oversight across projects (F18, 2026-10-24): a health signal per open
// project from counts the firm already keeps, the exceptions across every
// project the caller can see, and a one-click reminder to an action's owner,
// once a day.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import {
  CLIENT_QUIET_DAYS,
  HEALTH_LATE_DAYS,
  HEALTH_OVERDUE_SHARE,
  healthSignal,
  REVIEW_WAIT_DAYS,
  weekStart,
} from "@/lib/health";
import { exceptions, portfolio, remindOwner } from "@/services/oversight";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl)
  throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) =>
  `00000000-0000-4000-c1a0-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = {
  admin: id(11),
  lead: id(12),
  obs: id(13),
  other: id(14),
  cadmin: id(15),
  cowner: id(16),
};
const P = { acme: id(21), beta: id(22), draft: id(23) };
const R = { acme: id(31), secret: id(32) };
const A = {
  open: id(41),
  secret: id(42),
  late: id(43),
  review: id(44),
  done: id(45),
};

let today = "";
const day = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function as<T>(
  userId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
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
const sql = (userId: string, text: string, params: unknown[] = []) =>
  as(userId, (c) => c.query(text, params));
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
const insertReminder = `INSERT INTO action_reminders (project_id, org_id, action_id, owner_id, sent_by, on_day) VALUES ($1,$2,$3,$4,$4,'2000-01-01')`;

async function seed() {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  today = (await q(`SELECT app_firm_today()::text AS d`)).rows[0].d;
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode) VALUES ($1,'firm','firm',NULL), ($2,'client','Acme','full'), ($3,'client','Beta','full')`,
    [FIRM, ACME, BETA],
  );
  for (const [name, uid] of Object.entries(U))
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [
      uid,
      name,
      `${name}@example.test`,
    ]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$7,'firm_admin'), ($2,$7,'consultant'), ($3,$7,'consultant'), ($4,$7,'consultant'), ($5,$8,'client_admin'), ($6,$8,'action_owner')`,
    [U.admin, U.lead, U.obs, U.other, U.cadmin, U.cowner, FIRM, ACME],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$4,$6,'Acme governance','active',$7), ($2,'client',$5,$6,'Beta plan','active',$7), ($3,'client',$4,$6,'Acme pitch','draft',$7)`,
    [P.acme, P.beta, P.draft, ACME, BETA, FIRM, U.admin],
  );
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$3,true), ($2,$4,true)`,
    [ACME, BETA, U.lead, U.other],
  );
  await q(
    `INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,false), ($1,$3,true), ($1,$4,false)`,
    [P.acme, U.lead, U.obs, U.cowner],
  );
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES
      ($1,$3,$4,'Adopt a board charter','shared',$5), ($2,$3,$4,'Replace the CFO','firm_private',$5)`,
    [R.acme, R.secret, P.acme, ACME, U.lead],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, created_by, due_date, updated_at) VALUES
      ($1,$6,$7,$8,'Sign the charter',$10,'in_progress',$11,$12,now()),
      ($2,$6,$7,$9,'Find candidates',NULL,'assigned',$11,$12,now()),
      ($3,$6,$7,$8,'Publish minutes',$10,'in_progress',$11,$13,now()),
      ($4,$6,$7,$8,'Send the policy',$10,'awaiting_review',$11,$12,now() - interval '10 days'),
      ($5,$6,$7,$8,'Name a secretary',$10,'verified_complete',$11,$12,now())`,
    [
      A.open,
      A.secret,
      A.late,
      A.review,
      A.done,
      P.acme,
      ACME,
      R.acme,
      R.secret,
      U.cowner,
      U.lead,
      day(10),
      day(-40),
    ],
  );
}

beforeEach(seed);
afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("the database agrees with lib/health.ts", () => {
  it("on the thresholds and the signal", async () => {
    const c = (
      await owner.query(
        `SELECT app_health_overdue_share() AS s, app_health_late_days() AS l, app_review_wait_days() AS r`,
      )
    ).rows[0];
    expect([Number(c.s), c.l, c.r]).toEqual([
      HEALTH_OVERDUE_SHARE,
      HEALTH_LATE_DAYS,
      REVIEW_WAIT_DAYS,
    ]);
    const cases: [number, number, number, number, number][] = [];
    for (const total of [0, 4])
      for (const open of [0, 1, 4])
        for (const overdue of [0, 1, 2])
          for (const lateLong of [0, 1])
            for (const cautions of [0, 2]) {
              if (overdue <= open)
                cases.push([total, open, overdue, lateLong, cautions]);
            }
    for (const [total, open, overdue, lateLong, cautions] of cases) {
      const r = await owner.query(
        `SELECT app_health_signal($1, $2, $3, $4, $5) AS s`,
        [total, open, overdue, lateLong, cautions],
      );
      expect([total, open, overdue, lateLong, cautions, r.rows[0].s]).toEqual([
        total,
        open,
        overdue,
        lateLong,
        cautions,
        healthSignal({ total, open, overdue, lateLong, cautions }),
      ]);
    }
  });
});

describe("the portfolio", () => {
  it("shows the lead their client's open projects with counts, a signal and why", async () => {
    await owner.query(
      `INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event) VALUES ($1,$2,$3,'action',$4,'progress')`,
      [P.acme, ACME, U.cowner, A.open],
    );
    const rows = await svc(U.lead, (tx, p) => portfolio(tx, p));
    expect(rows.map((r) => r.projectId)).toEqual([P.acme]); // not Beta, not the pitch
    const [acme] = rows;
    // Open: open, secret, late, review (four). Overdue: late (1 of 4 is a quarter).
    expect(acme).toMatchObject({
      total: 5,
      open: 4,
      overdue: 1,
      awaitingReview: 1,
      reviewWaiting: 1,
      lead: "lead",
      signal: "off_track",
    });
    expect(acme!.oldestReviewDays).toBeGreaterThanOrEqual(9);
    expect(acme!.clientLastActive).toBeInstanceOf(Date);
  });

  it("is on track once nothing needs attention", async () => {
    await owner.query(
      `UPDATE actions SET due_date = $2, updated_at = now() WHERE id = $1`,
      [A.late, day(5)],
    );
    await owner.query(
      `UPDATE actions SET status = 'revision_requested', updated_at = now() WHERE id = $1`,
      [A.review],
    );
    const [acme] = await svc(U.lead, (tx, p) => portfolio(tx, p));
    expect(acme!.signal).toBe("on_track");
  });

  it("is the whole firm for the admin, only their own for another consultant, and nothing for the client", async () => {
    expect(
      (await svc(U.admin, (tx, p) => portfolio(tx, p)))
        .map((r) => r.projectId)
        .sort(),
    ).toEqual([P.acme, P.beta]);
    const beta = await svc(U.other, (tx, p) => portfolio(tx, p));
    expect(beta.map((r) => [r.projectId, r.signal])).toEqual([
      [P.beta, "no_data"],
    ]);
    await expect(svc(U.cadmin, (tx, p) => portfolio(tx, p))).rejects.toThrow(
      /not found|page/i,
    );
    // Straight to the database, the client gets no rows.
    expect((await sql(U.cadmin, `SELECT * FROM app_portfolio()`)).rows).toEqual(
      [],
    );
    expect(
      (
        await sql(
          U.cadmin,
          `SELECT app_client_last_active($1) AS t, app_project_lead($1) AS l`,
          [P.acme],
        )
      ).rows[0],
    ).toEqual({ t: null, l: null });
  });
});

describe("exceptions", () => {
  it("lists what breaks a rule, with blocked actions and reviews waiting too long", async () => {
    await owner.query(
      `UPDATE actions SET status = 'blocked', updated_at = now() WHERE id = $1`,
      [A.open],
    );
    const rows = await svc(U.lead, (tx, p) => exceptions(tx, p));
    const got = rows.map((r) => [r.rule, r.entityId]);
    expect(got).toContainEqual(["overdue", A.late]);
    expect(got).toContainEqual(["review_waiting", A.review]);
    expect(got).toContainEqual(["blocked", A.open]);
    expect(rows[0]!.rule).toBe("overdue");
    expect(rows.find((r) => r.entityId === A.late)!.can.remind).toBe(true);
    // Another consultant's view holds nothing of Acme.
    expect(
      (await svc(U.other, (tx, p) => exceptions(tx, p))).filter(
        (r) => r.projectId === P.acme,
      ),
    ).toEqual([]);
  });

  it("offers no reminder to an observer", async () => {
    const rows = await svc(U.obs, (tx, p) => exceptions(tx, p));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => !r.can.remind)).toBe(true);
  });
});

describe("reminding an owner", () => {
  it("tells the owner, once a firm day", async () => {
    await svc(U.lead, (tx, p) => remindOwner(tx, p, A.late));
    const n = await owner.query(
      `SELECT user_id, kind, entity_id FROM notifications WHERE kind = 'follow_up.reminder'`,
    );
    expect(n.rows).toEqual([
      { user_id: U.cowner, kind: "follow_up.reminder", entity_id: A.late },
    ]);
    const r = (
      await owner.query(
        `SELECT owner_id, sent_by, on_day::text AS d FROM action_reminders`,
      )
    ).rows;
    expect(r).toEqual([{ owner_id: U.cowner, sent_by: U.lead, d: today }]);
    expect(
      await refused(svc(U.admin, (tx, p) => remindOwner(tx, p, A.late))),
    ).toMatch(/already reminded today/);
    const rows = await svc(U.lead, (tx, p) => exceptions(tx, p));
    expect(rows.find((x) => x.entityId === A.late)).toMatchObject({
      remindedToday: true,
      can: { remind: false },
    });
    // Kept: the record can't be changed or removed.
    expect(await refused(sql(U.lead, `DELETE FROM action_reminders`))).not.toBe(
      "",
    );
  });

  it("needs an open action with another active owner", async () => {
    expect(
      await refused(svc(U.lead, (tx, p) => remindOwner(tx, p, A.secret))),
    ).toMatch(/no other active owner/);
    expect(
      await refused(svc(U.lead, (tx, p) => remindOwner(tx, p, A.done))),
    ).toMatch(/open action/);
    await owner.query(
      `UPDATE org_memberships SET active = false WHERE user_id = $1`,
      [U.cowner],
    );
    expect(
      await refused(svc(U.lead, (tx, p) => remindOwner(tx, p, A.late))),
    ).toMatch(/no other active owner/);
  });

  it("is for the firm on the project, not an observer, the client or another team, and not on a closed project", async () => {
    expect(
      await refused(svc(U.obs, (tx, p) => remindOwner(tx, p, A.late))),
    ).toMatch(/forbidden/);
    expect(
      await refused(sql(U.obs, insertReminder, [P.acme, ACME, A.late, U.obs])),
    ).toMatch(/observ/);
    expect(
      await refused(svc(U.cadmin, (tx, p) => remindOwner(tx, p, A.late))),
    ).toMatch(/forbidden/);
    expect(
      await refused(
        sql(U.cadmin, insertReminder, [P.acme, ACME, A.late, U.cadmin]),
      ),
    ).toMatch(/row-level security/);
    expect(
      await refused(svc(U.other, (tx, p) => remindOwner(tx, p, A.late))),
    ).toMatch(/not found|forbidden/i);
    expect(
      await refused(
        sql(U.other, insertReminder, [P.acme, ACME, A.late, U.other]),
      ),
    ).toMatch(/row-level security|actions of the project/);
    await owner.query(`UPDATE projects SET state = 'closed' WHERE id = $1`, [
      P.acme,
    ]);
    expect(
      await refused(
        sql(U.lead, insertReminder, [P.acme, ACME, A.late, U.lead]),
      ),
    ).toMatch(/closed|open action/);
    expect(
      (await owner.query(`SELECT count(*)::int AS n FROM notifications`))
        .rows[0].n,
    ).toBe(0);
  });
});

describe("weekly health history", () => {
  it("keeps this week's signal for every open project, once per week, and shows it to the firm", async () => {
    expect((await owner.query(`SELECT app_snapshot_health($1) AS n`, [today])).rows[0].n).toBe(2);
    expect((await owner.query(`SELECT app_snapshot_health($1) AS n`, [today])).rows[0].n).toBe(2);
    const rows = (await owner.query(`SELECT project_id, week_start::text AS w, signal FROM project_health_weeks ORDER BY project_id`)).rows;
    expect(rows).toEqual([
      { project_id: P.acme, w: weekStart(today), signal: "off_track" },
      { project_id: P.beta, w: weekStart(today), signal: "no_data" },
    ]);
    expect((await owner.query(`SELECT app_week_start($1::date)::text AS w`, [today])).rows[0].w).toBe(weekStart(today));
    await owner.query(`INSERT INTO project_health_weeks (project_id, org_id, week_start, signal, open, overdue, cautions) VALUES ($1,$2,$3,'watch',3,1,0)`, [
      P.acme,
      ACME,
      day(-7 - new Date(`${today}T00:00:00Z`).getUTCDay()),
    ]);
    const [acme] = await svc(U.lead, (tx, p) => portfolio(tx, p));
    expect(acme!.weeks.map((w) => w.signal)).toEqual(["watch", "off_track"]);
    // Firm-only, and only for projects the caller can see.
    expect((await sql(U.cadmin, `SELECT * FROM project_health_weeks`)).rows).toEqual([]);
    expect((await sql(U.other, `SELECT project_id FROM project_health_weeks`)).rows).toEqual([{ project_id: P.beta }]);
    expect(await refused(sql(U.admin, `UPDATE project_health_weeks SET signal = 'on_track'`))).toMatch(/permission denied/);
  });

  it("counts every move of a date when the job runs without a user", async () => {
    await owner.query(`UPDATE actions SET due_date = $2 WHERE id = $1`, [A.open, day(20)]);
    await owner.query(`UPDATE actions SET due_date = $2 WHERE id = $1`, [A.open, day(30)]);
    expect((await owner.query(`SELECT extended_twice FROM app_project_health($1)`, [P.acme])).rows[0].extended_twice).toBe(1);
    const [acme] = await svc(U.lead, (tx, p) => portfolio(tx, p));
    expect(acme!.extendedTwice).toBe(1);
  });
});

describe("quiet clients", () => {
  const alerts = async () =>
    (await owner.query(`SELECT user_id, entity_id FROM notifications WHERE kind = 'project.client_quiet' ORDER BY created_at, user_id`)).rows;
  const quietFor = (days: number) => owner.query(`UPDATE projects SET created_at = now() - make_interval(days => $2) WHERE id = $1`, [P.acme, days]);

  it("tells the client's lead once per quiet spell", async () => {
    await quietFor(CLIENT_QUIET_DAYS - 1);
    expect((await owner.query(`SELECT app_alert_quiet_clients($1) AS n`, [today])).rows[0].n).toBe(0);
    await quietFor(CLIENT_QUIET_DAYS + 1);
    expect((await owner.query(`SELECT app_alert_quiet_clients($1) AS n`, [today])).rows[0].n).toBe(1);
    expect(await alerts()).toEqual([{ user_id: U.lead, entity_id: P.acme }]);
    expect((await owner.query(`SELECT app_alert_quiet_clients($1) AS n`, [today])).rows[0].n).toBe(0);
    // The client acted after the alert, then went quiet again: a new spell.
    await owner.query(`UPDATE notifications SET created_at = now() - interval '30 days'`);
    await owner.query(
      `INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, created_at) VALUES ($1,$2,$3,'action',$4,'progress', now() - make_interval(days => $5))`,
      [P.acme, ACME, U.cowner, A.open, CLIENT_QUIET_DAYS + 2],
    );
    expect((await owner.query(`SELECT app_alert_quiet_clients($1) AS n`, [today])).rows[0].n).toBe(1);
    // It rides the person's reminder summary.
    await owner.query(`SELECT app_queue_digests($1)`, [today]);
    expect((await owner.query(`SELECT count(*)::int AS n FROM notifications WHERE kind = 'project.client_quiet' AND mailed_at IS NULL AND created_at > now() - interval '1 day'`)).rows[0].n).toBe(0);
  });

  it("isn't raised once the client acts", async () => {
    await quietFor(CLIENT_QUIET_DAYS + 5);
    await owner.query(
      `INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event) VALUES ($1,$2,$3,'action',$4,'progress')`,
      [P.acme, ACME, U.cowner, A.open],
    );
    expect((await owner.query(`SELECT app_alert_quiet_clients($1) AS n`, [today])).rows[0].n).toBe(0);
  });

  it("isn't raised for a consultant-managed client, who never signs in", async () => {
    await quietFor(CLIENT_QUIET_DAYS + 5);
    await owner.query(`UPDATE org_memberships SET active = false WHERE org_id = $1`, [ACME]);
    await owner.query(`UPDATE organizations SET engagement_mode = 'consultant_managed' WHERE id = $1`, [ACME]);
    expect((await owner.query(`SELECT app_alert_quiet_clients($1) AS n`, [today])).rows[0].n).toBe(0);
  });

  it("goes to the firm admins when the client has no lead", async () => {
    await quietFor(CLIENT_QUIET_DAYS + 5);
    await owner.query(`DELETE FROM client_assignments WHERE client_org_id = $1`, [ACME]);
    expect((await owner.query(`SELECT app_alert_quiet_clients($1) AS n`, [today])).rows[0].n).toBe(1);
    expect(await alerts()).toEqual([{ user_id: U.admin, entity_id: P.acme }]);
  });

  it("can't be run by the app", async () => {
    expect(await refused(sql(U.admin, `SELECT app_alert_quiet_clients(current_date)`))).toMatch(/permission denied/);
    expect(await refused(sql(U.admin, `SELECT app_snapshot_health(current_date)`))).toMatch(/permission denied/);
  });
});
