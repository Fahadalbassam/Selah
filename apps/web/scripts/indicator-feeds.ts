// Read every connected sheet that is due (once a day) and save its figures
// as the person who connected it (indicator data).
// Usage: npm run job:indicator-feeds
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Tx } from "../src/db/client";
import * as schema from "../src/db/schema";
import { runIndicatorFeeds } from "../src/jobs/indicator-feeds";

const need = (k: string) =>
  process.env[k] ??
  (() => {
    throw new Error(`${k} is not set`);
  })();
const owner = new Pool({ connectionString: need("DATABASE_OWNER_URL"), max: 1 });
const app = drizzle(new Pool({ connectionString: need("DATABASE_APP_URL"), max: 1 }), { schema });

const asUser = <T>(userId: string, fn: (tx: Tx) => Promise<T>) =>
  app.transaction(async (tx) => {
    await tx.execute(sql`select set_config('selah.user_id', ${userId}, true)`);
    return fn(tx as unknown as Tx);
  });

const out = await runIndicatorFeeds(owner, asUser);
await owner.end();
await app.$client.end();
console.log(`indicator sheets: ${out.read} read, ${out.failed} failed, ${out.added} figures added or corrected`);
