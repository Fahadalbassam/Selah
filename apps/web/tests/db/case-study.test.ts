// Case-study consent (F37, migration: Case-study consent) against a real
// Postgres: only the client's sponsor or admin gives it, once the project is
// closing or closed; the firm admin records one given outside Selah only with
// where it came from; every record is kept and a withdrawal is dated on the
// record it ends; the default is "none"; and no other client sees any of it.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { CASE_STUDY_LEVELS, type CaseStudyLevel } from "@/lib/case-study";
import { getCaseStudyConsent, recordCaseStudyConsent, revokeCaseStudyConsent } from "@/services/case-study";
import { loadPrincipal } from "@/services/principal";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c370-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = {
  admin: id(11),
  lead: id(12), // Acme's lead consultant
  cons: id(13), // staffed on PROJ
  sponsor: id(21), // Acme manager, the sponsor
  cmgr: id(22), // Acme manager, staffed, not the sponsor
  cadmin: id(23), // Acme admin
  cowner: id(24), // Acme action owner, staffed
  betaAdmin: id(25),
};
const PROJ = id(31);
const BETA_PROJ = id(32);

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
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    true,
  );
const give = (who: string, level: CaseStudyLevel, testimonial = false, extra: { conditions?: string; sourceNote?: string } = {}) =>
  svc(who, (tx, p) => recordCaseStudyConsent(tx, p, PROJ, { level, testimonial, ...extra }));
const rows = async (who: string, pid = PROJ) =>
  (await as(who, (c) => c.query(`SELECT level::text, revoked_at FROM case_study_consents WHERE project_id = $1 ORDER BY given_at`, [pid]))).rows;
const stateOf = async (pid: string) => (await owner.query(`SELECT state::text AS s FROM projects WHERE id = $1`, [pid])).rows[0].s as string;

