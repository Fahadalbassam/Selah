// Sign-in links (wave 2, F14 part 1, decision D7) against a real Postgres and
// the real Better Auth setup: only client managers and action owners get a
// link, everyone else gets the same answer and no mail, and a link works
// once, for 15 minutes, while its person may still use one.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... TEST_DATABASE_AUTH_URL=... npm run test:db
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
const authUrl = process.env.TEST_DATABASE_AUTH_URL;
if (!ownerUrl || !appUrl || !authUrl)
  throw new Error("set TEST_DATABASE_OWNER_URL, TEST_DATABASE_APP_URL and TEST_DATABASE_AUTH_URL");

// The app's configuration, pointed at the test database, before auth.ts loads.
const SITE = "http://selah.test";
Object.assign(process.env, {
  APP_URL: SITE,
  DATABASE_APP_URL: appUrl,
  DATABASE_AUTH_URL: authUrl,
  BETTER_AUTH_SECRET: "a-test-secret-that-is-long-enough-0123456789",
  S3_ENDPOINT: "http://storage.test",
  S3_BUCKET: "test",
  S3_ACCESS_KEY: "test",
  S3_SECRET_KEY: "test",
  AI_SERVICE_URL: "http://ai.test",
  AI_SERVICE_TOKEN: "an-ai-token-that-is-long-enough-0123456789",
});

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });
const authDb = new Pool({ connectionString: authUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-f140-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const GONE = id(3);
const U = {
  admin: id(11),
  cons: id(12),
  cadmin: id(13),
  cmgr: id(14),
  owner: id(15),
  twofa: id(16),
  unverified: id(17),
  inactive: id(18),
  archived: id(19),
};
const mail = (name: keyof typeof U) => `${name}@example.test`;

let handler: (req: Request) => Promise<Response>;
let ipCounter = 0;
const headers = () => ({ origin: SITE, "x-forwarded-for": `10.0.0.${++ipCounter % 250}` });

/** Ask for a link, the way the sign-in form does. */
async function ask(email: string) {
  const res = await handler(
    new Request(`${SITE}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ email, callbackURL: "/" }),
    }),
  );
  return { status: res.status, body: await res.json() };
}

/** Press the button on /sign-in/link/<token>. */
async function openLink(token: string) {
  const q = new URLSearchParams({ token, callbackURL: "/", errorCallbackURL: "/sign-in" });
  const res = await handler(new Request(`${SITE}/api/auth/magic-link/verify?${q}`, { headers: headers(), redirect: "manual" }));
  return { status: res.status, location: res.headers.get("location"), cookie: res.headers.get("set-cookie") ?? "" };
}

const queued = async () =>
  (await owner.query(`SELECT to_email, link FROM outbound_emails WHERE kind = 'sign_in_link' ORDER BY created_at`)).rows as {
    to_email: string;
    link: string;
  }[];
const tokenOf = (link: string) => link.replace("/sign-in/link/", "");
const sessions = async (uid: string) => (await owner.query(`SELECT count(*)::int AS n FROM session WHERE user_id = $1`, [uid])).rows[0].n;
const links = async () => (await owner.query(`SELECT count(*)::int AS n FROM verification WHERE identifier LIKE 'magic-link:%'`)).rows[0].n;
const audit = async () =>
  (await owner.query(`SELECT action, resource_id, outcome, reason, meta FROM audit_log ORDER BY created_at`)).rows as {
    action: string;
    resource_id: string | null;
    outcome: string;
    reason: string | null;
    meta: Record<string, unknown>;
  }[];

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name, status) VALUES ($1,'firm','Firm','active'), ($2,'client','Acme','active'), ($3,'client','Gone','archived')`, [
    FIRM,
    ACME,
    GONE,
  ]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, $2, $3, $4)`, [uid, name, mail(name as keyof typeof U), name !== "unverified"]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role, active) VALUES
      ($1,$10,'firm_admin',true), ($2,$10,'consultant',true), ($3,$11,'client_admin',true), ($4,$11,'client_manager',true),
      ($5,$11,'action_owner',true), ($6,$11,'client_manager',true), ($7,$11,'action_owner',true), ($8,$11,'client_manager',false),
      ($9,$12,'client_manager',true)`,
    [U.admin, U.cons, U.cadmin, U.cmgr, U.owner, U.twofa, U.unverified, U.inactive, U.archived, FIRM, ACME, GONE],
  );
  await q(`UPDATE "user" SET two_factor_enabled = true WHERE id = $1`, [U.twofa]);
  const { auth } = await import("@/auth/auth");
  handler = (req) => auth().handler(req);
});

beforeEach(async () => {
  await owner.query(`TRUNCATE outbound_emails, session, verification`);
  await owner.query(`DELETE FROM firm_settings`);
  await truncateAuditLog(owner);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end(), authDb.end()]);
});

