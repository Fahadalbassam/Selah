import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/env";
import { accountKey, createAttemptLimiter } from "@/auth/attempts";
import { account, session, twoFactor as twoFactorTable, user, verification } from "@/db/schema/auth";
import { auditDetached } from "@/services/audit";

// Ten sign-ins per account per 15 minutes, from any address (src/auth/attempts.ts).
// Anyone who knows an address can use this to lock the account for the rest
// of the window (the price of a cap that can't be dodged), so each lockout is
// recorded in the audit log under the account, never the address.
const signInsPerAccount = createAttemptLimiter({ max: 10, windowSeconds: 15 * 60, onLock: (email) => void recordLockout(email) });

// Better Auth's own pool (set in createAuth()), the only role that may read accounts by address.
let accountsDb: ReturnType<typeof drizzle> | undefined;

async function recordLockout(email: string) {
  if (!accountsDb) return;
  try {
    const { rows } = await accountsDb.execute<{ id: string }>(sql`select id from "user" where lower(email) = ${email}`);
    await auditDetached({
      actorId: null,
      action: "auth.sign_in.locked",
      resourceType: "user",
      resourceId: rows[0]?.id,
      outcome: "deny",
      reason: "too many sign-in attempts",
      meta: { knownAccount: !!rows[0] },
    });
  } catch {
    // Recording must never break signing in.
  }
}

const ipOf = (headers: Headers | undefined) => headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

/**
 * Sign-in, two-factor and password events in the audit log (R2), under the
 * account's id, never the address typed. A failed sign-in to an address with
 * no account is recorded without one. Recording never breaks signing in.
 */
async function recordAuthEvent(entry: {
  action: string;
  outcome: "allow" | "deny";
  actorId?: string | null;
  email?: unknown;
  ip: string | null;
  meta?: Record<string, string | number | boolean | null>;
}) {
  try {
    let resourceId: string | undefined;
    if (!entry.actorId && accountsDb) {
      const key = accountKey(entry.email);
      if (key) {
        const { rows } = await accountsDb.execute<{ id: string }>(sql`select id from "user" where lower(email) = ${key}`);
        resourceId = rows[0]?.id;
      }
    }
    await auditDetached({
      actorId: entry.actorId ?? null,
      action: entry.action,
      resourceType: "user",
      resourceId: entry.actorId ?? resourceId,
      outcome: entry.outcome,
      ip: entry.ip,
      meta: entry.meta,
    });
  } catch {
    // Recording must never break signing in.
  }
}

const TWO_FACTOR_CHECKS = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code", "/two-factor/verify-otp"]);

