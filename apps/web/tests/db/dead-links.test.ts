// The pages that mail links open find out when they load whether their link
// is dead, instead of after a password is typed twice or a button is pressed.
// Against a real Postgres and the real Better Auth setup, for each kind of
// link (invitation, address change, password reset): a live link reads as
// live, an expired, used, withdrawn, unknown or malformed one reads as dead
// with one and the same answer, and the check itself uses nothing up.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... TEST_DATABASE_AUTH_URL=... npm run test:db
import { createHash, randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
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

const id = (n: number) => `00000000-0000-4000-f2d0-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const U = { admin: id(11), cadmin: id(12), cmgr: id(13), owner: id(14) };
const mail = (name: keyof typeof U) => `${name}@example.test`;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
/** A link token shaped like the ones the app mails: 32 random bytes, base64url. */
const newToken = () => randomBytes(32).toString("base64url");

/** As a signed-out visitor: the app role with no user set, the way the pages read. */
async function anonymous<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(drizzle(c, { schema }) as unknown as Tx);
    await c.query("COMMIT");
    return out;
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    c.release();
  }
}
/** As a signed-in person, committed. */
async function as(userId: string, sql: string, params: unknown[] = []) {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    const out = await c.query(sql, params);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
const row = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows[0];

let handler: (req: Request) => Promise<Response>;
let onboarding: typeof import("@/services/onboarding");
let resetLinks: typeof import("@/auth/reset-links");
let ip = 0;
const post = (path: string, body: unknown) =>
  handler(
    new Request(`${SITE}/api/auth${path}`, {
      method: "POST",
      headers: { origin: SITE, "x-forwarded-for": `10.9.0.${++ip % 250}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name, status) VALUES ($1,'firm','Firm','active'), ($2,'client','Acme','active')`, [FIRM, ACME]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, $2, $3, true)`, [uid, name, mail(name as keyof typeof U)]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role, active) VALUES
      ($1,$5,'firm_admin',true), ($2,$6,'client_admin',true), ($3,$6,'client_manager',true), ($4,$6,'action_owner',true)`,
    [U.admin, U.cadmin, U.cmgr, U.owner, FIRM, ACME],
  );
  const { auth } = await import("@/auth/auth");
  handler = (req) => auth().handler(req);
  onboarding = await import("@/services/onboarding");
  resetLinks = await import("@/auth/reset-links");
});

beforeEach(async () => {
  await owner.query(`TRUNCATE outbound_emails, session, verification, invitations, email_changes`);
  await truncateAuditLog(owner);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("an invitation link", () => {
  const invite = async (email: string) => {
    const token = newToken();
    await as(U.cadmin, `INSERT INTO invitations (org_id, email, name, role, token_hash, invited_by, expires_at) VALUES ($1,$2,'New',$3,$4,$5,now())`, [
      ACME,
      email,
      "action_owner",
      hash(token),
      U.cadmin,
    ]);
    return token;
  };
  const open = (token: string) => anonymous((tx) => onboarding.findInvitation(tx, token));
  /** The database's side of accepting: the account already exists with the invited address. */
  const accept = async (token: string, person: string) => {
    const c = await app.connect();
    try {
      await c.query(`SELECT app_accept_invitation($1, $2)`, [hash(token), person]);
    } finally {
      c.release();
    }
  };

  it("reads as live, as often as the page is loaded, and reading it changes nothing", async () => {
    const token = await invite("new@example.test");
    const before = await row(`SELECT to_jsonb(i) AS j FROM invitations i WHERE email = 'new@example.test'`);
    for (let i = 0; i < 3; i++) {
      expect(await open(token)).toEqual({ email: "new@example.test", name: "New", role: "action_owner", orgName: "Acme", orgNameAr: null });
    }
    expect(await row(`SELECT to_jsonb(i) AS j FROM invitations i WHERE email = 'new@example.test'`)).toEqual(before);
    // Still good for the real thing afterwards.
    const person = id(90);
    await owner.query(`INSERT INTO "user" (id, name, email) VALUES ($1, 'New', 'new@example.test')`, [person]);
    await accept(token, person);
    expect((await row(`SELECT role FROM org_memberships WHERE user_id = $1`, [person])).role).toBe("action_owner");
    expect(await open(token)).toBeNull();
  });

  it("reads as dead once it is accepted, revoked or expired, or when its client is no longer active", async () => {
    const used = await invite("used@example.test");
    const person = id(91);
    await owner.query(`INSERT INTO "user" (id, name, email) VALUES ($1, 'Used', 'used@example.test')`, [person]);
    await accept(used, person);
    expect(await open(used)).toBeNull();

    const revoked = await invite("revoked@example.test");
    await as(U.cadmin, `UPDATE invitations SET revoked_at = now() WHERE email = 'revoked@example.test'`);
    expect(await open(revoked)).toBeNull();

    const expired = await invite("expired@example.test");
    await owner.query(`UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE email = 'expired@example.test'`);
    expect(await open(expired)).toBeNull();

    const archived = await invite("later@example.test");
    await owner.query(`UPDATE organizations SET status = 'archived' WHERE id = $1`, [ACME]);
    expect(await open(archived)).toBeNull();
    await owner.query(`UPDATE organizations SET status = 'active' WHERE id = $1`, [ACME]);
    expect(await open(archived)).not.toBeNull();
  });

  it("reads as dead when it is unknown or malformed, without asking the database for a malformed one", async () => {
    expect(await open(newToken())).toBeNull();
    for (const bad of ["", "x", "short-token", `${newToken()}x`, "../../api/auth/sign-out", "a".repeat(42) + "!"]) {
      expect(onboarding.isAccountLinkToken(bad)).toBe(false);
      expect(await open(bad)).toBeNull();
    }
  });
});

describe("an address-change link", () => {
  const request = async (target: string, email: string) => {
    const token = newToken();
    await as(U.cadmin, `INSERT INTO email_changes (user_id, new_email, token_hash, requested_by, old_email, expires_at) VALUES ($1,$2,$3,$4,'',now())`, [
      target,
      email,
      hash(token),
      U.cadmin,
    ]);
    return token;
  };
  const isOpen = (token: string) => anonymous((tx) => onboarding.emailChangeIsOpen(tx, token));
  const state = async () => ({
    change: await row(`SELECT to_jsonb(e) AS j FROM email_changes e WHERE user_id = $1`, [U.cmgr]),
    email: (await row(`SELECT email FROM "user" WHERE id = $1`, [U.cmgr])).email,
    sessions: (await row(`SELECT count(*)::int AS n FROM session WHERE user_id = $1`, [U.cmgr])).n,
    mails: (await row(`SELECT count(*)::int AS n FROM outbound_emails`)).n,
    audit: (await row(`SELECT count(*)::int AS n FROM audit_log`)).n,
  });

  it("reads as live when the page loads, and loading the page confirms nothing", async () => {
    const token = await request(U.cmgr, "cmgr.new@example.test");
    await owner.query(`INSERT INTO session (token, expires_at, user_id) VALUES ('s-dead-links', now() + interval '1 hour', $1)`, [U.cmgr]);
    const before = await state();
    expect(before).toMatchObject({ email: mail("cmgr"), sessions: 1 });
    // A mail scanner, a reload, a language switch: the page asks every time.
    for (let i = 0; i < 3; i++) expect(await isOpen(token)).toBe(true);
    expect(await state()).toEqual(before);
    // The button still works afterwards, and only then does the account switch over.
    await anonymous((tx) => onboarding.confirmEmailChange(tx, token));
    expect(await state()).toMatchObject({ email: "cmgr.new@example.test", sessions: 0 });
    expect(await isOpen(token)).toBe(false);
    await owner.query(`UPDATE "user" SET email = $2 WHERE id = $1`, [U.cmgr, mail("cmgr")]);
  });

  it("reads as dead once it is cancelled or expired", async () => {
    const cancelled = await request(U.cmgr, "cmgr.two@example.test");
    expect(await isOpen(cancelled)).toBe(true);
    await as(U.cadmin, `UPDATE email_changes SET cancelled_at = now() WHERE user_id = $1`, [U.cmgr]);
    expect(await isOpen(cancelled)).toBe(false);

    const expired = await request(U.owner, "owner.new@example.test");
    expect(await isOpen(expired)).toBe(true);
    await owner.query(`UPDATE email_changes SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [U.owner]);
    expect(await isOpen(expired)).toBe(false);
    // The same four cases the confirm step refuses.
    const refused = { cause: { message: expect.stringMatching(/no longer valid/) } };
    await expect(anonymous((tx) => onboarding.confirmEmailChange(tx, expired))).rejects.toMatchObject(refused);
    await expect(anonymous((tx) => onboarding.confirmEmailChange(tx, cancelled))).rejects.toMatchObject(refused);
  });

  it("reads as dead when it is unknown or malformed", async () => {
    expect(await isOpen(newToken())).toBe(false);
    for (const bad of ["", "x", `${newToken()}x`, "../../api/auth/sign-out"]) expect(await isOpen(bad)).toBe(false);
  });

  it("answers yes or no only, to anyone, and never opens the table itself", async () => {
    const token = await request(U.cmgr, "cmgr.three@example.test");
    const direct = await app.query(`SELECT app_email_change_is_open($1) AS open`, [hash(token)]);
    expect(direct.rows).toEqual([{ open: true }]);
    // A visitor still cannot read whose change it is, or to which address.
    expect((await app.query(`SELECT * FROM email_changes`)).rows).toEqual([]);
    // Asking with the token instead of its hash finds nothing.
    expect((await app.query(`SELECT app_email_change_is_open($1) AS open`, [token])).rows).toEqual([{ open: false }]);
  });
});