describe("who gets a sign-in link", () => {
  it("mails client managers and action owners a link to the landing page", async () => {
    expect(await ask(mail("cmgr"))).toEqual({ status: 200, body: { status: true } });
    // An address typed in capitals is the same account.
    expect(await ask("OWNER@Example.test")).toEqual({ status: 200, body: { status: true } });
    const rows = await queued();
    expect(rows.map((r) => r.to_email)).toEqual([mail("cmgr"), mail("owner")]);
    for (const r of rows) expect(r.link).toMatch(/^\/sign-in\/link\/[A-Za-z]{32}$/);
    // Only the hash of the token is kept.
    const stored = (await owner.query(`SELECT identifier FROM verification`)).rows.map((r) => r.identifier as string);
    expect(stored).toHaveLength(2);
    for (const r of rows) expect(stored.join(" ")).not.toContain(tokenOf(r.link));
    expect((await audit()).filter((a) => a.action === "auth.sign_in_link.sent").map((a) => a.resource_id)).toEqual([U.cmgr, U.owner]);
    expect((await openLink(tokenOf(rows[1]!.link))).location).toBe(`${SITE}/`);
    expect(await sessions(U.owner)).toBe(1);
  });

  it("answers staff, client admins and everyone else the same, with no mail and no usable token", async () => {
    const others = [mail("admin"), mail("cons"), mail("cadmin"), mail("twofa"), mail("unverified"), mail("inactive"), mail("archived"), "nobody@example.test"];
    for (const email of others) expect(await ask(email)).toEqual({ status: 200, body: { status: true } });
    expect(await queued()).toEqual([]);
    expect(await links()).toBe(0);
    // Known accounts are logged with the reason; the requester never sees it.
    const refused = (await audit()).filter((a) => a.action === "auth.sign_in_link.refused");
    expect(Object.fromEntries(refused.map((a) => [a.resource_id, a.reason]))).toEqual({
      [U.admin]: "not an active client manager or action owner",
      [U.cons]: "not an active client manager or action owner",
      [U.cadmin]: "not an active client manager or action owner",
      [U.twofa]: "uses two-factor sign-in",
      [U.unverified]: "address not verified",
      [U.inactive]: "not an active client manager or action owner",
      [U.archived]: "not an active client manager or action owner",
    });
    expect(refused.every((a) => a.outcome === "deny")).toBe(true);
  });

  it("sends none while the firm has links turned off", async () => {
    await owner.query(`INSERT INTO firm_settings (org_id, sign_in_links_enabled) VALUES ($1, false)`, [FIRM]);
    await ask(mail("cmgr"));
    expect(await queued()).toEqual([]);
    expect((await audit()).map((a) => a.reason)).toContain("turned off by the firm");
  });

  it("queues at most five an hour per address, keeping only the newest unsent one", async () => {
    const queue = (token: string) => authDb.query(`SELECT app_queue_sign_in_link($1, $2) AS ok`, [mail("owner"), token]);
    for (let i = 0; i < 5; i++) {
      expect((await queue(`tok${i}abcdefghijklmnopqrstu`)).rows[0].ok).toBe(true);
      // The sender marks each one sent before the next is asked for.
      await owner.query(`UPDATE outbound_emails SET sent_at = now() WHERE kind = 'sign_in_link' AND sent_at IS NULL`);
    }
    expect((await queue("tok5abcdefghijklmnopqrstu")).rows[0].ok).toBe(false);
    expect((await audit()).at(-1)).toMatchObject({ action: "auth.sign_in_link.refused", reason: "too many links" });
    await owner.query(`TRUNCATE outbound_emails`);
    await queue("tokAabcdefghijklmnopqrstu");
    await queue("tokBabcdefghijklmnopqrstu");
    expect((await queued()).map((r) => r.link)).toEqual(["/sign-in/link/tokBabcdefghijklmnopqrstu"]);
  });

  it("is decided by the auth role only", async () => {
    await expect(app.query(`SELECT app_queue_sign_in_link($1, 'abcdefghijklmnopqrstuvwxyz')`, [mail("cmgr")])).rejects.toThrow(/permission denied/);
    await expect(app.query(`SELECT app_link_sign_in_refusal($1)`, [U.cmgr])).rejects.toThrow(/permission denied/);
    await expect(authDb.query(`SELECT app_queue_sign_in_link($1, 'bad token!')`, [mail("cmgr")])).rejects.toThrow(/bad token/);
  });
});

