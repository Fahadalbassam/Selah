// The mail sender and password reset (baseline: Mail) against a real
// Postgres: claiming, retries, giving up, clearing links, meeting invites,
// and the reset queue's rules.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... TEST_DATABASE_AUTH_URL=... npm run test:db
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMail, type OutgoingMail } from "../../src/jobs/mail";
import { MAIL_KINDS, renderMail } from "../../src/lib/mail-templates";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
const authUrl = process.env.TEST_DATABASE_AUTH_URL;
if (!ownerUrl || !appUrl || !authUrl)
  throw new Error("set TEST_DATABASE_OWNER_URL, TEST_DATABASE_APP_URL and TEST_DATABASE_AUTH_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 3 });
const app = new Pool({ connectionString: appUrl, max: 2 });
const authDb = new Pool({ connectionString: authUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-f300-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const PROJ = id(3);
const U = { admin: id(11), cons: id(12), cmgr: id(13), off: id(14), nobody: id(15) };
const SITE = "https://selah.example";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWx";

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
const queue = async () =>
  (
    await owner.query(
      `SELECT to_email, kind, link, attempts, sent_at, failed_at, last_error, next_attempt_at FROM outbound_emails ORDER BY created_at`,
    )
  ).rows;
const reset = (uid: string, token = TOKEN) => authDb.query(`SELECT app_queue_password_reset($1, $2) AS ok`, [uid, token]);

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`TRUNCATE outbound_emails, audit_log`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme')`, [FIRM, ACME]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role, active) VALUES
      ($1,$5,'firm_admin',true), ($2,$5,'consultant',true), ($3,$6,'client_manager',true), ($4,$6,'client_manager',false)`,
    [U.admin, U.cons, U.cmgr, U.off, FIRM, ACME],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Acme governance','active',$4)`,
    [PROJ, ACME, FIRM, U.admin],
  );
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3)`, [PROJ, U.cons, U.cmgr]);
});

beforeEach(async () => {
  await owner.query(`TRUNCATE outbound_emails`);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end(), authDb.end()]);
});

describe("the sender", () => {
  it("sends each due mail once, joins the link to the site, and clears it after", async () => {
    await owner.query(`INSERT INTO outbound_emails (to_email, kind, link) VALUES ('a@example.test','invitation','/invite/tok')`);
    const sent: OutgoingMail[] = [];
    const out = await runMail(owner, async (m) => void sent.push(m), SITE);
    expect(out).toEqual({ sent: 1, failed: 0 });
    expect(sent[0]!.to).toBe("a@example.test");
    expect(sent[0]!.text).toContain(`${SITE}/invite/tok`);
    expect(sent[0]!.html).toContain(`href="${SITE}/invite/tok"`);
    const [row] = await queue();
    expect(row.sent_at).not.toBeNull();
    expect(row.link).toBeNull();
    // Nothing is due any more.
    expect(await runMail(owner, async (m) => void sent.push(m), SITE)).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(1);
  });

  it("never lets two senders take the same mail", async () => {
    await owner.query(
      `INSERT INTO outbound_emails (to_email, kind) SELECT 'p' || g || '@example.test', 'email_change.notice' FROM generate_series(1, 30) g`,
    );
    const seen: string[] = [];
    const slow = async (m: OutgoingMail) => {
      await new Promise((r) => setTimeout(r, 5));
      seen.push(m.to);
    };
    const [a, b] = await Promise.all([runMail(owner, slow, SITE, 20), runMail(owner, slow, SITE, 20)]);
    expect(a.sent + b.sent).toBe(30);
    expect(new Set(seen).size).toBe(30);
  });

  it("sends the oldest first, so related mails arrive in order", async () => {
    await owner.query(
      `INSERT INTO outbound_emails (to_email, kind, created_at)
       SELECT 'o' || g || '@example.test', 'email_change.notice', now() - make_interval(secs => g) FROM generate_series(1, 12) g`,
    );
    const seen: string[] = [];
    await runMail(owner, async (m) => void seen.push(m.to), SITE);
    // Inserted newest first, so the table's own order is the wrong one.
    expect(seen).toEqual(Array.from({ length: 12 }, (_, i) => `o${12 - i}@example.test`));
  });

  it("retries a failure later with the error kept, and gives up after 8 tries", async () => {
    await owner.query(`INSERT INTO outbound_emails (to_email, kind) VALUES ('x@example.test','password_reset.notice')`);
    const fail = async () => {
      throw new Error("relay refused");
    };
    expect(await runMail(owner, fail, SITE)).toEqual({ sent: 0, failed: 1 });
    let [row] = await queue();
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe("relay refused");
    expect(row.failed_at).toBeNull();
    expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    // Not due yet.
    expect(await runMail(owner, fail, SITE)).toEqual({ sent: 0, failed: 0 });

    for (let i = 2; i <= 8; i++) {
      await owner.query(`UPDATE outbound_emails SET next_attempt_at = now() - interval '1 second'`);
      await runMail(owner, fail, SITE);
    }
    [row] = await queue();
    expect(row.attempts).toBe(8);
    expect(row.failed_at).not.toBeNull();
    await owner.query(`UPDATE outbound_emails SET next_attempt_at = NULL`);
    expect(await runMail(owner, fail, SITE)).toEqual({ sent: 0, failed: 0 });
  });

  it("attaches the meeting's invite as it stands when sending, and the cancellation", async () => {
    const mid = id(50);
    await as(U.cons, (c) =>
      c.query(
        `INSERT INTO meetings (id, project_id, org_id, kind, title, starts_at, ends_at, location, join_url, organizer_id, ics_uid)
         VALUES ($1,$2,$3,'status','Monthly status', now() + interval '1 day', now() + interval '1 day 1 hour','online',
                 'https://meet.google.com/abc-defg-hij',$4,'x')`,
        [mid, PROJ, ACME, U.cons],
      ),
    );
    await as(U.cons, (c) => c.query(`INSERT INTO meeting_attendees (meeting_id, user_id) VALUES ($1,$2)`, [mid, U.cmgr]));
    await as(U.cons, (c) => c.query(`SELECT app_send_meeting_invites($1)`, [mid]));
    await as(U.cons, (c) => c.query(`UPDATE meetings SET title = 'Monthly status (moved)' WHERE id = $1`, [mid]));

    const sent: OutgoingMail[] = [];
    await runMail(owner, async (m) => void sent.push(m), SITE);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("cmgr@example.test");
    expect(sent[0]!.icalEvent?.method).toBe("REQUEST");
    expect(sent[0]!.icalEvent?.content).toContain("SUMMARY:Monthly status (moved)");
    expect(sent[0]!.icalEvent?.content).toContain('ATTENDEE;CN="cmgr"');

    await as(U.cons, (c) => c.query(`UPDATE meetings SET status = 'cancelled' WHERE id = $1`, [mid]));
    await as(U.cons, (c) => c.query(`SELECT app_send_meeting_invites($1)`, [mid]));
    await runMail(owner, async (m) => void sent.push(m), SITE);
    expect(sent[1]!.icalEvent?.method).toBe("CANCEL");
    expect(sent[1]!.icalEvent?.content).toContain("STATUS:CANCELLED");
  });

  it("has a text for every kind the queue accepts, in both languages, with no content", () => {
    for (const kind of MAIL_KINDS) {
      const m = renderMail(kind, "/x", SITE);
      expect(m.subject).toContain(" | ");
      expect(m.text).toContain("---");
      expect(m.html).toContain('dir="rtl"');
    }
  });
});

describe("action mail", () => {
  const REC = id(31);
  const notify = (by: string, to: string, kind: string, act: string) =>
    as(by, (c) => c.query(`INSERT INTO notifications (user_id, kind, entity_type, entity_id) VALUES ($1,$2,'action',$3)`, [to, kind, act]));
  let n = 40;
  const action = async (ownerId: string, status: string) => {
    const aid = id(++n);
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
       VALUES ($1,$2,$3,$4,'Sign the charter',$5,$6,'2026-12-01',$7)`,
      [aid, PROJ, ACME, REC, ownerId, status, U.cons],
    );
    return aid;
  };

  beforeAll(async () => {
    await owner.query(`INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES ($1,$2,$3,'Charter',$4)`, [
      REC,
      PROJ,
      ACME,
      U.cons,
    ]);
  });

  it("mails the owner a link, never the title, when the app tells them about their action", async () => {
    const aid = await action(U.cmgr, "assigned");
    await notify(U.cons, U.cmgr, "action.assigned", aid);
    expect(await queue()).toMatchObject([{ to_email: "cmgr@example.test", kind: "action.assigned", link: `/actions/${aid}` }]);
    const sent: OutgoingMail[] = [];
    await runMail(owner, async (m) => void sent.push(m), SITE);
    expect(sent[0]!.text).toContain(`${SITE}/actions/${aid}`);
    expect(sent[0]!.text).not.toContain("Sign the charter");
    expect(sent[0]!.subject).toBe("إجراء جديد مُسند إليك | An action is assigned to you");
  });

  it("mails each event once an hour at most", async () => {
    const aid = await action(U.cmgr, "revision_requested");
    await notify(U.cons, U.cmgr, "action.revision_requested", aid);
    await notify(U.cons, U.cmgr, "action.revision_requested", aid);
    expect(await queue()).toHaveLength(1);
  });

  it("mails nothing for a notification that doesn't match the action", async () => {
    const aid = await action(U.cmgr, "assigned");
    // Not verified, so no "verified" mail; not the owner, so nothing to the consultant.
    await notify(U.cons, U.cmgr, "action.verified_complete", aid);
    await notify(U.cmgr, U.cons, "action.assigned", aid);
    // Evidence asked for only while an item is open.
    await notify(U.cons, U.cmgr, "evidence.requested", aid);
    // Kinds that aren't action events never mail.
    await notify(U.cons, U.cmgr, "action.in_progress", aid);
    expect(await queue()).toEqual([]);

    await owner.query(
      `INSERT INTO evidence_requests (project_id, org_id, action_id, title, created_by) VALUES ($1,$2,$3,'Signed copy',$4)`,
      [PROJ, ACME, aid, U.cons],
    );
    await notify(U.cons, U.cmgr, "evidence.requested", aid);
    expect(await queue()).toMatchObject([{ kind: "evidence.requested", link: `/actions/${aid}` }]);
  });

  it("mails nobody who has been switched off", async () => {
    const aid = await action(U.cmgr, "verified_complete");
    await owner.query(`UPDATE org_memberships SET active = false WHERE user_id = $1`, [U.cmgr]);
    try {
      await notify(U.cons, U.cmgr, "action.verified_complete", aid);
      expect(await queue()).toEqual([]);
    } finally {
      await owner.query(`UPDATE org_memberships SET active = true WHERE user_id = $1`, [U.cmgr]);
    }
  });
});

