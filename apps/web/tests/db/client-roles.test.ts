// Client roles on a project (wave 1, item 6) against a real Postgres: who
// names them, who may hold them, single roles, contacts, the cross-tenant
// wall, and the sponsor at the last escalation level.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { addClientRole, listClientRoles, removeClientRole } from "@/services/client-roles";
import { getHandover } from "@/services/handover";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c100-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = {
  admin: id(11),
  lead: id(12), // Acme's lead consultant
  cons: id(13), // staffed on PROJ, not the lead
  cadmin: id(14),
  cmgr: id(15),
  cowner: id(16), // action owner
  betaAdmin: id(17),
  betaLead: id(18), // Beta's lead consultant, not Acme's
};
const PROJ = id(21);
const BETA_PROJ = id(22);
const INTERNAL = id(23);
const BOARD = id(31); // an Acme contact with no account
const BETA_CONTACT = id(32);
const REC = id(41);
let started: Date;

async function as<T>(userId: string, fn: (c: PoolClient) => Promise<T>, commit = false): Promise<T> {
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
const attempt = (userId: string, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params));
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    true,
  );
const add = (who: string, role: string, person: string, project = PROJ) =>
  svc(who, (tx, p) => addClientRole(tx, p, project, { role: role as never, person }));
/** A refusal from the database, wrapped by Drizzle. */
const db = (re: RegExp) => ({ cause: { message: expect.stringMatching(re) } });
const roles = async (who: string, project = PROJ) => (await svc(who, (tx, p) => listClientRoles(tx, p, project)))!;
const held = async () =>
  (await owner.query(`SELECT role, coalesce(user_id, contact_id) AS who FROM project_client_roles WHERE project_id = $1 ORDER BY role, 2`, [PROJ]))
    .rows;

