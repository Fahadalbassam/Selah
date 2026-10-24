// A client leaving (baseline: Offboarding, 0025; full picture item 27) against
// a real Postgres: who archives, that every project must be closed first,
// read-only access in the grace period and none after, restoring with a
// reason, legal holds, and the purge after retention with its deletion
// record. No other client sees any of it.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authorize, type Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { CLIENT_FROZEN_TABLES, DELETION_COUNTS, GRACE_DAYS, RETENTION_YEARS } from "@/lib/offboarding";
import { requestClosure } from "@/services/closure";
import { archiveClient, getOffboarding, myOffboarding, placeLegalHold, releaseLegalHold, restoreClient } from "@/services/offboarding";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c270-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const PITCH = id(4); // never signed
const U = {
  admin: id(11),
  lead: id(12), // Acme's lead consultant
  other: id(13), // a consultant not on Acme
  cadmin: id(15),
  cmgr: id(16),
  betaMgr: id(19),
};
const DONE = id(21); // Acme, closed
const OPEN = id(22); // Acme, active until a test closes it
const DRAFT = id(23); // Acme, a draft
const BETA_PROJ = id(24);
const PITCH_DRAFT = id(25);

async function as<T>(userId: string | null, fn: (c: PoolClient) => Promise<T>, commit = false): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    if (userId) await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
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
const run = (userId: string, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params), true);
const principal = (userId: string) => as(userId, (c) => loadPrincipal(drizzle(c, { schema }) as unknown as Tx, userId));
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    true,
  );
const status = async (oid: string) => (await owner.query(`SELECT status::text AS s FROM organizations WHERE id = $1`, [oid])).rows[0]?.s as string | undefined;
const project = (pid: string, org: string, title: string, state: string) =>
  owner.query(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,$4,$5,$6)`, [
    pid,
    org,
    FIRM,
    title,
    state,
    U.admin,
  ]);

/** Acme back to active, with one closed, one active and one draft project. */
async function reset() {
  await owner.query(`DELETE FROM client_offboardings`);
  await owner.query(`DELETE FROM legal_holds`);
  await owner.query(`DELETE FROM notifications`);
  await owner.query(`DELETE FROM outbound_emails`);
  await owner.query(`UPDATE organizations SET status = 'active' WHERE id IN ($1, $2)`, [ACME, BETA]);
  await owner.query(`DELETE FROM projects WHERE org_id = $1`, [ACME]);
  await owner.query(`DELETE FROM invitations WHERE org_id = $1`, [ACME]);
  await project(DONE, ACME, "Acme governance", "active");
  await owner.query(`UPDATE projects SET state = 'closed' WHERE id = $1`, [DONE]);
  await project(OPEN, ACME, "Acme strategy", "active");
  await project(DRAFT, ACME, "Acme pitch", "draft");
  await owner.query(`INSERT INTO invitations (org_id, email, name, role, invited_by, token_hash, expires_at) VALUES ($1,'new@acme.test','New','client_manager',$2,repeat('a', 64),now() + interval '7 days')`, [
    ACME,
    U.cadmin,
  ]);
}
const closeOpen = () => owner.query(`UPDATE projects SET state = 'closed' WHERE id = $1`, [OPEN]);
const archive = (graceDays = 30) => svc(U.admin, (tx, p) => archiveClient(tx, p, ACME, { graceDays, note: "Contract ended in October" }));

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`DELETE FROM client_deletions`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta'), ($4,'client','Pitch Co')`, [
    FIRM,
    ACME,
    BETA,
    PITCH,
  ]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$7,'firm_admin'), ($2,$7,'consultant'), ($3,$7,'consultant'), ($4,$8,'client_admin'), ($5,$8,'client_manager'), ($6,$9,'client_manager')`,
    [U.admin, U.lead, U.other, U.cadmin, U.cmgr, U.betaMgr, FIRM, ACME, BETA],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($3,$2,true)`, [ACME, U.lead, BETA]);
  await project(BETA_PROJ, BETA, "Beta strategy", "active");
  await project(PITCH_DRAFT, PITCH, "Pitch", "draft");
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [BETA_PROJ, U.betaMgr]);
});

