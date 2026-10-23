// Consultant expertise and lead suggestions (baseline: Expertise) against a
// real Postgres: who keeps a profile, and what app_suggest_leads() offers.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { expertiseOverview } from "@/services/expertise";
import { suggestClientLeads } from "@/services/inquiries";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-e000-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const U = {
  admin: id(11),
  amal: id(12), // governance and delegation, knows trade, Arabic
  badr: id(13), // governance only, English only
  dana: id(14), // strategy only: no match
  former: id(15), // left the firm
  faisal: id(16), // governance, not taking new clients
  cmgr: id(17),
  ghada: id(18), // consultant with no profile yet
};
let INQ = "";

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
const run = (userId: string | null, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params), true);
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    true,
  );
const attempt = (userId: string | null, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params));

async function profile(uid: string, languages: string[], services: string[], sectors: string[] = [], accepting = true) {
  await owner.query(`INSERT INTO consultant_profiles (user_id, firm_org_id, languages, accepting_new_clients) VALUES ($1,$2,$3,$4)`, [
    uid,
    FIRM,
    languages,
    accepting,
  ]);
  await owner.query(
    `INSERT INTO consultant_service_areas (user_id, service_area_id) SELECT $1, id FROM service_areas WHERE code = ANY($2)`,
    [uid, services],
  );
  await owner.query(`INSERT INTO consultant_sectors (user_id, sector_id) SELECT $1, id FROM sectors WHERE code = ANY($2)`, [
    uid,
    sectors,
  ]);
}

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme')`, [FIRM, ACME]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role, active) VALUES
      ($1,$9,'firm_admin',true), ($2,$9,'consultant',true), ($3,$9,'consultant',true), ($4,$9,'consultant',true),
      ($5,$9,'consultant',true), ($6,$9,'consultant',true), ($7,$10,'client_manager',true), ($8,$9,'consultant',true)`,
    [U.admin, U.amal, U.badr, U.dana, U.former, U.faisal, U.cmgr, U.ghada, FIRM, ACME],
  );
  await profile(U.amal, ["ar", "en"], ["corporate_governance", "delegation_matrix"], ["trade_distribution"]);
  await profile(U.badr, ["en"], ["corporate_governance"]);
  await profile(U.dana, ["ar"], ["strategic_plan"], ["trade_distribution"]);
  await profile(U.former, ["ar"], ["corporate_governance", "delegation_matrix"], ["trade_distribution"]);
  await profile(U.faisal, ["ar"], ["corporate_governance", "delegation_matrix"], ["trade_distribution"], false);
  await q(`UPDATE org_memberships SET active = false WHERE user_id = $1`, [U.former]);
  // Badr already leads one client.
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [ACME, U.badr]);
  const { rows } = await q(`SELECT submit_inquiry($1::jsonb) AS ref`, [
    JSON.stringify({
      org_name: "Al-Waha Trading",
      sector: "trade_distribution",
      employee_band: "50-249",
      ownership_type: "family_multi_partner",
      contact_name: "Sami",
      email: "sami@example.test",
      preferred_language: "ar",
      services: ["corporate_governance", "delegation_matrix"],
      self_check: {},
      consent: true,
      privacy_notice_version: "2026-10-20",
    }),
  ]);
  INQ = (await q(`SELECT id FROM inquiries WHERE public_ref = $1`, [rows[0].ref])).rows[0].id;
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("consultant profiles", () => {
  it("are created by the firm admin, for active consultants only", async () => {
    const create = (who: string, uid: string) =>
      run(who, `INSERT INTO consultant_profiles (user_id, firm_org_id) VALUES ($1,$2)`, [uid, FIRM]);
    await expect(create(U.ghada, U.ghada)).rejects.toThrow(/row-level security/);
    for (const uid of [U.admin, U.cmgr, U.former]) {
      await expect(create(U.admin, uid), uid).rejects.toThrow(/active consultant of the firm/);
    }
    await create(U.admin, U.ghada);
  });

  it("let a consultant change only their own languages and availability", async () => {
    await run(U.badr, `UPDATE consultant_profiles SET languages = '{ar,en}', accepting_new_clients = false WHERE user_id = $1`, [
      U.badr,
    ]);
    const changed = await attempt(U.badr, `UPDATE consultant_profiles SET languages = '{ar}' WHERE user_id = $1`, [U.amal]);
    expect(changed.rowCount).toBe(0);
    await expect(
      attempt(U.badr, `INSERT INTO consultant_service_areas (user_id, service_area_id) SELECT $1, id FROM service_areas LIMIT 1`, [
        U.badr,
      ]),
    ).rejects.toThrow(/row-level security/);
    await expect(attempt(U.badr, `UPDATE consultant_profiles SET languages = '{fr}' WHERE user_id = $1`, [U.badr])).rejects.toThrow(
      /languages_known/,
    );
    await owner.query(`UPDATE consultant_profiles SET languages = '{en}', accepting_new_clients = true WHERE user_id = $1`, [U.badr]);
  });

  it("are read by the firm, not by clients", async () => {
    expect((await attempt(U.dana, `SELECT * FROM consultant_service_areas`)).rowCount).toBeGreaterThan(0);
    expect((await attempt(U.cmgr, `SELECT * FROM consultant_profiles`)).rowCount).toBe(0);
    expect((await attempt(U.cmgr, `SELECT * FROM consultant_service_areas`)).rowCount).toBe(0);
  });
});

describe("lead suggestions", () => {
  const suggest = (who: string) => attempt(who, `SELECT * FROM app_suggest_leads($1)`, [INQ]);

  it("list matching active consultants with their reasons, available and closest first", async () => {
    const { rows } = await suggest(U.admin);
    expect(rows.map((r) => [r.name, r.matched_services, r.sector_match, r.speaks_language, r.accepting_new_clients, r.active_clients])).toEqual([
      ["amal", ["delegation_matrix", "corporate_governance"], true, true, true, 0],
      ["badr", ["corporate_governance"], false, false, true, 1],
      ["faisal", ["delegation_matrix", "corporate_governance"], true, true, false, 0],
    ]);
  });

  it("are for the firm admin only, and off when the firm turns them off", async () => {
    await expect(suggest(U.amal)).rejects.toThrow(/not allowed/);
    await expect(suggest(U.cmgr)).rejects.toThrow(/not allowed/);
    await owner.query(`INSERT INTO firm_settings (org_id, suggestions_enabled) VALUES ($1, false)`, [FIRM]);
    expect((await suggest(U.admin)).rowCount).toBe(0);
    await owner.query(`UPDATE firm_settings SET suggestions_enabled = true WHERE org_id = $1`, [FIRM]);
  });
});

describe("the expertise screen", () => {
  it("lists every active consultant by name, set up or not, and who may edit what", async () => {
    await owner.query(`DELETE FROM consultant_profiles WHERE user_id = $1`, [U.ghada]);
    const all = await svc(U.admin, (tx, p) => expertiseOverview(tx, p));
    expect(all.consultants.map((c) => [c.name, c.profile ? c.profile.services.length : null, c.canEdit])).toEqual([
      ["amal", 2, "all"],
      ["badr", 1, "all"],
      ["dana", 1, "all"],
      ["faisal", 2, "all"],
      ["ghada", null, "all"],
    ]);
    expect(all.services.length).toBeGreaterThan(0);
    const mine = await svc(U.badr, (tx, p) => expertiseOverview(tx, p));
    expect(mine.canManage).toBe(false);
    expect(mine.consultants.filter((c) => c.canEdit).map((c) => [c.name, c.canEdit])).toEqual([["badr", "own"]]);
    await expect(svc(U.cmgr, (tx, p) => expertiseOverview(tx, p))).rejects.toThrow();
  });

  it("suggests leads for a client from the inquiry it came from, and none without one", async () => {
    expect(await svc(U.admin, (tx, p) => suggestClientLeads(tx, p, ACME))).toEqual({ enabled: true, inquiry: null, leads: [] });
    // As if the inquiry had been won and converted into this client.
    await owner.query(`ALTER TABLE inquiries DISABLE TRIGGER USER`);
    await owner.query(`UPDATE inquiries SET status = 'won', client_org_id = $1 WHERE id = $2`, [ACME, INQ]);
    await owner.query(`ALTER TABLE inquiries ENABLE TRIGGER USER`);
    const out = await svc(U.admin, (tx, p) => suggestClientLeads(tx, p, ACME));
    expect(out.inquiry?.id).toBe(INQ);
    expect(out.leads.map((l) => l.name)).toEqual(["amal", "badr", "faisal"]);
    await expect(svc(U.amal, (tx, p) => suggestClientLeads(tx, p, ACME))).rejects.toThrow();
    await owner.query(`UPDATE firm_settings SET suggestions_enabled = false WHERE org_id = $1`, [FIRM]);
    expect(await svc(U.admin, (tx, p) => suggestClientLeads(tx, p, ACME))).toMatchObject({ enabled: false, leads: [] });
    await owner.query(`UPDATE firm_settings SET suggestions_enabled = true WHERE org_id = $1`, [FIRM]);
  });
});
