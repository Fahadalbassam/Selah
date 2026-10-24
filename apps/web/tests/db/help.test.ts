// Help for client people (F13, migration 0058_help) against a real Postgres:
// a client person sees their own client's consultants (lead, deputy and the
// firm people staffed on their projects), never another client's; a
// technical problem reaches only the firm's admins, at most five a day per
// person; the reports are read by their author and the firm's admins only.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { SUPPORT_LIMITS } from "@/lib/help";
import { getHelp, handleSupportRequest, listSupportRequests, reportProblem } from "@/services/help";
import { loadPrincipal } from "@/services/principal";
import { truncateAuditLog } from "./audit-reset";

// A refusal over the limit is audited in its own transaction, which needs the
// app's connection settings; here it is only collected.
const detached = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/services/audit", async (actual) => ({
  ...(await actual<typeof import("@/services/audit")>()),
  auditDetached: async (entry: Record<string, unknown>) => void detached.push(entry),
}));

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c130-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = {
  admin: id(11),
  admin2: id(12),
  lead: id(13), // Acme's lead, staffed on PROJ
  deputy: id(14), // Acme's deputy, not staffed
  cons: id(15), // on Acme's team, staffed on PROJ
  other: id(16), // on Acme's team, staffed on PROJ2 only
  watcher: id(17), // on Acme's team, an observer on PROJ
  gone: id(18), // on Acme's team and staffed on PROJ, account switched off
  betaLead: id(19),
  mgr: id(21), // Acme manager on PROJ
  owner: id(22), // Acme action owner on PROJ
  cadmin: id(23), // Acme admin
  betaMgr: id(24),
};
const PROJ = id(31);
const PROJ2 = id(32);
const BETA_PROJ = id(33);

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
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    true,
  );
const report = (who: string, body = "The upload button does nothing") => svc(who, (tx, p) => reportProblem(tx, p, { body }));
const consultants = async (who: string) =>
  (await as(who, (c) => c.query(`SELECT project_id, user_id FROM app_my_consultants() ORDER BY project_id NULLS FIRST, user_id`))).rows.map(
    (r) => `${r.project_id ?? "client"}:${r.user_id}`,
  );