beforeEach(reset);

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("archiving", () => {
  it("only the firm admin archives; the lead consultant and the client cannot", async () => {
    await closeOpen();
    for (const who of [U.lead, U.cadmin]) {
      await expect(svc(who, (tx, p) => archiveClient(tx, p, ACME, { graceDays: 30 })), who).rejects.toThrow();
      await expect(run(who, `SELECT app_archive_client($1, 30, NULL)`, [ACME]), who).rejects.toThrow(/firm admin|no such client/);
    }
    expect(await status(ACME)).toBe("active");
  });

  it("waits until every project is closed, and lists what is still open", async () => {
    const view = await svc(U.admin, (tx, p) => getOffboarding(tx, p, ACME));
    expect(view.blockers).toEqual([{ projectId: OPEN, title: "Acme strategy", state: "active" }]);
    expect(view.drafts).toEqual([{ id: DRAFT, title: "Acme pitch" }]);
    expect(view.can.archive).toBe(false);
    await expect(run(U.admin, `SELECT app_archive_client($1, 30, NULL)`, [ACME])).rejects.toThrow(/close every project first \(1 open\)/);
    // Nobody else learns what blocks it.
    expect((await as(U.lead, (c) => c.query(`SELECT * FROM app_archive_blockers($1)`, [ACME]))).rows).toEqual([]);
    expect((await as(U.cadmin, (c) => c.query(`SELECT * FROM app_archive_blockers($1)`, [ACME]))).rows).toEqual([]);
  });

  it("refuses a client that never signed: that one is deleted instead", async () => {
    await expect(run(U.admin, `SELECT app_archive_client($1, 30, NULL)`, [PITCH])).rejects.toThrow(/never signed: delete it instead/);
    expect((await svc(U.admin, (tx, p) => getOffboarding(tx, p, PITCH))).can.archive).toBe(false);
  });

  it("keeps the grace period within 0 to 90 days", async () => {
    await closeOpen();
    await expect(run(U.admin, `SELECT app_archive_client($1, $2, NULL)`, [ACME, GRACE_DAYS.max + 1])).rejects.toThrow(/0 to 90 days/);
    await expect(run(U.admin, `SELECT app_archive_client($1, -1, NULL)`, [ACME])).rejects.toThrow(/0 to 90 days/);
  });

  it("archives: drafts deleted, invitations revoked, retention set, the client's admins told", async () => {
    await closeOpen();
    const view = await archive(30);
    expect(view.archived).toBe(true);
    expect(view.current).toMatchObject({ draftsDeleted: 1, inGrace: true, archivedBy: "admin", note: "Contract ended in October" });
    const { rows } = await owner.query(
      `SELECT retain_until::text AS r, (app_firm_today() + make_interval(years => $2))::date::text AS want,
              grace_until > now() + interval '29 days' AND grace_until < now() + interval '31 days' AS grace
       FROM client_offboardings WHERE org_id = $1`,
      [ACME, RETENTION_YEARS],
    );
    expect(rows[0].r).toBe(rows[0].want);
    expect(rows[0].grace).toBe(true);
    expect(await status(ACME)).toBe("archived");
    expect((await owner.query(`SELECT 1 FROM projects WHERE id = $1`, [DRAFT])).rowCount).toBe(0);
    expect((await owner.query(`SELECT 2 FROM projects WHERE id IN ($1, $2)`, [DONE, OPEN])).rowCount).toBe(2);
    expect((await owner.query(`SELECT revoked_at FROM invitations WHERE org_id = $1`, [ACME])).rows[0].revoked_at).not.toBeNull();
    expect((await owner.query(`SELECT user_id FROM notifications WHERE kind = 'client.archived'`)).rows).toEqual([{ user_id: U.cadmin }]);
    expect((await owner.query(`SELECT to_email FROM outbound_emails WHERE kind = 'client.archived'`)).rows).toEqual([{ to_email: "cadmin@example.test" }]);
    // Archiving twice is refused.
    await expect(run(U.admin, `SELECT app_archive_client($1, 30, NULL)`, [ACME])).rejects.toThrow(/already archived/);
  });

  it("changes an organization's status only through archiving and restoring", async () => {
    await expect(run(U.admin, `UPDATE organizations SET status = 'archived' WHERE id = $1`, [ACME])).rejects.toThrow(/from its page/);
    await expect(run(U.admin, `INSERT INTO organizations (kind, name, status) VALUES ('client', 'Gamma', 'archived')`)).rejects.toThrow(/starts active/);
    await closeOpen();
    await archive();
    await expect(run(U.admin, `UPDATE organizations SET name = 'Acme Renamed' WHERE id = $1`, [ACME])).rejects.toThrow(/archived; the firm admin can restore it/);
  });
});

