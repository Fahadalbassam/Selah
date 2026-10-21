import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/env";
import { account, session, twoFactor as twoFactorTable, user, verification } from "@/db/schema/auth";

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
        "/sign-in/email": { window: 60, max: 5 },
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
    // MFA for firm staff (spec: "if feasible"). Enforcement per role is
    // done in services/principal.ts once the team confirms it.
    plugins: [twoFactor({ issuer: "Selah" }), nextCookies()],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

export function auth() {
  instance ??= createAuth();
  return instance;
}
