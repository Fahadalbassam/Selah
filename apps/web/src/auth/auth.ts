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

// Ten sign-ins per account per 15 minutes, from any address (src/auth/attempts.ts).
const signInsPerAccount = createAttemptLimiter({ max: 10, windowSeconds: 15 * 60 });

function createAuth() {
  const e = env();
  const production = e.NODE_ENV === "production";
  // Separate pool and database role: Better Auth can reach the auth tables
  // only, and the app role can never read password hashes or sessions.
  const authDb = drizzle(new Pool({ connectionString: e.DATABASE_AUTH_URL, max: 5 }));

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
    // refuses that too (drizzle/0032_two_factor_rules.sql); this hook gives
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
        if (ctx.path !== "/two-factor/disable") return;
        const s = await getSessionFromCtx(ctx);
        if (!s) return;
        const { rows } = await authDb.execute<{ required: boolean }>(
          sql`select app_requires_two_factor(${s.user.id}::uuid) as required`,
        );
        if (rows[0]?.required) throw new APIError("FORBIDDEN", { message: "two-factor sign-in is required for your role" });
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