describe("the grace period", () => {
  it("lets the client's people sign in and read, never write", async () => {
    await closeOpen();
    await archive(30);
    const p = (await principal(U.cadmin))!;
    expect(p).not.toBeNull();
    expect(p.readOnly).toBe(true);
    const doneResource = { type: "project" as const, orgId: ACME, firmOrgId: FIRM, projectId: DONE, projectKind: "client" as const, projectState: "closed" as const };
    expect(authorize(p, "project.read", doneResource).allowed).toBe(true);
    expect(authorize(p, "closure.request", { ...doneResource, projectState: "active" }).reason).toBe("org:archived");
    expect(await svc(U.cadmin, (tx, pr) => myOffboarding(tx, pr))).toMatchObject({ graceUntil: expect.any(Date) });
    expect((await as(U.cadmin, (c) => c.query(`SELECT id FROM projects ORDER BY title`))).rows.map((r) => r.id)).toEqual([DONE, OPEN]);
    await expect(svc(U.cadmin, (tx, pr) => requestClosure(tx, pr, DONE, { note: "x" }))).rejects.toThrow();
    // The database refuses client-level writes from anyone, the firm included.
    await expect(run(U.cadmin, `INSERT INTO client_contacts (org_id, name) VALUES ($1, 'New contact')`, [ACME])).rejects.toThrow(/archived/);
    await expect(run(U.admin, `INSERT INTO client_contacts (org_id, name) VALUES ($1, 'New contact')`, [ACME])).rejects.toThrow(/archived/);
    await expect(run(U.admin, `INSERT INTO projects (kind, org_id, firm_org_id, title, created_by) VALUES ('client',$1,$2,'New',$3)`, [ACME, FIRM, U.admin])).rejects.toThrow();
    await expect(run(U.admin, `SELECT app_reopen_project($1, 'One more step')`, [DONE])).rejects.toThrow(/archived; the firm admin can restore it/);
    // Their password can still be reset while they can sign in.
    expect((await owner.query(`SELECT app_can_reset_password($1) AS ok`, [U.cadmin])).rows[0].ok).toBe(true);
  });

  it("ends: no access after the grace period, or at once with none", async () => {
    await closeOpen();
    await archive(0);
    expect(await principal(U.cadmin)).toBeNull();
    expect(await principal(U.cmgr)).toBeNull();
    expect((await as(U.cadmin, (c) => c.query(`SELECT app_org() AS o`))).rows[0].o).toBeNull();
    expect((await owner.query(`SELECT app_can_reset_password($1) AS ok`, [U.cadmin])).rows[0].ok).toBe(false);
    // No grace, no mail; the notice still waits in Selah.
    expect((await owner.query(`SELECT 1 FROM outbound_emails WHERE kind = 'client.archived'`)).rowCount).toBe(0);
    // The firm keeps reading the archived client.
    expect((await as(U.lead, (c) => c.query(`SELECT id FROM projects WHERE org_id = $1`, [ACME]))).rowCount).toBe(2);
    expect((await svc(U.lead, (tx, p) => getOffboarding(tx, p, ACME))).archived).toBe(true);
  });
});

