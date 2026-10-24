// The conflict search, the qualification card and the NDA marker (wave 1,
// item 8) against a real Postgres: what the search finds and for whom, the
// snapshot it keeps, clearing after a search, rating, and the NDA date.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import type { Principal } from "@/authz";
import { qualificationInput } from "@/lib/qualification";
import { latestConflictSearch, runConflictSearch } from "@/services/conflicts";
import { getInquiry, markNda, rateInquiry } from "@/services/inquiries";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-c300-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const NUKHBA = id(2); // a current client
const BAYAN = id(3); // a past client
const PITCH = id(4); // a prospect the firm is pitching
const U = { admin: id(11), cons: id(12), other: id(13), fahd: id(14) };

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
const attempt = (userId: string | null, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params));
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>, commit = false) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    commit,
  );
const dbError = (re: RegExp) => ({ cause: { message: expect.stringMatching(re) } });

const submit = async (extra: Record<string, unknown>) => {
  const form = {
    org_name: "Nukhba Holding",
    org_name_ar: "النخبة القابضة",
    sector: "trade_distribution",
    employee_band: "50-249",
    ownership_type: "family_multi_partner",
    contact_name: "Omar Al-Rashid",
    email: "omar@nukhba.sa",
    preferred_language: "ar",
    services: ["family_business_governance"],
    self_check: {},
    consent: true,
    privacy_notice_version: "2026-10-20",
    requester_role: "ceo",
    why_now: "A new board wants it settled this year.",
    ...extra,
  };
  const ref = (await run(null, `SELECT submit_inquiry($1::jsonb) AS ref`, [JSON.stringify(form)])).rows[0].ref as string;
  const iid = (await owner.query(`SELECT id FROM inquiries WHERE public_ref = $1`, [ref])).rows[0].id as string;
  await run(U.admin, `UPDATE inquiries SET owner_user_id = $2 WHERE id = $1`, [iid, U.cons]);
  return iid;
};

let iid: string; // "Nukhba Holding", owned by cons
let earlier: string; // another inquiry with a similar name

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`TRUNCATE inquiries CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, name_ar, allowed_email_domains, prospect) VALUES
      ($1,'firm','firm',NULL,NULL,false),
      ($2,'client','Al-Nukhba Holding Co.','شركة النخبة القابضة','{nukhba.sa}',false),
      ($3,'client','Bayan Partners',NULL,NULL,false),
      ($4,'client','Dar Al-Bayan',NULL,NULL,true)`,
    [FIRM, NUKHBA, BAYAN, PITCH],
  );
  for (const [key, uid, name, email] of [
    ["admin", U.admin, "Sara", "sara@firm.test"],
    ["cons", U.cons, "Khalid", "khalid@firm.test"],
    ["other", U.other, "Noura", "noura@firm.test"],
    ["fahd", U.fahd, "Fahd Al-Rashid", "fahd@nukhba.sa"],
  ]) {
    void key;
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, email]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role, active) VALUES
      ($1,$5,'firm_admin',true), ($2,$5,'consultant',true), ($3,$5,'consultant',true), ($4,$6,'client_admin',true)`,
    [U.admin, U.cons, U.other, U.fahd, FIRM, NUKHBA],
  );
  await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Governance','active',$4)`, [
    id(21),
    NUKHBA,
    FIRM,
    U.admin,
  ]);
  earlier = await submit({ org_name: "Nukhba Investments", org_name_ar: null, contact_name: "Lina", email: "lina@gmail.com" });
  await submit({ org_name: "Al Bayan Consulting", org_name_ar: null, contact_name: "Huda", email: "huda@bayan-consulting.sa" });
  iid = await submit({});
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("names", () => {
  it("compares words, not spellings: Arabic letters unified, legal words and a leading al dropped", async () => {
    const { rows } = await owner.query(
      `SELECT app_name_words('شركة النخبة القابضة') AS ar, app_name_words('Al-Nukhba Holding Co.') AS en,
              app_name_words('مؤسسة الإنْجاز للتجارة') AS diacritics, app_family_name('Omar Al-Rashid') AS family, app_family_name('Ali') AS short`,
    );
    expect(rows[0]).toEqual({ ar: ["نخبه"], en: ["nukhba"], diacritics: ["انجاز"], family: "rashid", short: null });
  });
});