function createAuth() {
  const e = env();
  const production = e.NODE_ENV === "production";
  // Separate pool and database role: Better Auth can reach the auth tables
  // only, and the app role can never read password hashes or sessions.
  const authDb = drizzle(new Pool({ connectionString: e.DATABASE_AUTH_URL, max: 5 }));
  accountsDb = authDb;

  return betterAuth({
    appName: "Selah",
    baseURL: e.APP_URL,
    secret: e.BETTER_AUTH_SECRET,
    trustedOrigins: [e.APP_URL],
    database: drizzleAdapter(authDb, {
      provider: "pg",
      schema: { user, session, account, verification, twoFactor: twoFactorTable },
    }),
    // Invite-only (ASVS V6): nobody can sign themselves up. Accounts are
    // created by an admin flow or the seed script. Passwords are hashed with
    // scrypt by Better Auth.
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      // Password reset (ASVS V6.4): the link goes through the mail queue,
      // never in the response, and only to people with an active membership
      // (app_queue_password_reset decides, and caps it at three an hour).
      // The answer is the same whether the address exists or not. A reset
      // ends every session and mails a notice; 2FA still applies after it.
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        await authDb.execute(sql`select app_queue_password_reset(${user.id}::uuid, ${token})`);
      },
      onPasswordReset: async ({ user }) => {
        await authDb.execute(sql`select app_password_was_reset(${user.id}::uuid)`);
      },
    },
    // Server-side sessions (ASVS V7): 8 hour lifetime, refreshed while active,
    // and a fresh sign-in needed for sensitive changes after 10 minutes.
    session: {
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 30,
      freshAge: 60 * 10,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        // Per address. An office behind one address shares it, so it is
        // looser than the per-account limit in the hook below.
        "/sign-in/email": { window: 60, max: 20 },
        "/two-factor/*": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
        "/reset-password": { window: 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: "selah",
      useSecureCookies: production,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: production },
      database: { generateId: "uuid" },
    },
    // Two-factor sign-in (TOTP). Firm admins, consultants and client admins
    // must use it: src/server/http.ts and page.ts refuse them everything but
    // /security until it is on, and they can't switch it off. The database
    // refuses that too (baseline: Two-factor); this hook gives
    // a clear answer instead of an error.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/email") {
          const key = accountKey((ctx.body as { email?: unknown } | undefined)?.email);
          const wait = key ? signInsPerAccount.take(key) : null;
          if (wait !== null) {
            throw new APIError("TOO_MANY_REQUESTS", { message: "too many sign-in attempts" }, { "X-Retry-After": String(wait) });
          }
          return;
        }
        if (ctx.path === "/sign-out") {
          // Before the session is gone, so the event has its person.
          const s = await getSessionFromCtx(ctx).catch(() => null);
          if (s) await recordAuthEvent({ action: "auth.sign_out", outcome: "allow", actorId: s.user.id, ip: ipOf(ctx.headers) });
          return;
        }
        if (ctx.path !== "/two-factor/disable") return;
        const s = await getSessionFromCtx(ctx);
        if (!s) return;
        const { rows } = await authDb.execute<{ required: boolean }>(
          sql`select app_requires_two_factor(${s.user.id}::uuid) as required`,
        );
        if (rows[0]?.required) throw new APIError("FORBIDDEN", { message: "two-factor sign-in is required for your role" });
      }),
      after: createAuthMiddleware(async (ctx) => {
        const failed = ctx.context.returned instanceof APIError;
        const ip = ipOf(ctx.headers);
        const signedIn = ctx.context.newSession?.user.id ?? null;
        if (ctx.path === "/sign-in/email") {
          const body = ctx.body as { email?: unknown } | undefined;
          if (failed) await recordAuthEvent({ action: "auth.sign_in.failed", outcome: "deny", email: body?.email, ip });
          else if (signedIn) await recordAuthEvent({ action: "auth.sign_in", outcome: "allow", actorId: signedIn, ip });
          // Right password, two-factor code still to come.
          else await recordAuthEvent({ action: "auth.sign_in.password_ok", outcome: "allow", email: body?.email, ip });
          return;
        }
        if (TWO_FACTOR_CHECKS.has(ctx.path)) {
          const method = ctx.path.split("/").pop()!;
          const s = signedIn ? null : await getSessionFromCtx(ctx).catch(() => null);
          const actorId = signedIn ?? s?.user.id ?? null;
          await recordAuthEvent({
            action: failed ? "auth.two_factor.failed" : "auth.two_factor.verified",
            outcome: failed ? "deny" : "allow",
            actorId,
            ip,
            meta: { method },
          });
          return;
        }
        if (ctx.path === "/two-factor/enable" || ctx.path === "/two-factor/disable" || ctx.path === "/change-password") {
          const s = await getSessionFromCtx(ctx).catch(() => null);
          if (!s) return;
          const action =
            ctx.path === "/change-password" ? "auth.password.changed" : ctx.path === "/two-factor/enable" ? "auth.two_factor.enable" : "auth.two_factor.disable";
          await recordAuthEvent({ action, outcome: failed ? "deny" : "allow", actorId: s.user.id, ip });
        }
      }),
    },
    plugins: [twoFactor({ issuer: "Selah" }), nextCookies()],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

export function auth() {
  instance ??= createAuth();
  return instance;
}