describe("using a sign-in link", () => {
  const linkFor = async (name: keyof typeof U) => {
    await ask(mail(name));
    const row = (await queued()).find((r) => r.to_email === mail(name));
    return tokenOf(row!.link);
  };

  it("signs the person in once, and logs the method", async () => {
    const token = await linkFor("cmgr");
    const first = await openLink(token);
    expect(first.status).toBe(302);
    expect(first.location).toBe(`${SITE}/`);
    expect(first.cookie).toContain("selah.session_token");
    expect(await sessions(U.cmgr)).toBe(1);
    expect((await audit()).at(-1)).toMatchObject({ action: "auth.sign_in", resource_id: U.cmgr, outcome: "allow", meta: { method: "link" } });

    const again = await openLink(token);
    expect(again.status).toBe(302);
    expect(again.location).toMatch(/\/sign-in\?error=/);
    expect(again.cookie).not.toContain("selah.session_token");
    expect(await sessions(U.cmgr)).toBe(1);
    expect((await audit()).at(-1)).toMatchObject({ action: "auth.sign_in.failed", outcome: "deny", meta: { method: "link" } });
  });

  it("fails once expired", async () => {
    const token = await linkFor("owner");
    await owner.query(`UPDATE verification SET expires_at = now() - interval '1 second'`);
    const res = await openLink(token);
    expect(res.location).toMatch(/\/sign-in\?error=/);
    expect(await sessions(U.owner)).toBe(0);
  });

  it("fails for a made-up token", async () => {
    const res = await openLink("abcdefghijklmnopqrstuvwxyzABCDEF");
    expect(res.location).toMatch(/\/sign-in\?error=/);
  });

  it("fails, like a used link, when the person may no longer sign in this way", async () => {
    const token = await linkFor("cmgr");
    // Made a client admin after the link was sent: password and two-factor from now on.
    await owner.query(`UPDATE org_memberships SET role = 'client_admin' WHERE user_id = $1`, [U.cmgr]);
    try {
      const res = await openLink(token);
      expect(res.location).toBe(`${SITE}/sign-in?error=INVALID_TOKEN`);
      expect(res.cookie).not.toContain("selah.session_token");
      expect(await sessions(U.cmgr)).toBe(0);
      // Used up, so it can't be tried again after a change back.
      expect(await links()).toBe(0);
      expect((await audit()).at(-1)).toMatchObject({
        action: "auth.sign_in.failed",
        outcome: "deny",
        reason: "not an active client manager or action owner",
        meta: { method: "link" },
      });
    } finally {
      await owner.query(`UPDATE org_memberships SET role = 'client_manager' WHERE user_id = $1`, [U.cmgr]);
    }
  });

  it("fails once the person turned on two-factor sign-in", async () => {
    const token = await linkFor("owner");
    await owner.query(`UPDATE "user" SET two_factor_enabled = true WHERE id = $1`, [U.owner]);
    try {
      expect((await openLink(token)).location).toBe(`${SITE}/sign-in?error=INVALID_TOKEN`);
      expect(await sessions(U.owner)).toBe(0);
    } finally {
      await owner.query(`UPDATE "user" SET two_factor_enabled = false WHERE id = $1`, [U.owner]);
    }
  });
});