const readable = async (who: string) => (await as(who, (c) => c.query(`SELECT user_id FROM support_requests ORDER BY user_id`))).rows.map((r) => r.user_id);

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await truncateAuditLog(owner);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [FIRM, ACME, BETA]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  const roles: [string, string, string][] = [
    [U.admin, FIRM, "firm_admin"],
    [U.admin2, FIRM, "firm_admin"],
    [U.lead, FIRM, "consultant"],
    [U.deputy, FIRM, "consultant"],
    [U.cons, FIRM, "consultant"],
    [U.other, FIRM, "consultant"],
    [U.watcher, FIRM, "consultant"],
    [U.gone, FIRM, "consultant"],
    [U.betaLead, FIRM, "consultant"],
    [U.mgr, ACME, "client_manager"],
    [U.owner, ACME, "action_owner"],
    [U.cadmin, ACME, "client_admin"],
    [U.betaMgr, BETA, "client_manager"],
  ];
  for (const [u, o, r] of roles) await q(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,$3)`, [u, o, r]);
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$4,$6,'Acme governance','active',$7), ($2,'client',$4,$6,'Acme finance','active',$7), ($3,'client',$5,$6,'Beta strategy','active',$7)`,
    [PROJ, PROJ2, BETA_PROJ, ACME, BETA, FIRM, U.admin],
  );
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES
      ($1,$2,true,false), ($1,$3,false,true), ($1,$4,false,false), ($1,$5,false,false), ($1,$6,false,false), ($1,$7,false,false), ($8,$9,true,false)`,
    [ACME, U.lead, U.deputy, U.cons, U.other, U.watcher, U.gone, BETA, U.betaLead],
  );
  for (const u of [U.lead, U.cons, U.gone, U.mgr, U.owner]) await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [PROJ, u]);
  await q(`INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,true)`, [PROJ, U.watcher]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [PROJ2, U.other]);
  for (const u of [U.betaLead, U.betaMgr]) await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [BETA_PROJ, u]);
  await q(`UPDATE org_memberships SET active = false, deactivation_reason = 'left the firm' WHERE user_id = $1`, [U.gone]);
});

beforeEach(async () => {
  await owner.query(`DELETE FROM support_requests`);
  await owner.query(`DELETE FROM notifications`);
  await owner.query(`DELETE FROM outbound_emails`);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("your consultants", () => {
  it("a client person sees their client's lead and deputy, and the active firm people staffed on their projects", async () => {
    expect(await consultants(U.mgr)).toEqual([`client:${U.lead}`, `client:${U.deputy}`].sort().concat([`${PROJ}:${U.lead}`, `${PROJ}:${U.cons}`].sort()));
    // Not an observer, not a switched-off account, not a project they are not on, never another client's people.
    const seen = (await consultants(U.owner)).join(" ");
    for (const u of [U.watcher, U.gone, U.other, U.betaLead, U.admin]) expect(seen).not.toContain(u);
  });

  it("a client admin sees every project of their client; another client sees only its own", async () => {
    expect(await consultants(U.cadmin)).toContain(`${PROJ2}:${U.other}`);
    expect(await consultants(U.betaMgr)).toEqual([`client:${U.betaLead}`, `${BETA_PROJ}:${U.betaLead}`]);
  });

  it("the help page carries names and work addresses of that client's consultants only", async () => {
    const help = await svc(U.owner, (tx, p) => getHelp(tx, p));
    expect(help.lead).toMatchObject({ userId: U.lead, email: "lead@example.test", isLead: true });
    expect(help.deputy).toMatchObject({ userId: U.deputy, isDeputy: true });
    expect(help.projects.map((p) => p.id)).toEqual([PROJ]);
    expect(help.projects[0]!.consultants.map((c) => c.userId).sort()).toEqual([U.cons, U.lead].sort());
    const beta = await svc(U.betaMgr, (tx, p) => getHelp(tx, p));
    expect(beta.lead?.userId).toBe(U.betaLead);
    expect(JSON.stringify(beta)).not.toContain("Acme");
    expect(JSON.stringify(beta)).not.toContain(U.lead);
  });

  it("firm staff have no help page and no consultants list", async () => {
    await expect(svc(U.lead, (tx, p) => getHelp(tx, p))).rejects.toThrow(/not found/);
    await expect(svc(U.admin, (tx, p) => getHelp(tx, p))).rejects.toThrow(/not found/);
    expect(await consultants(U.admin)).toEqual([]);
  });
});

describe("technical problems", () => {
  it("reach only the firm's active admins, in Selah and by mail, without the text", async () => {
    const { id: rid } = await report(U.owner);
    const notes = await owner.query(`SELECT user_id, kind, entity_type, entity_id FROM notifications ORDER BY user_id`);
    expect(notes.rows).toEqual(
      [U.admin, U.admin2].sort().map((u) => ({ user_id: u, kind: "support.requested", entity_type: "support_request", entity_id: rid })),
    );
    const mail = await owner.query(`SELECT to_email, kind, link, reference FROM outbound_emails ORDER BY to_email`);
    expect(mail.rows).toEqual(
      ["admin2@example.test", "admin@example.test"].sort().map((to) => ({ to_email: to, kind: "support.requested", link: "/notifications#support", reference: null })),
    );
    const audit = await owner.query(`SELECT actor_id, outcome, meta FROM audit_log WHERE action = 'support_request.create' AND resource_id = $1`, [rid]);
    expect(audit.rows).toEqual([{ actor_id: U.owner, outcome: "allow", meta: {} }]);
  });

  it("are read by their author and the firm's admins; never by colleagues, consultants or another client", async () => {
    await report(U.owner);
    await report(U.betaMgr);
    expect(await readable(U.owner)).toEqual([U.owner]);
    expect(await readable(U.betaMgr)).toEqual([U.betaMgr]);
    expect(await readable(U.admin)).toEqual([U.owner, U.betaMgr].sort());
    for (const who of [U.mgr, U.cadmin, U.lead, U.cons, U.betaLead]) expect(await readable(who), who).toEqual([]);
    expect(await svc(U.lead, (tx, p) => listSupportRequests(tx, p))).toBeNull();
    const list = await svc(U.admin, (tx, p) => listSupportRequests(tx, p));
    expect(list!.map((r) => r.userId).sort()).toEqual([U.owner, U.betaMgr].sort());
  });

  it("firm staff cannot report one", async () => {
    await expect(report(U.lead)).rejects.toThrow(/not found/);
    await expect(as(U.admin, (c) => c.query(`SELECT app_report_problem('x')`))).rejects.toThrow(/only client people/);
  });

  it(`are limited to ${SUPPORT_LIMITS.perDay} a day per person, and the limit matches the database`, async () => {
    expect((await owner.query(`SELECT app_support_per_day() AS n`)).rows[0].n).toBe(SUPPORT_LIMITS.perDay);
    for (let i = 0; i < SUPPORT_LIMITS.perDay; i++) await report(U.mgr, `problem ${i}`);
    await expect(report(U.mgr)).rejects.toThrow(/too many problem reports/);
    await expect(as(U.mgr, (c) => c.query(`SELECT app_report_problem('again')`))).rejects.toMatchObject({ code: "SL429" });
    // Someone else at the same client is not held back.
    await report(U.owner);
    expect(detached).toEqual([expect.objectContaining({ actorId: U.mgr, action: "support_request.create", outcome: "deny", reason: "rate_limited" })]);
    // A day later the person can report again.
    await owner.query(`UPDATE support_requests SET created_at = now() - interval '25 hours' WHERE user_id = $1`, [U.mgr]);
    await report(U.mgr);
  });

  it("refuses an empty or over-long report", async () => {
    await expect(as(U.mgr, (c) => c.query(`SELECT app_report_problem('   ')`))).rejects.toThrow(/up to 2000/);
    await expect(as(U.mgr, (c) => c.query(`SELECT app_report_problem($1)`, ["x".repeat(SUPPORT_LIMITS.body + 1)]))).rejects.toThrow(/up to 2000/);
  });

  it("only a firm admin marks one handled, once, and its author is told", async () => {
    const { id: rid } = await report(U.owner);
    // Row-level security hides the report from everyone but its author and the firm's admins.
    await expect(svc(U.lead, (tx, p) => handleSupportRequest(tx, p, rid))).rejects.toThrow(/not found/);
    await expect(svc(U.cadmin, (tx, p) => handleSupportRequest(tx, p, rid))).rejects.toThrow(/not found/);
    // The author reads it but may not mark it.
    await expect(svc(U.owner, (tx, p) => handleSupportRequest(tx, p, rid))).rejects.toThrow(/forbidden/);
    await expect(as(U.lead, (c) => c.query(`SELECT app_handle_support_request($1)`, [rid]))).rejects.toThrow(/no such request/);
    await svc(U.admin, (tx, p) => handleSupportRequest(tx, p, rid));
    const row = await owner.query(`SELECT handled_by FROM support_requests WHERE id = $1`, [rid]);
    expect(row.rows[0].handled_by).toBe(U.admin);
    const told = await owner.query(`SELECT user_id FROM notifications WHERE kind = 'support.handled'`);
    expect(told.rows).toEqual([{ user_id: U.owner }]);
    await expect(svc(U.admin2, (tx, p) => handleSupportRequest(tx, p, rid))).rejects.toThrow(/already handled/);
  });
});