describe("the conflict search", () => {
  it("finds the current client by name, mail domain and family, and the similar inquiry, and keeps it", async () => {
    const started = new Date();
    await svc(U.admin, (tx, p) => runConflictSearch(tx, p, { inquiryId: iid }), true);
    const s = (await svc(U.admin, (tx) => latestConflictSearch(tx, { inquiryId: iid })))!;
    expect(s.searchedBy).toBe("Sara");
    expect(s.terms).toEqual({ names: expect.arrayContaining(["Nukhba Holding", "النخبة القابضة"]), person: "Omar Al-Rashid", domain: "nukhba.sa" });
    const client = s.matches.find((m) => m.id === NUKHBA)!;
    expect(client).toMatchObject({ kind: "client", status: "current", reasons: ["domain", "family", "same_name"], people: ["Fahd Al-Rashid"] });
    expect(s.matches.find((m) => m.id === earlier)).toMatchObject({ kind: "inquiry", status: "new", reasons: ["similar_name"] });
    // A free mail domain matches nobody, and the inquiry never finds itself.
    expect(s.matches.some((m) => m.id === iid)).toBe(false);
    expect(s.matches.map((m) => m.id)).not.toContain(BAYAN);
    const audited = await owner.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'conflict.search' AND resource_id = $1 AND created_at >= $2`, [
      iid,
      started,
    ]);
    expect(audited.rows[0].n).toBe(1);
  });

  it("checks a pitch against past clients and open inquiries, never against itself", async () => {
    await svc(U.admin, (tx, p) => runConflictSearch(tx, p, { orgId: PITCH }), true);
    const s = (await svc(U.admin, (tx) => latestConflictSearch(tx, { orgId: PITCH })))!;
    expect(s.matches.map((m) => [m.kind, m.status, m.reasons])).toEqual([
      ["client", "past", ["similar_name"]],
      ["inquiry", "new", ["similar_name"]],
    ]);
    expect(s.matches.some((m) => m.id === PITCH)).toBe(false);
  });

  it("is the firm admin's alone: no one else runs it, reads it or gets matches", async () => {
    for (const who of [U.cons, U.other, U.fahd]) {
      await expect(attempt(who, `SELECT app_record_conflict_search($1, NULL)`, [iid]), who).rejects.toThrow(/only the firm admin searches/);
      expect((await attempt(who, `SELECT * FROM conflict_searches`)).rowCount, who).toBe(0);
      expect((await attempt(who, `SELECT * FROM app_conflict_matches(ARRAY['Nukhba'], NULL, 'x@nukhba.sa', NULL, NULL)`)).rowCount, who).toBe(0);
    }
    await expect(svc(U.cons, (tx, p) => runConflictSearch(tx, p, { inquiryId: iid }))).rejects.toThrow(/forbidden/);
    expect((await svc(U.cons, (tx, p) => getInquiry(tx, p, iid))).conflictSearch).toBeNull();
    expect((await svc(U.admin, (tx, p) => getInquiry(tx, p, iid))).conflictSearch?.matches.length).toBeGreaterThan(0);
  });

  it("keeps each search as it was: nobody changes or deletes it", async () => {
    await expect(attempt(U.admin, `UPDATE conflict_searches SET matches = '[]'`)).rejects.toThrow(/permission denied/);
    await expect(attempt(U.admin, `DELETE FROM conflict_searches`)).rejects.toThrow(/permission denied/);
    await expect(owner.query(`UPDATE conflict_searches SET matches = '[]'`)).rejects.toThrow(/append-only|cannot be changed|forbid/i);
  });

  it("clears an inquiry only after a search, and a search needs one subject", async () => {
    await expect(attempt(U.admin, `UPDATE inquiries SET conflict_status = 'clear' WHERE id = $1`, [earlier])).rejects.toThrow(
      /run the conflict search before clearing/,
    );
    await expect(attempt(U.admin, `UPDATE inquiries SET conflict_status = 'clear' WHERE id = $1`, [iid])).resolves.toMatchObject({ rowCount: 1 });
    await expect(attempt(U.admin, `SELECT app_record_conflict_search(NULL, NULL)`)).rejects.toThrow(/only the firm admin searches/);
    await expect(attempt(U.admin, `SELECT app_record_conflict_search($1, $2)`, [iid, PITCH])).rejects.toThrow(/only the firm admin searches/);
  });
});

describe("the qualification card", () => {
  const rating = qualificationInput.parse({ fit: "3", need: 2, authority: 1, urgency: 3, budget: 2, note: " Board meets in March " });

  it("is rated by whoever works the inquiry, again and again, and records who rated it", async () => {
    await svc(U.cons, (tx, p) => rateInquiry(tx, p, iid, rating), true);
    await svc(U.admin, (tx, p) => rateInquiry(tx, p, iid, { ...rating, budget: 3 }), true);
    const q = (await svc(U.cons, (tx, p) => getInquiry(tx, p, iid))).qualification!;
    expect(q).toMatchObject({ fit: 3, need: 2, authority: 1, urgency: 3, budget: 3, note: "Board meets in March", ratedBy: U.admin, raterName: "Sara" });
  });

  it("refuses ratings outside 1 to 3, other consultants, someone else's name, and closed inquiries", async () => {
    expect(qualificationInput.safeParse({ ...rating, fit: 4 }).success).toBe(false);
    await expect(
      attempt(U.cons, `UPDATE inquiry_qualifications SET fit = 4, rated_by = $2 WHERE inquiry_id = $1`, [iid, U.cons]),
    ).rejects.toThrow(/inquiry_qualification_range/);
    await expect(svc(U.other, (tx, p) => rateInquiry(tx, p, iid, rating))).rejects.toThrow();
    await expect(
      attempt(U.other, `INSERT INTO inquiry_qualifications (inquiry_id, fit, need, authority, urgency, budget, rated_by) VALUES ($1,1,1,1,1,1,$2)`, [
        earlier,
        U.other,
      ]),
    ).rejects.toThrow(/row-level security/);
    await expect(
      attempt(U.cons, `INSERT INTO inquiry_qualifications (inquiry_id, fit, need, authority, urgency, budget, rated_by) VALUES ($1,1,1,1,1,1,$2)`, [
        earlier,
        U.admin,
      ]),
    ).rejects.toThrow(/row-level security/);
    await run(U.admin, `UPDATE inquiries SET status = 'spam' WHERE id = $1`, [earlier]);
    await expect(svc(U.admin, (tx, p) => rateInquiry(tx, p, earlier, rating))).rejects.toThrow(/rated while it is open/);
    await expect(
      attempt(U.admin, `INSERT INTO inquiry_qualifications (inquiry_id, fit, need, authority, urgency, budget, rated_by) VALUES ($1,1,1,1,1,1,$2)`, [
        earlier,
        U.admin,
      ]),
    ).rejects.toThrow(/rated while it is open/);
  });
});

describe("the NDA marker", () => {
  it("records the day in the history; a later entry corrects it; never a future day", async () => {
    await svc(U.cons, (tx, p) => markNda(tx, p, iid, "2026-10-01"), true);
    await svc(U.admin, (tx, p) => markNda(tx, p, iid, "2026-10-02"), true);
    expect((await svc(U.cons, (tx, p) => getInquiry(tx, p, iid))).inquiry.ndaSignedOn).toBe("2026-10-02");
    await expect(svc(U.cons, (tx, p) => markNda(tx, p, iid, "2999-01-01"))).rejects.toMatchObject(dbError(/on or before today/));
  });

  it("is for the owner and the firm admin only", async () => {
    await expect(svc(U.other, (tx, p) => markNda(tx, p, iid, "2026-10-01"))).rejects.toThrow();
    await expect(attempt(U.other, `SELECT app_mark_inquiry_nda($1, '2026-10-01')`, [iid])).rejects.toThrow(/owner or the firm admin/);
    await expect(attempt(U.fahd, `SELECT app_mark_inquiry_nda($1, '2026-10-01')`, [iid])).rejects.toThrow(/owner or the firm admin/);
  });
});
