// A client's legal profile (wave 1, item 7) against a real Postgres: who
// reads and edits it, the unified number, minimal records, the listing and
// legal form rules, and the tenant wall.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { clientProfileInput, ISIC_CODE, UNIFIED_NUMBER, type ClientProfileInput } from "@/lib/client-profile";
import { getClientProfile, setClientProfile } from "@/services/client-profile";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c200-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const MINI = id(4); // minimal records
const U = {
  admin: id(11),
  lead: id(12), // Acme's lead
  cons: id(13), // on Acme's team, not the lead
  cadmin: id(14),
  cowner: id(15),
  betaAdmin: id(16),
  other: id(17), // a consultant not on Acme
};

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
const db = (re: RegExp) => ({ cause: { message: expect.stringMatching(re) } });
const input = (fields: Partial<ClientProfileInput> = {}): ClientProfileInput =>
  clientProfileInput.parse({
    legalNameAr: "شركة أكمي القابضة",
    legalNameEn: "Acme Holding Company",
    tradeName: null,
    unifiedNumber: "7001234567",
    isicCode: "6420",
    sectorCode: null,
    sizeBand: "medium",
    revenueBand: "small",
    region: "riyadh",
    regulators: ["mc"],
    listedMarket: null,
    fiscalYearEndMonth: 12,
    fiscalCalendar: "gregorian",
    ...fields,
  });
