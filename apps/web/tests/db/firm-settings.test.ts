// Firm settings (migration 0044) against a real Postgres: only the firm's
// admins change them, the database keeps every value in range, and the
// intake address gets one link per new inquiry.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { getFirmSettings, updateFirmSettings } from "@/services/firm-settings";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-e100-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const U = { admin: id(11), cons: id(12), cadmin: id(13) };

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
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    true,
  );
const write = (userId: string, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params));

const form = {
  org_name: "Al-Waha Trading",
  contact_name: "Sami",
  email: "sami@example.test",
  preferred_language: "ar",
  sector: "trade_distribution",
  employee_band: "50-249",
  ownership_type: "family_multi_partner",
  services: ["delegation_matrix"],
  consent: true,
  privacy_notice_version: "2026-10-20",
};
const submit = () => as(null, (c) => c.query(`SELECT submit_inquiry($1::jsonb) AS ref`, [JSON.stringify(form)]), true);

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`TRUNCATE inquiries CASCADE`);
  await q(`TRUNCATE outbound_emails, audit_log`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme')`, [FIRM, ACME]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role, active) VALUES ($1,$4,'firm_admin',true), ($2,$4,'consultant',true), ($3,$5,'client_admin',true)`,
    [U.admin, U.cons, U.cadmin, FIRM, ACME],
  );
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("firm settings", () => {
  it("show the defaults until the first save, and are the firm admin's alone", async () => {
    const first = await svc(U.admin, (tx, p) => getFirmSettings(tx, p));
    expect(first.updatedAt).toBeNull();
    expect(first.settings).toMatchObject({ intakeEmail: null, checkinDays: [30, 60, 90], accessReviewDays: 90 });
    await expect(svc(U.cons, (tx, p) => getFirmSettings(tx, p))).rejects.toThrow();
    await expect(svc(U.cadmin, (tx, p) => updateFirmSettings(tx, p, { staleDays: 3 }))).rejects.toThrow();
    // Under the service too: the table refuses a consultant's write.
    await expect(write(U.cons, `INSERT INTO firm_settings (org_id, stale_days) VALUES ($1, 3)`, [FIRM])).rejects.toThrow(
      /row-level security/,
    );
  });

  it("save only the fields sent, tidy the lists, and log field names only", async () => {
    const saved = await svc(U.admin, (tx, p) =>
      updateFirmSettings(tx, p, { intakeEmail: " Inquiries@Firm.Example ", checkinDays: [90, 30, 30] }),
    );
    expect(saved.settings).toMatchObject({ intakeEmail: "inquiries@firm.example", checkinDays: [30, 90], staleDays: 14 });
    expect(saved.updatedAt).not.toBeNull();
    await svc(U.admin, (tx, p) => updateFirmSettings(tx, p, { staleDays: 21 }));
    const now = (await svc(U.admin, (tx, p) => getFirmSettings(tx, p))).settings;
    expect(now).toMatchObject({ staleDays: 21, intakeEmail: "inquiries@firm.example" });
    const log = (await owner.query(`SELECT meta FROM audit_log WHERE action = 'firm_settings.update' ORDER BY created_at`)).rows;
    expect(log.map((r) => r.meta.fields)).toEqual(["intakeEmail,checkinDays", "staleDays"]);
    expect(JSON.stringify(log)).not.toContain("firm.example");
  });

  it("keep every value in range in the database", async () => {
    for (const [sql, params] of [
      [`UPDATE firm_settings SET stale_days = 0`, []],
      [`UPDATE firm_settings SET kpi_grace_days = 91`, []],
      [`UPDATE firm_settings SET access_review_days = 3`, []],
      [`UPDATE firm_settings SET checkin_days = '{60,30}'`, []],
      [`UPDATE firm_settings SET checkin_days = '{0}'`, []],
      [`UPDATE firm_settings SET checkin_days = '{1,2,3,4,5,6,7}'`, []],
      [`UPDATE firm_settings SET intake_email = 'not an address'`, []],
    ] as const) {
      await expect(write(U.admin, sql, [...params]), sql).rejects.toThrow(/check constraint/);
    }
    await write(U.admin, `UPDATE firm_settings SET checkin_days = '{}'`);
  });

  it("send each new inquiry to the intake address as a link, and nothing when it is empty", async () => {
    await submit();
    const mails = (await owner.query(`SELECT to_email, kind, link FROM outbound_emails`)).rows;
    const [inq] = (await owner.query(`SELECT id FROM inquiries`)).rows;
    expect(mails).toEqual([{ to_email: "inquiries@firm.example", kind: "inquiry.new", link: `/inquiries/${inq.id}` }]);
    await svc(U.admin, (tx, p) => updateFirmSettings(tx, p, { intakeEmail: "" }));
    await submit();
    expect((await owner.query(`SELECT count(*)::int AS n FROM outbound_emails`)).rows[0].n).toBe(1);
  });
});