describe("restoring", () => {
  it("the firm admin restores with a reason; the history stays", async () => {
    await closeOpen();
    await archive();
    await expect(svc(U.lead, (tx, p) => restoreClient(tx, p, ACME, { reason: "Signed a new phase" }))).rejects.toThrow();
    await expect(run(U.admin, `SELECT app_restore_client($1, 'no')`, [ACME])).rejects.toThrow(/say why/);
    const view = await svc(U.admin, (tx, p) => restoreClient(tx, p, ACME, { reason: "Signed a new phase" }));
    expect(view.archived).toBe(false);
    expect(view.history).toEqual([expect.objectContaining({ restoredBy: "admin", restoreReason: "Signed a new phase" })]);
    expect(await status(ACME)).toBe("active");
    expect((await principal(U.cadmin))!.readOnly).toBe(false);
    expect((await owner.query(`SELECT 1 FROM notifications WHERE kind = 'client.restored' AND user_id = $1`, [U.cadmin])).rowCount).toBe(1);
    await expect(run(U.admin, `SELECT app_restore_client($1, 'Again please')`, [ACME])).rejects.toThrow(/not archived/);
  });
});

describe("legal holds", () => {
  it("the firm admin places and releases them with reasons; they never change or disappear", async () => {
    await expect(svc(U.lead, (tx, p) => placeLegalHold(tx, p, ACME, { reason: "Dispute with a supplier" }))).rejects.toThrow();
    await expect(run(U.cadmin, `SELECT app_place_legal_hold($1, 'Dispute with a supplier')`, [ACME])).rejects.toThrow();
    await expect(run(U.admin, `SELECT app_place_legal_hold($1, 'x')`, [ACME])).rejects.toThrow(/say why/);
    const view = await svc(U.admin, (tx, p) => placeLegalHold(tx, p, ACME, { reason: "Dispute with a supplier" }));
    expect(view.holds).toEqual([expect.objectContaining({ reason: "Dispute with a supplier", placedBy: "admin", releasedAt: null })]);
    const hold = view.holds[0]!.id;
    await expect(run(U.admin, `UPDATE legal_holds SET reason = 'other' WHERE id = $1`, [hold])).rejects.toThrow();
    await expect(run(U.admin, `DELETE FROM legal_holds WHERE id = $1`, [hold])).rejects.toThrow();
    // Only the firm admin sees holds.
    for (const who of [U.lead, U.cadmin, U.betaMgr]) expect((await as(who, (c) => c.query(`SELECT * FROM legal_holds`))).rowCount, who).toBe(0);
    expect((await svc(U.lead, (tx, p) => getOffboarding(tx, p, ACME))).holds).toEqual([]);
    await expect(svc(U.admin, (tx, p) => releaseLegalHold(tx, p, BETA, hold, { reason: "Settled out of court" }))).rejects.toThrow();
    const after = await svc(U.admin, (tx, p) => releaseLegalHold(tx, p, ACME, hold, { reason: "Settled out of court" }));
    expect(after.holds[0]).toMatchObject({ releasedBy: "admin", releaseReason: "Settled out of court" });
    await expect(run(U.admin, `SELECT app_release_legal_hold($1, 'Settled twice')`, [hold])).rejects.toThrow(/already released/);
  });
});