const save = (who: string, org: string, fields: Partial<ClientProfileInput> = {}) => svc(who, (tx, p) => setClientProfile(tx, p, org, input(fields)));
const read = (who: string, org = ACME) => svc(who, (tx, p) => getClientProfile(tx, p, org));

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, engagement_mode, minimal_records, display_alias) VALUES
      ($1,'firm','firm',null,false,null), ($2,'client','Acme','full',false,null), ($3,'client','Beta','full',false,null),
      ($4,'client','Mini','consultant_managed',true,'Client M')`,
    [FIRM, ACME, BETA, MINI],
  );
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role, active) VALUES
      ($1,$8,'firm_admin',true), ($2,$8,'consultant',true), ($3,$8,'consultant',true), ($4,$9,'client_admin',true),
      ($5,$9,'action_owner',true), ($6,$10,'client_admin',true), ($7,$8,'consultant',true)`,
    [U.admin, U.lead, U.cons, U.cadmin, U.cowner, U.betaAdmin, U.other, FIRM, ACME, BETA],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($1,$3,false), ($4,$2,true)`, [
    ACME,
    U.lead,
    U.cons,
    MINI,
  ]);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("who keeps the profile", () => {
  it("the firm admin records it, with the legal form", async () => {
    await svc(U.admin, (tx, p) => setClientProfile(tx, p, ACME, { ...input(), legalForm: "closed_jsc" }));
    const view = await read(U.admin);
    expect(view).toMatchObject({
      legalForm: "closed_jsc",
      profile: { legalNameAr: "شركة أكمي القابضة", unifiedNumber: "7001234567", regulators: ["mc"], updatedBy: U.admin },
      can: { edit: true, legalForm: true },
    });
  });

  it("the client's lead corrects it but can't change the legal form", async () => {
    expect((await read(U.lead)).can).toEqual({ edit: true, legalForm: false });
    await save(U.lead, ACME, { tradeName: "أكمي", region: "eastern" });
    expect((await read(U.lead)).profile).toMatchObject({ tradeName: "أكمي", region: "eastern", updatedBy: U.lead });
    await expect(svc(U.lead, (tx, p) => setClientProfile(tx, p, ACME, { ...input(), legalForm: "llc" }))).rejects.toThrow(/forbidden/);
  });

  it("other consultants on the team and the client's admin read it; nobody else edits", async () => {
    for (const who of [U.cons, U.cadmin]) {
      const view = await read(who);
      expect(view.profile?.legalNameEn, who).toBe("Acme Holding Company");
      expect(view.can, who).toEqual({ edit: false, legalForm: false });
      expect(view.sectors, who).toEqual([]);
      await expect(save(who, ACME), who).rejects.toThrow(/forbidden/);
      // Straight to the table, the database refuses too.
      const direct = await attempt(who, `UPDATE client_profiles SET trade_name = 'x', updated_by = $2 WHERE org_id = $1`, [ACME, who]);
      expect(direct.rowCount, who).toBe(0);
    }
  });

  it("action owners, other clients and consultants off the client never see it", async () => {
    for (const who of [U.cowner, U.betaAdmin, U.other]) {
      expect((await attempt(who, `SELECT 1 FROM client_profiles`)).rowCount, who).toBe(0);
    }
    await expect(save(U.betaAdmin, ACME)).rejects.toThrow(/forbidden/);
    await expect(save(U.other, ACME)).rejects.toThrow(/forbidden/);
  });

  it("is for clients only and is audited", async () => {
    await expect(
      as(U.admin, (c) => c.query(`INSERT INTO client_profiles (org_id, updated_by) VALUES ($1, $2)`, [FIRM, U.admin])),
    ).rejects.toThrow();
    const { rows } = await owner.query(`SELECT actor_id FROM audit_log WHERE resource_id = $1 AND action = 'organization.legal_profile' ORDER BY created_at`, [
      ACME,
    ]);
    expect(rows.slice(-2).map((r) => r.actor_id)).toEqual([U.admin, U.lead]);
  });
});

describe("the unified number", () => {
  it("is 7 then nine digits, the same rule in the form and the database", async () => {
    for (const n of ["7001234567", "7999999999", "1010123456", "700123456", "70012345678", "7ab1234567"]) {
      const form = UNIFIED_NUMBER.test(n);
      const database = (await owner.query(`SELECT $1::text ~ '^7[0-9]{9}$' AS ok`, [n])).rows[0].ok;
      expect(form, n).toBe(database);
    }
    await expect(
      as(U.admin, (c) => c.query(`UPDATE client_profiles SET unified_number = '1010123456', updated_by = $2 WHERE org_id = $1`, [ACME, U.admin])),
    ).rejects.toThrow(/client_profile_unified_number/);
    expect(clientProfileInput.safeParse({ ...input(), unifiedNumber: "700 123 4567" }).data?.unifiedNumber).toBe("7001234567");
  });

  it("the ISIC code is four to six digits in both", async () => {
    for (const c of ["6420", "642010", "642", "6420101", "64a0"]) {
      expect(ISIC_CODE.test(c), c).toBe((await owner.query(`SELECT $1::text ~ '^[0-9]{4,6}$' AS ok`, [c])).rows[0].ok);
    }
  });

  it("belongs to one client: a second client with the same number is refused", async () => {
    await expect(save(U.admin, BETA)).rejects.toThrow(/another client already has this unified number/);
    await save(U.admin, BETA, { unifiedNumber: "7007654321", legalNameAr: "شركة بيتا" });
  });
});

describe("minimal records", () => {
  it("keep no legal names or unified number", async () => {
    await expect(save(U.lead, MINI)).rejects.toMatchObject(db(/minimal-records client keeps no legal names/));
    await save(U.lead, MINI, { legalNameAr: null, legalNameEn: null, unifiedNumber: null, region: "makkah" });
    expect((await read(U.lead, MINI)).minimalRecords).toBe(true);
  });

  it("can't be switched on while the profile holds them", async () => {
    await expect(owner.query(`UPDATE organizations SET engagement_mode = 'consultant_managed', minimal_records = true, display_alias = 'Client A' WHERE id = $1`, [ACME])).rejects.toThrow(
      /minimal-records client keeps no legal names/,
    );
  });
});

describe("the listing and the legal form", () => {
  it("a listed market needs the listed joint stock company form", async () => {
    await expect(save(U.lead, ACME, { listedMarket: "main" })).rejects.toMatchObject(db(/listed market needs the listed joint stock company/));
    // The admin changes both at once.
    await svc(U.admin, (tx, p) => setClientProfile(tx, p, ACME, { ...input({ listedMarket: "parallel", regulators: ["mc", "cma"] }), legalForm: "listed_jsc" }));
    expect(await read(U.admin)).toMatchObject({ legalForm: "listed_jsc", profile: { listedMarket: "parallel" } });
  });

  it("the form can't move off listed while the listing stands; clearing both at once works", async () => {
    await expect(owner.query(`UPDATE organizations SET legal_form = 'llc' WHERE id = $1`, [ACME])).rejects.toThrow(/listed market needs/);
    await svc(U.admin, (tx, p) => setClientProfile(tx, p, ACME, { ...input({ listedMarket: null }), legalForm: "closed_jsc" }));
    expect(await read(U.admin)).toMatchObject({ legalForm: "closed_jsc", profile: { listedMarket: null } });
  });
});