async function startClosing(pid: string) {
  await run(U.admin, `SELECT app_start_closing($1)`, [pid]);
}
async function close(pid: string) {
  if ((await stateOf(pid)) !== "closing") await startClosing(pid);
  await run(U.admin, `SELECT app_write_lessons($1, 'Clear scope', 'Earlier reviews', null)`, [pid]);
  await run(U.admin, `SELECT app_close_project($1)`, [pid]);
}

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await truncateAuditLog(owner);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [FIRM, ACME, BETA]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  const roles: [string, string, string][] = [
    [U.admin, FIRM, "firm_admin"],
    [U.lead, FIRM, "consultant"],
    [U.cons, FIRM, "consultant"],
    [U.sponsor, ACME, "client_manager"],
    [U.cmgr, ACME, "client_manager"],
    [U.cadmin, ACME, "client_admin"],
    [U.cowner, ACME, "action_owner"],
    [U.betaAdmin, BETA, "client_admin"],
  ];
  for (const [u, o, r] of roles) await q(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,$3)`, [u, o, r]);
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$3,$5,'Acme governance','active',$6), ($2,'client',$4,$5,'Beta strategy','active',$6)`,
    [PROJ, BETA_PROJ, ACME, BETA, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($1,$3,false)`, [ACME, U.lead, U.cons]);
  for (const u of [U.cons, U.sponsor, U.cmgr, U.cowner]) await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [PROJ, u]);
  await q(`INSERT INTO project_client_roles (project_id, org_id, role, user_id) VALUES ($1,$2,'sponsor',$3)`, [PROJ, ACME, U.sponsor]);
});

beforeEach(async () => {
  for (const pid of [PROJ, BETA_PROJ]) {
    await owner.query(`DELETE FROM case_study_consents WHERE project_id = $1`, [pid]);
    await owner.query(`DELETE FROM project_closures WHERE project_id = $1`, [pid]);
    await owner.query(`UPDATE projects SET state = 'active' WHERE id = $1`, [pid]);
  }
  await owner.query(`DELETE FROM notifications`);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("giving consent", () => {
  it("the levels are the database's", async () => {
    const r = await owner.query(`SELECT enum_range(NULL::case_study_level)::text[] AS v`);
    expect(r.rows[0].v).toEqual([...CASE_STUDY_LEVELS]);
  });

  it("is asked once the project is closing or closed, never before; the default is none", async () => {
    await expect(give(U.sponsor, "named")).rejects.toThrow();
    expect(await svc(U.admin, (tx, p) => getCaseStudyConsent(tx, p, PROJ))).toBeNull();
    await startClosing(PROJ);
    const view = await svc(U.admin, (tx, p) => getCaseStudyConsent(tx, p, PROJ));
    expect(view).toMatchObject({ current: null, latest: null, history: [], can: { give: false, record: true, revoke: false } });
    expect((await svc(U.sponsor, (tx, p) => getCaseStudyConsent(tx, p, PROJ)))!.can).toEqual({ give: true, record: false, revoke: false });
    await give(U.sponsor, "anonymised", true, { conditions: "No figures from 2025" });
    await close(PROJ);
    const after = await give(U.cadmin, "named", true);
    expect(after!.current).toMatchObject({ level: "named", testimonial: true, recordedByFirm: false, givenBy: "cadmin" });
  });

  it("only the client's sponsor or admin gives it: not another manager, an owner, another client or a consultant", async () => {
    await close(PROJ);
    for (const who of [U.cmgr, U.cowner, U.betaAdmin, U.cons, U.lead]) {
      await expect(give(who, "named"), who).rejects.toThrow();
      await expect(run(who, `SELECT app_record_case_study($1, 'named', true, null, null)`, [PROJ]), who).rejects.toThrow();
    }
    // A client's own words never pass as a firm source note.
    await give(U.sponsor, "metrics_only", false, { sourceNote: "said so in a meeting" });
    const [r] = (await owner.query(`SELECT recorded_by_firm, source_note FROM case_study_consents WHERE project_id = $1`, [PROJ])).rows;
    expect(r).toEqual({ recorded_by_firm: false, source_note: null });
  });

  it("the firm admin records a consent given outside Selah only with where it came from", async () => {
    await close(PROJ);
    await expect(run(U.admin, `SELECT app_record_case_study($1, 'named', false, null, null)`, [PROJ])).rejects.toThrow(/where the client gave/);
    const view = await give(U.admin, "named", false, { sourceNote: "Sponsor's email of 12 October" });
    expect(view!.current).toMatchObject({ level: "named", recordedByFirm: true, sourceNote: "Sponsor's email of 12 October", givenBy: "admin" });
    // The lead consultant does not record it.
    await expect(give(U.lead, "named", false, { sourceNote: "Sponsor's email" })).rejects.toThrow();
    const log = await owner.query(`SELECT meta FROM audit_log WHERE action = 'case_study.consent' AND actor_id = $1`, [U.admin]);
    expect(log.rows[0].meta).toEqual({ level: "named", testimonial: false, recordedByFirm: true });
  });
});

describe("history and withdrawal", () => {
  it("keeps every record; a withdrawal is dated on the record it ends, and the firm hears", async () => {
    await close(PROJ);
    await give(U.sponsor, "named", true);
    await give(U.cadmin, "anonymised", false);
    expect((await rows(U.admin)).map((r) => r.level)).toEqual(["named", "anonymised"]);

    await expect(svc(U.cmgr, (tx, p) => revokeCaseStudyConsent(tx, p, PROJ))).rejects.toThrow();
    await expect(svc(U.admin, (tx, p) => revokeCaseStudyConsent(tx, p, PROJ))).rejects.toThrow();
    const view = await svc(U.sponsor, (tx, p) => revokeCaseStudyConsent(tx, p, PROJ));
    expect(view!.current).toBeNull();
    expect(view!.latest).toMatchObject({ level: "anonymised", revokedBy: "sponsor" });
    const all = await rows(U.admin);
    expect(all.map((r) => [r.level, r.revoked_at === null])).toEqual([
      ["named", true],
      ["anonymised", false],
    ]);
    const told = await owner.query(`SELECT user_id FROM notifications WHERE kind = 'case_study.revoked' ORDER BY user_id`);
    expect(told.rows.map((r) => r.user_id)).toEqual([U.admin, U.lead].sort());
    expect((await owner.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'case_study.revoke'`)).rows[0].n).toBe(1);

    // Nothing left to withdraw, until a new consent is given.
    await expect(run(U.sponsor, `SELECT app_revoke_case_study($1)`, [PROJ])).rejects.toThrow(/no consent to withdraw/);
    await give(U.sponsor, "metrics_only");
    expect((await rows(U.admin)).map((r) => r.level)).toEqual(["named", "anonymised", "metrics_only"]);
  });

  it("can be withdrawn at any time, also after the project reopens; recording waits for closing", async () => {
    await close(PROJ);
    await give(U.sponsor, "named", true);
    await run(U.admin, `SELECT app_reopen_project($1, 'One more phase')`, [PROJ]);
    await expect(give(U.sponsor, "anonymised")).rejects.toThrow();
    await svc(U.cadmin, (tx, p) => revokeCaseStudyConsent(tx, p, PROJ));
    expect((await rows(U.admin))[0]!.revoked_at).not.toBeNull();
  });

  it("nobody writes the table directly", async () => {
    await close(PROJ);
    await give(U.sponsor, "named", true);
    await expect(
      run(U.sponsor, `INSERT INTO case_study_consents (project_id, org_id, level) VALUES ($1,$2,'named')`, [PROJ, ACME]),
    ).rejects.toThrow(/permission denied/);
    await expect(run(U.sponsor, `UPDATE case_study_consents SET revoked_at = now(), revoked_by = $2 WHERE project_id = $1`, [PROJ, U.sponsor])).rejects.toThrow(
      /permission denied/,
    );
    await expect(run(U.admin, `DELETE FROM case_study_consents WHERE project_id = $1`, [PROJ])).rejects.toThrow(/permission denied/);
  });
});

describe("who sees it", () => {
  it("everyone on the project reads the consent; another client sees nothing", async () => {
    await close(PROJ);
    await give(U.sponsor, "named", true);
    for (const who of [U.admin, U.lead, U.cons, U.sponsor, U.cmgr, U.cadmin]) expect(await rows(who), who).toHaveLength(1);
    expect(await rows(U.betaAdmin)).toEqual([]);
    await expect(svc(U.betaAdmin, (tx, p) => getCaseStudyConsent(tx, p, PROJ))).rejects.toThrow();
    // An action owner reads no consent through the app.
    expect(await svc(U.cowner, (tx, p) => getCaseStudyConsent(tx, p, PROJ))).toBeNull();

    await close(BETA_PROJ);
    await svc(U.betaAdmin, (tx, p) => recordCaseStudyConsent(tx, p, BETA_PROJ, { level: "anonymised", testimonial: false }));
    for (const who of [U.sponsor, U.cadmin, U.cmgr, U.lead, U.cons]) expect(await rows(who, BETA_PROJ), who).toEqual([]);
    expect(await rows(U.admin, BETA_PROJ)).toHaveLength(1);
    // Acme's people cannot give or withdraw consent for Beta.
    await expect(run(U.cadmin, `SELECT app_record_case_study($1, 'named', true, null, null)`, [BETA_PROJ])).rejects.toThrow();
    await expect(run(U.cadmin, `SELECT app_revoke_case_study($1)`, [BETA_PROJ])).rejects.toThrow();
  });
});