describe("the purge after retention", () => {
  const purge = async (day: string) => (await owner.query(`SELECT app_purge_clients($1::date) AS n`, [day])).rows[0].n as number;

  it("waits for the retention date and for every hold to be released, then deletes and records it", async () => {
    await closeOpen();
    await archive();
    await owner.query(`INSERT INTO client_contacts (org_id, name) VALUES ($1, 'Board secretary')`, [ACME]).catch(() => undefined);
    const retain = (await owner.query(`SELECT retain_until::text AS d FROM client_offboardings WHERE org_id = $1`, [ACME])).rows[0].d as string;
    expect(await purge("2030-01-01")).toBe(0);
    await svc(U.admin, (tx, p) => placeLegalHold(tx, p, ACME, { reason: "Regulator inquiry" }));
    expect(await purge(retain)).toBe(0);
    expect(await status(ACME)).toBe("archived");
    const hold = (await owner.query(`SELECT id FROM legal_holds WHERE org_id = $1`, [ACME])).rows[0].id;
    await svc(U.admin, (tx, p) => releaseLegalHold(tx, p, ACME, hold, { reason: "Inquiry closed" }));

    expect(await purge(retain)).toBe(1);
    expect(await status(ACME)).toBeUndefined();
    expect((await owner.query(`SELECT 1 FROM projects WHERE org_id = $1`, [ACME])).rowCount).toBe(0);
    const record = (await owner.query(`SELECT name, retain_until::text AS r, counts FROM client_deletions WHERE org_id = $1`, [ACME])).rows[0];
    expect(record).toMatchObject({ name: "Acme", r: retain });
    expect(Object.keys(record.counts).sort()).toEqual([...DELETION_COUNTS].sort());
    expect(record.counts).toMatchObject({ projects: 2, people: 2 });
    // The client's people are erased; the firm and Beta are untouched.
    const people = (await owner.query(`SELECT id, email FROM "user" WHERE id IN ($1, $2, $3, $4)`, [U.cadmin, U.cmgr, U.lead, U.betaMgr])).rows;
    expect(people.find((r) => r.id === U.cadmin).email).toMatch(/@erased\.invalid$/);
    expect(people.find((r) => r.id === U.cmgr).email).toMatch(/@erased\.invalid$/);
    expect(people.find((r) => r.id === U.lead).email).toBe("lead@example.test");
    expect((await owner.query(`SELECT 1 FROM projects WHERE id = $1`, [BETA_PROJ])).rowCount).toBe(1);
    // Only the firm admin reads deletion records.
    expect((await as(U.admin, (c) => c.query(`SELECT * FROM client_deletions`))).rowCount).toBe(1);
    expect((await as(U.lead, (c) => c.query(`SELECT * FROM client_deletions`))).rowCount).toBe(0);

    // Put Acme back for the tests after this one.
    await owner.query(`INSERT INTO organizations (id, kind, name) VALUES ($1,'client','Acme')`, [ACME]);
    await owner.query(`UPDATE "user" SET email = name || '@example.test' WHERE id IN ($1, $2)`, [U.cadmin, U.cmgr]);
    await owner.query(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$3,'client_admin'), ($2,$3,'client_manager')`, [U.cadmin, U.cmgr, ACME]);
    await owner.query(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [ACME, U.lead]);
  });
});

describe("visibility and lists", () => {
  it("no other client or unassigned consultant sees an offboarding", async () => {
    await closeOpen();
    await archive();
    for (const who of [U.betaMgr, U.other]) {
      expect((await as(who, (c) => c.query(`SELECT * FROM client_offboardings`))).rowCount, who).toBe(0);
      await expect(svc(who, (tx, p) => getOffboarding(tx, p, ACME)), who).rejects.toThrow();
    }
    expect((await principal(U.betaMgr))!.readOnly).toBe(false);
  });

  it("freezes the same client tables the code lists", async () => {
    const { rows } = await owner.query(`SELECT c.relname AS t FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid WHERE g.tgname = 'client_open' ORDER BY 1`);
    expect(rows.map((r) => r.t)).toEqual([...CLIENT_FROZEN_TABLES]);
  });
});
