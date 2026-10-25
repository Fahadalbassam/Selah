// The firm admin's team load (F40): per colleague, the reviews they could do
// and the oldest one's wait, second sign-offs waiting on them, and the open
// work due on the projects they work on. Only the firm admin reads it.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { loadPrincipal } from "@/services/principal";
import { signOff } from "@/services/second-review";
import { teamLoad } from "@/services/team-load";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-a2f4-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const U = {
  admin: id(11),
  lead: id(12), // Acme's lead, not staffed on the project
  cons: id(13), // staffed on the Acme project
  cons2: id(14), // staffed on the Acme project
  obs: id(15), // observes the Acme project
  idle: id(16), // on nothing, not taking new clients
  cowner: id(17), // Acme action owner
  cmgr: id(18), // Acme client manager
};
const PROJ = id(31);
const CLOSED = id(32);
const REC = id(41);
const REC_CLOSED = id(42);
const INTERNAL = id(33);
const REC_INT = id(43);
let n = 100;
const next = () => id(++n);

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
const svc = <T>(userId: string, fn: (tx: Tx, p: Principal) => Promise<T>) =>
  as(userId, async (c) => {
    const tx = drizzle(c, { schema }) as unknown as Tx;
    return fn(tx, (await loadPrincipal(tx, userId))!);
  });

async function action(opts: { project?: string; rec?: string; org?: string; status?: string; due?: string | null; ownerId?: string }) {
  const aid = next();
  await owner.query(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
     VALUES ($1,$2,$3,$4,'Adopt the charter',$5,$6,$7::date,$8)`,
    [aid, opts.project ?? PROJ, opts.org ?? ACME, opts.rec ?? REC, opts.ownerId ?? U.cowner, opts.status ?? "in_progress", opts.due ?? null, U.cons],
  );
  return aid;
}
async function waiting(opts: { by?: string; days: number; project?: string; rec?: string; org?: string; ownerId?: string }) {
  const aid = await action(opts);
  const org = opts.org ?? ACME;
  const doc = next();
  const by = opts.by ?? U.cowner;
  await owner.query(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, storage_key, content_type, size_bytes, sha256, scan_status)
     VALUES ($1,$2,$3,$3,$4,'evidence','submitted','e.pdf','shared',$5,'application/pdf',1,'abc','clean')`,
    [doc, opts.project ?? PROJ, org, by, `k-${doc}`],
  );
  await owner.query(
    `INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by) VALUES ($1,$2,$3,$4,$5)`,
    [opts.project ?? PROJ, org, aid, doc, by],
  );
  await owner.query(`UPDATE actions SET status = 'awaiting_review' WHERE id = $1`, [aid]);
  await owner.query(`UPDATE actions SET awaiting_review_at = now() - make_interval(days => $2) WHERE id = $1`, [aid, opts.days]);
  return aid;
}
const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  const q = (text: string, params: unknown[] = []) => owner.query(text, params);
  await truncateAuditLog(owner);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme')`, [FIRM, ACME]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  for (const [uid, org, role] of [
    [U.admin, FIRM, "firm_admin"],
    [U.lead, FIRM, "consultant"],
    [U.cons, FIRM, "consultant"],
    [U.cons2, FIRM, "consultant"],
    [U.obs, FIRM, "consultant"],
    [U.idle, FIRM, "consultant"],
    [U.cowner, ACME, "action_owner"],
    [U.cmgr, ACME, "client_manager"],
  ])
    await q(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,$3)`, [uid, org, role]);
  await q(`INSERT INTO consultant_profiles (user_id, firm_org_id, accepting_new_clients) VALUES ($1,$2,false)`, [U.idle, FIRM]);
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state) VALUES
      ($1,'client',$3,$4,'Acme governance','active'), ($2,'client',$3,$4,'Acme phase 0','active'), ($5,'internal',$4,$4,'Methods','active')`,
    [PROJ, CLOSED, ACME, FIRM, INTERNAL],
  );
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES
      ($1,$2,true,false), ($1,$3,false,false), ($1,$4,false,false), ($1,$5,false,false)`,
    [ACME, U.lead, U.cons, U.cons2, U.obs],
  );
  await q(
    `INSERT INTO project_members (project_id, user_id, observer) VALUES
      ($1,$2,false), ($1,$3,false), ($1,$4,true), ($1,$5,false), ($1,$6,false), ($7,$2,false), ($8,$2,false), ($8,$3,false)`,
    [PROJ, U.cons, U.cons2, U.obs, U.cowner, U.cmgr, CLOSED, INTERNAL],
  );
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, priority, created_by) VALUES
      ($1,$3,$5,'Board charter','medium',$6), ($2,$4,$5,'Old work','medium',$6), ($7,$8,$9,'Templates','medium',$6)`,
    [REC, REC_CLOSED, PROJ, CLOSED, ACME, U.cons, REC_INT, INTERNAL, FIRM],
  );

  await waiting({ days: 5 }); // anyone on the team may review it
  // Internal work cons submitted and cons2 owns: neither reviews it.
  await waiting({ days: 2, by: U.cons, project: INTERNAL, rec: REC_INT, org: FIRM, ownerId: U.cons2 });
  await waiting({ days: 9, project: CLOSED, rec: REC_CLOSED }); // project closed below: nobody's
  // Two sign-offs: cons gives the first, so the second waits on the others.
  await owner.query(`INSERT INTO client_review_settings (client_org_id, rule) VALUES ($1,'all')`, [ACME]);
  const two = await waiting({ days: 1 });
  await svc(U.cons, (tx, p) => signOff(tx, p, two));
  await owner.query(`DELETE FROM client_review_settings`);
  await owner.query(`UPDATE actions SET second_review = true WHERE id = $1`, [two]);

  await action({ due: day(-3) }); // overdue
  await action({ due: day(3) }); // within 7 days
  await action({ due: day(20) }); // within 30 days
  await action({ due: day(60) }); // later
  await action({ due: day(-3), status: "verified_complete" }); // done: not counted
  await action({ due: day(-3), project: CLOSED, rec: REC_CLOSED });
  await owner.query(`UPDATE projects SET state = 'closed', closed_at = now() WHERE id = $1`, [CLOSED]);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("team load", () => {
  it("counts each colleague's reviews, the oldest wait, second sign-offs and work due", async () => {
    const load = await svc(U.admin, (tx, p) => teamLoad(tx, p));
    // The lead reaches every project of the client, without being staffed.
    expect(load.get(U.lead)).toMatchObject({ backlog: 2, oldestDays: 5, second: 1, overdue: 1, due7: 1, due30: 2, accepting: true });
    // cons submitted one round and signed another: those aren't theirs.
    expect(load.get(U.cons)).toMatchObject({ backlog: 1, oldestDays: 5, second: 0, overdue: 1, due7: 1, due30: 2 });
    // cons2 owns the internal action: not theirs either.
    expect(load.get(U.cons2)).toMatchObject({ backlog: 2, oldestDays: 5, second: 1 });
    // An observer reviews nothing and owns no deadlines.
    expect(load.get(U.obs)).toMatchObject({ backlog: 0, oldestDays: null, second: 0, overdue: 0, due7: 0, due30: 0 });
    expect(load.get(U.idle)).toMatchObject({ backlog: 0, accepting: false });
    // Clients are not on the firm's team.
    expect(load.has(U.cowner)).toBe(false);
    expect(load.has(U.cmgr)).toBe(false);
  });

  it("only the firm admin reads it", async () => {
    for (const who of [U.lead, U.cons, U.cmgr]) {
      await expect(svc(who, (tx, p) => teamLoad(tx, p))).rejects.toThrow();
    }
  });
});