describe("password reset", () => {
  it("queues a link for an active member, and only the auth role can ask", async () => {
    expect((await reset(U.cmgr)).rows[0].ok).toBe(true);
    const [row] = await queue();
    expect(row).toMatchObject({ to_email: "cmgr@example.test", kind: "password_reset", link: `/reset-password/${TOKEN}` });
    await expect(as(U.cmgr, (c) => c.query(`SELECT app_queue_password_reset($1, $2)`, [U.cmgr, TOKEN]))).rejects.toThrow(
      /permission denied/,
    );
    await expect(as(U.cmgr, (c) => c.query(`SELECT app_password_was_reset($1)`, [U.cmgr]))).rejects.toThrow(/permission denied/);
  });

  it("sends nothing to a switched-off account or one with no membership, and says so to nobody", async () => {
    expect((await reset(U.off)).rows[0].ok).toBe(false);
    expect((await reset(U.nobody)).rows[0].ok).toBe(false);
    expect((await reset(id(999))).rows[0].ok).toBe(false);
    expect(await queue()).toHaveLength(0);
  });

  it("keeps only the newest unsent link, and sends at most three an hour", async () => {
    await reset(U.cons, "tokenOne_aaaaaaaaaaaaaa");
    await reset(U.cons, "tokenTwo_aaaaaaaaaaaaaa");
    let rows = await queue();
    expect(rows).toHaveLength(1);
    expect(rows[0].link).toBe("/reset-password/tokenTwo_aaaaaaaaaaaaaa");

    // Sent ones count: three reach the inbox in an hour, then no more.
    for (const t of ["tokenThree_aaaaaaaaaaaa", "tokenFour_aaaaaaaaaaaaa"]) {
      await runMail(owner, async () => {}, SITE);
      expect((await reset(U.cons, t)).rows[0].ok).toBe(true);
    }
    await runMail(owner, async () => {}, SITE);
    expect((await reset(U.cons, "tokenLimit_aaaaaaaaaaaa")).rows[0].ok).toBe(false);
    rows = await queue();
    expect(rows.filter((r) => r.kind === "password_reset")).toHaveLength(3);
    expect(rows.every((r) => r.link === null)).toBe(true);
  });

  it("refuses a token that isn't a plain token", async () => {
    await expect(reset(U.cons, "../../evil?x=")).rejects.toThrow(/bad token/);
  });

  it("mails a notice and logs the reset", async () => {
    await owner.query(`TRUNCATE audit_log`);
    await authDb.query(`SELECT app_password_was_reset($1)`, [U.cmgr]);
    expect(await queue()).toMatchObject([{ to_email: "cmgr@example.test", kind: "password_reset.notice", link: null }]);
    const log = (await owner.query(`SELECT actor_id, action, outcome FROM audit_log`)).rows;
    expect(log).toEqual([{ actor_id: U.cmgr, action: "password.reset", outcome: "allow" }]);
  });
});