beforeAll(async () => {
  started = new Date();
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [
    FIRM,
    ACME,
    BETA,
  ]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role, active) VALUES
      ($1,$9,'firm_admin',true), ($2,$9,'consultant',true), ($3,$9,'consultant',true), ($4,$10,'client_admin',true),
      ($5,$10,'client_manager',true), ($6,$10,'action_owner',true), ($7,$11,'client_admin',true), ($8,$9,'consultant',true)`,
    [U.admin, U.lead, U.cons, U.cadmin, U.cmgr, U.cowner, U.betaAdmin, U.betaLead, FIRM, ACME, BETA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$4,$6,'Acme governance','active',$7), ($2,'client',$5,$6,'Beta strategy','active',$7),
      ($3,'internal',$6,$6,'Firm handbook','active',$7)`,
    [PROJ, BETA_PROJ, INTERNAL, ACME, BETA, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($3,$4,true)`, [ACME, U.lead, BETA, U.betaLead]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4), ($5,$6), ($5,$7)`, [
    PROJ,
    U.cons,
    U.cmgr,
    U.cowner,
    BETA_PROJ,
    U.betaAdmin,
    U.betaLead,
  ]);
  await q(`INSERT INTO client_contacts (id, org_id, name, title) VALUES ($1,$3,'Board chair','Chair'), ($2,$4,'Beta CFO',null)`, [
    BOARD,
    BETA_CONTACT,
    ACME,
    BETA,
  ]);
  await q(`INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES ($1,$2,$3,'Charter',$4)`, [REC, PROJ, ACME, U.cons]);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("who names the client's roles", () => {
  it("the firm admin and the client's lead name accounts and contacts", async () => {
    await add(U.admin, "sponsor", `user:${U.cadmin}`);
    await add(U.lead, "observer", `contact:${BOARD}`);
    await add(U.lead, "steering", `user:${U.cowner}`);
    expect(await held()).toEqual([
      { role: "sponsor", who: U.cadmin },
      { role: "steering", who: U.cowner },
      { role: "observer", who: BOARD },
    ]);
    const firm = await roles(U.lead);
    expect(firm.can).toEqual({ manage: true, contacts: true });
    expect(firm.roles.map((r) => [r.role, r.name])).toEqual([
      ["sponsor", "cadmin"],
      ["steering", "cowner"],
      ["observer", "Board chair"],
    ]);
    expect(firm.people.find((p) => p.id === U.cowner)?.deciding).toBe(false);
    expect(firm.contacts.map((c) => c.id)).toEqual([BOARD]);
  });

  it("the client's admin names accounts only; others only read", async () => {
    await add(U.cadmin, "acceptor", `user:${U.cmgr}`);
    await expect(add(U.cadmin, "observer", `contact:${BOARD}`)).rejects.toThrow(/forbidden/);
    const client = await roles(U.cadmin);
    expect(client.can).toEqual({ manage: true, contacts: false });
    expect(client.contacts).toEqual([]);
    // The contact's name shows, nothing else of the firm's record.
    expect(client.roles.find((r) => r.role === "observer")?.name).toBe("Board chair");

    for (const who of [U.cons, U.cmgr, U.cowner]) {
      const view = await roles(who);
      expect(view.can.manage, who).toBe(false);
      expect(view.people, who).toEqual([]);
      expect(view.roles.length, who).toBe(4);
      await expect(add(who, "observer", `user:${U.cowner}`), who).rejects.toThrow(/forbidden/);
    }
    const [row] = (await owner.query(`SELECT id FROM project_client_roles WHERE role = 'acceptor'`)).rows;
    await expect(svc(U.cons, (tx, p) => removeClientRole(tx, p, PROJ, row.id))).rejects.toThrow(/not found/i);
    // The client admin can't remove the firm's contact entry either.
    const [obs] = (await owner.query(`SELECT id FROM project_client_roles WHERE role = 'observer'`)).rows;
    await expect(svc(U.cadmin, (tx, p) => removeClientRole(tx, p, PROJ, obs.id))).rejects.toThrow(/not found/i);
  });

  it("is audited", async () => {
    const { rows } = await owner.query(
      `SELECT action, count(*)::int AS n FROM audit_log WHERE resource_id = $1 AND action LIKE 'client_role.%' AND created_at >= $2 GROUP BY 1`,
      [PROJ, started],
    );
    expect(rows).toEqual([{ action: "client_role.add", n: 4 }]);
  });
});

describe("who may hold them", () => {
  it("the sponsor, coordinator and acceptors with an account are the client's admins or managers", async () => {
    for (const role of ["sponsor", "coordinator", "acceptor"]) {
      await expect(add(U.admin, role, `user:${U.cowner}`), role).rejects.toThrow(/admins or managers/);
    }
    // Straight to the table, past the service, the database says the same.
    await expect(
      as(U.admin, (c) =>
        c.query(`INSERT INTO project_client_roles (project_id, org_id, role, user_id, created_by) VALUES ($1,$2,'coordinator',$3,$4)`, [
          PROJ,
          ACME,
          U.cowner,
          U.admin,
        ]),
      ),
    ).rejects.toThrow(/admins or managers/);
    // Contacts may hold any role, in any mode.
    await add(U.admin, "acceptor", `contact:${BOARD}`);
  });

  it("are the project's client's people, never another client's or the firm's", async () => {
    for (const person of [`user:${U.betaAdmin}`, `user:${U.lead}`]) {
      await expect(add(U.admin, "steering", person), person).rejects.toMatchObject(db(/needs an active account at the project.s client/));
    }
    await expect(add(U.admin, "steering", `contact:${BETA_CONTACT}`)).rejects.toMatchObject(db(/contact belongs to the project.s client/));
  });

  it("are for client projects only", async () => {
    expect(await svc(U.admin, (tx, p) => listClientRoles(tx, p, INTERNAL))).toBeNull();
    await expect(add(U.admin, "steering", `user:${U.cowner}`, INTERNAL)).rejects.toThrow(/client projects/);
  });
});

describe("single roles", () => {
  it("a second sponsor or coordinator replaces the first; a person holds a role once", async () => {
    await add(U.cadmin, "sponsor", `user:${U.cmgr}`);
    await add(U.admin, "coordinator", `user:${U.cadmin}`);
    await add(U.lead, "coordinator", `contact:${BOARD}`);
    await add(U.lead, "steering", `user:${U.cowner}`); // again: still one row
    const r = await held();
    expect(r.filter((x) => x.role === "sponsor")).toEqual([{ role: "sponsor", who: U.cmgr }]);
    expect(r.filter((x) => x.role === "coordinator")).toEqual([{ role: "coordinator", who: BOARD }]);
    expect(r.filter((x) => x.role === "steering")).toEqual([{ role: "steering", who: U.cowner }]);
    // The client admin can't replace a coordinator the firm recorded as a contact.
    await expect(add(U.cadmin, "coordinator", `user:${U.cmgr}`)).rejects.toThrow(/forbidden/);
    expect((await held()).filter((x) => x.role === "coordinator")).toEqual([{ role: "coordinator", who: BOARD }]);
  });

  it("the handover card shows the sponsor", async () => {
    expect((await svc(U.cmgr, (tx, p) => getHandover(tx, p, PROJ))).sponsor).toEqual({ id: U.cmgr, name: "cmgr" });
  });
});

describe("the cross-tenant wall", () => {
  it("another client's admin and lead neither see nor name Acme's roles", async () => {
    for (const who of [U.betaAdmin, U.betaLead]) {
      expect((await attempt(who, `SELECT 1 FROM project_client_roles`)).rowCount, who).toBe(0);
      expect((await attempt(who, `SELECT * FROM app_project_client_roles($1)`, [PROJ])).rowCount, who).toBe(0);
      expect((await attempt(who, `SELECT app_can_manage_client_roles($1, false) AS ok`, [PROJ])).rows[0].ok, who).toBe(false);
      await expect(add(who, "observer", `user:${U.cowner}`), who).rejects.toThrow();
    }
  });
});

describe("the sponsor at the last escalation level", () => {
  it("is the sponsor role's holder, while an admin or manager", async () => {
    const aid = id(51);
    await owner.query(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
       VALUES ($1,$2,$3,$4,'Act',$5,'in_progress','2027-03-01',$6)`,
      [aid, PROJ, ACME, REC, U.cowner, U.cons],
    );
    const due = async () =>
      (await owner.query(`SELECT level, recipients FROM app_follow_ups_due('2027-03-20') WHERE action_id = $1`, [aid])).rows[0];
    expect((await due()).level).toBe(3);
    expect((await due()).recipients).toContain(U.cmgr);
    // Demoted to action owner: no longer told as the sponsor.
    await owner.query(`UPDATE org_memberships SET role = 'action_owner' WHERE user_id = $1`, [U.cmgr]);
    expect((await due()).recipients).not.toContain(U.cmgr);
    await owner.query(`UPDATE org_memberships SET role = 'client_manager' WHERE user_id = $1`, [U.cmgr]);
  });
});
