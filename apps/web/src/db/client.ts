import "server-only";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/env";
import * as schema from "./schema";

// Only src/services and src/server may import this module (enforced by
// ESLint). Pages and components never touch the database.

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

let appDb: Db | undefined;

function db(): Db {
  appDb ??= drizzle(new Pool({ connectionString: env().DATABASE_APP_URL, max: 10 }), { schema });
  return appDb;
}

/**
 * Run `fn` in one transaction as `userId`. The id is set with set_config(...,
 * true), which lasts only for this transaction, so a pooled connection never
 * carries one user's identity into another request. Every row-level security
 * policy keys on it.
 */
export async function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('selah.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * For writes that must survive a rolled-back request, such as recording a
 * denied attempt in the audit log. Runs as the app role with no user set, so
 * RLS allows nothing except inserts into audit_log.
 */
export async function asAnonymous<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().transaction(fn);
}
