// One small firm for the batch 0 screen-bug tests (tests/db/screen-*.test.ts):
// a client that signs in (Acme), a client the firm runs (Waha, no accounts),
// a client whose only project is closing (Rawdah-like, no assistant, no
// indicators), another client a consultant works for alone, and a pitch.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

export const owner = new Pool({ connectionString: ownerUrl, max: 2 });
export const app = new Pool({ connectionString: appUrl, max: 3 });

const id = (n: number) => `00000000-0000-4000-b5b5-${String(n).padStart(12, "0")}`;
export const FIRM = id(1);
export const ACME = id(2); // full: its people sign in
export const WAHA = id(3); // consultant-managed: no accounts, the firm records for it
export const RAWDAH = id(4); // full, its only project closing, no indicators, no assistant
export const OTHER = id(5); // a client only `outsider` works for
export const MADAR = id(6); // a prospect: the pitch
export const U = {
  admin: id(11), // firm admin, watches Acme and Waha
  lead: id(12), // Acme's lead consultant, staffed on no project
  cons: id(13), // staffed on Acme's main project
  outsider: id(14), // staffed on Other's project only
  wlead: id(15), // Waha's and Rawdah's lead, staffed on Waha's project
  cadmin: id(16), // Acme's client admin
  cmgr: id(17), // Acme's client manager, on the main project
  cowner: id(18), // Acme's action owner, on the main project
  radmin: id(19), // Rawdah's client admin
};
export const P = { acme: id(21), acme2: id(22), waha: id(23), rawdah: id(24), other: id(25), pitch: id(26) };
export const REC = { acme: id(31), waha: id(32), rawdah: id(33) };
let n = 100;
export const next = () => id(++n);

export async function as<T>(userId: string, fn: (c: PoolClient) => Promise<T>, commit = false): Promise<T> {
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

/** A service call as `userId`, in one transaction; `before` runs first in it (a session setting, say). */
export const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>, opts: { commit?: boolean; before?: (c: PoolClient) => Promise<unknown> } = {}) =>
  as(
    userId,
    async (c) => {
      await opts.before?.(c);
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!).catch((e: Error & { cause?: Error }) => {
        throw new Error(e.cause ? `${e.message} | ${e.cause.message}` : e.message);
      });
    },
    opts.commit ?? false,
  );

/** An action written directly (as the schema owner), in any state. */
export async function action(fields: { project?: string; rec?: string; org?: string; status?: string; due?: string | null; owner?: string | null; ownerName?: string; closure?: string }) {
  const aid = next();
  await owner.query(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, owner_name, status, due_date, closure_outcome, created_by)
     VALUES ($1,$2,$3,$4,'Sign the charter',$5,$6,$7,$8,$9,$10)`,
    [
      aid,
      fields.project ?? P.acme,
      fields.org ?? ACME,
      fields.rec ?? REC.acme,
      fields.owner === undefined ? U.cowner : fields.owner,
      fields.ownerName ?? null,
      fields.status ?? "in_progress",
      fields.due ?? null,
      fields.closure ?? null,
      U.cons,
    ],
  );
  return aid;
}

export async function seed() {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode, prospect) VALUES
      ($1,'firm','firm',NULL,false), ($2,'client','Acme','full',false), ($3,'client','Waha','consultant_managed',false),
      ($4,'client','Rawdah','full',false), ($5,'client','Other','full',false), ($6,'client','Madar','full',true)`,
    [FIRM, ACME, WAHA, RAWDAH, OTHER, MADAR],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$10,'firm_admin'), ($2,$10,'consultant'), ($3,$10,'consultant'), ($4,$10,'consultant'), ($5,$10,'consultant'),
      ($6,$11,'client_admin'), ($7,$11,'client_manager'), ($8,$11,'action_owner'), ($9,$12,'client_admin')`,
    [U.admin, U.lead, U.cons, U.outsider, U.wlead, U.cadmin, U.cmgr, U.cowner, U.radmin, FIRM, ACME, RAWDAH],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$7,$12,'Acme governance','active',$13), ($2,'client',$7,$12,'Acme phase two','planned',$13),
      ($3,'client',$8,$12,'Waha family charter','active',$13), ($4,'client',$9,$12,'Rawdah plan','closing',$13),
      ($5,'client',$10,$12,'Other review','active',$13), ($6,'client',$11,$12,'Madar pitch','draft',$13)`,
    [P.acme, P.acme2, P.waha, P.rawdah, P.other, P.pitch, ACME, WAHA, RAWDAH, OTHER, MADAR, FIRM, U.admin],
  );
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES
      ($1,$5,true), ($1,$6,false), ($2,$7,true), ($3,$7,true), ($4,$8,true)`,
    [ACME, WAHA, RAWDAH, OTHER, U.lead, U.cons, U.wlead, U.outsider],
  );
  await q(
    `INSERT INTO project_members (project_id, user_id) VALUES ($1,$4), ($1,$5), ($1,$6), ($2,$7), ($3,$8)`,
    [P.acme, P.waha, P.other, U.cons, U.cmgr, U.cowner, U.wlead, U.outsider],
  );
  await q(`INSERT INTO watches (user_id, client_org_id) VALUES ($1,$2), ($1,$3)`, [U.admin, ACME, WAHA]);
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES
      ($1,$4,$7,'Adopt a board charter','shared',$10), ($2,$5,$8,'Write the family charter','shared',$10), ($3,$6,$9,'Adopt the plan','shared',$10)`,
    [REC.acme, REC.waha, REC.rawdah, P.acme, P.waha, P.rawdah, ACME, WAHA, RAWDAH, U.admin],
  );
}

export async function end() {
  await owner.end();
  await app.end();
}