describe("a password-reset link", () => {
  /** Ask for a reset the way the forgot-password form does, and take the token from the queued mail. */
  const askFor = async (email: string) => {
    const res = await post("/request-password-reset", { email, redirectTo: "/reset-password" });
    expect(res.status).toBe(200);
    const queued = await row(`SELECT link FROM outbound_emails WHERE kind = 'password_reset' AND to_email = $1 ORDER BY created_at DESC LIMIT 1`, [email]);
    return queued ? (queued.link as string).replace("/reset-password/", "") : null;
  };
  const stored = async () => (await row(`SELECT count(*)::int AS n FROM verification WHERE identifier LIKE 'reset-password:%'`)).n;

  it("reads as live when the page loads, and loading the page does not use it up", async () => {
    const token = (await askFor(mail("cmgr")))!;
    expect(resetLinks.isPasswordResetToken(token)).toBe(true);
    expect(await stored()).toBe(1);
    for (let i = 0; i < 3; i++) expect(await resetLinks.passwordResetIsOpen(token)).toBe(true);
    expect(await stored()).toBe(1);
    // The link still sets the password afterwards, once.
    const done = await post("/reset-password", { newPassword: "A-new-password-2026!", token });
    expect(done.status).toBe(200);
    expect(await stored()).toBe(0);
    expect(await resetLinks.passwordResetIsOpen(token)).toBe(false);
    const again = await post("/reset-password", { newPassword: "Another-password-2026!", token });
    expect(again.status).toBe(400);
  });

  it("reads as dead once it has expired", async () => {
    const token = (await askFor(mail("owner")))!;
    expect(await resetLinks.passwordResetIsOpen(token)).toBe(true);
    await owner.query(`UPDATE verification SET expires_at = now() - interval '1 minute' WHERE identifier = $1`, [`reset-password:${token}`]);
    expect(await resetLinks.passwordResetIsOpen(token)).toBe(false);
  });

  it("reads as dead when it is unknown or malformed, the same for an address with no account", async () => {
    // No account: the form answers the same, and no link exists to be alive.
    expect(await askFor("nobody@example.test")).toBeNull();
    expect(await stored()).toBe(0);
    expect(await resetLinks.passwordResetIsOpen("abcdefghijklmnopqrstuvwx")).toBe(false);
    for (const bad of ["", "x", "short", "has space in the middle!", "../../api/auth/sign-out", "a".repeat(129)]) {
      expect(resetLinks.isPasswordResetToken(bad)).toBe(false);
      expect(await resetLinks.passwordResetIsOpen(bad)).toBe(false);
    }
  });

  it("does not count toward any limit: the page can be loaded far more often than the reset may be tried", async () => {
    const token = (await askFor(mail("cmgr")))!;
    // Better Auth allows 5 tries a minute on /reset-password from one address; the check is not one of them.
    for (let i = 0; i < 12; i++) expect(await resetLinks.passwordResetIsOpen(token)).toBe(true);
    const res = await handler(
      new Request(`${SITE}/api/auth/reset-password`, {
        method: "POST",
        headers: { origin: SITE, "x-forwarded-for": "10.9.9.9", "content-type": "application/json" },
        body: JSON.stringify({ newPassword: "A-new-password-2026!", token }),
      }),
    );
    expect(res.status).toBe(200);
  });
});
