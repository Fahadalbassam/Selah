// Client intake (baseline: Intake) against a real Postgres: the public
// submit path, who sees an inquiry, its workflow, and anonymisation.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { renderMail } from "@/lib/mail-templates";
import { enteredInquiryInput } from "@/lib/inquiry-entry";
import { enterInquiry, getInquiry, mailDecline } from "@/services/inquiries";
import { loadPrincipal } from "@/services/principal";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-d000-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const NEW_CLIENT = id(3);
const U = { admin: id(11), cons: id(12), other: id(13), cmgr: id(14), former: id(15) };

/** Run fn on the app role as `userId`, or with no user (the public form); committed when asked. */
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

const form = (extra: Record<string, unknown> = {}) => ({
  org_name: "Al-Waha Trading",
  org_name_ar: "الواحة للتجارة",
  cr_number: "1010123456",
  sector: "trade_distribution",
  employee_band: "50-249",
  ownership_type: "family_multi_partner",
  contact_name: "Sami",
  contact_role: "CEO",
  email: "Sami@Example.test",
  phone: "+966 55 000 0000",
  preferred_language: "ar",
  services: ["family_business_governance", "delegation_matrix"],
  message: "We want a family charter.",
  self_check: { has_strategy: false, has_org_chart: true },
  urgency: "within_3_months",
  heard_from: "referral",
  consent: true,
  privacy_notice_version: "2026-10-20",
  ...extra,
});
const submit = async (payload: Record<string, unknown>) =>
  (await run(null, `SELECT submit_inquiry($1::jsonb) AS ref`, [JSON.stringify(payload)])).rows[0].ref as string;
const byRef = async (ref: string) => (await owner.query(`SELECT * FROM inquiries WHERE public_ref = $1`, [ref])).rows[0];

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`TRUNCATE inquiries CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Al-Waha')`, [
    FIRM,
    ACME,
    NEW_CLIENT,
  ]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role, active) VALUES
      ($1,$6,'firm_admin',true), ($2,$6,'consultant',true), ($3,$6,'consultant',true), ($4,$7,'client_manager',true),
      ($5,$6,'consultant',false)`,
    [U.admin, U.cons, U.other, U.cmgr, U.former, FIRM, ACME],
  );
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("the public form", () => {
  it("submits through submit_inquiry only, as a new inquiry, and tells the firm admins", async () => {
    const ref = await submit(form({ status: "won", owner_user_id: U.cons, client_org_id: ACME, conflict_status: "clear" }));
    expect(ref).toMatch(/^INQ-[0-9A-F]{8}$/);
    const row = await byRef(ref);
    expect([row.status, row.owner_user_id, row.client_org_id, row.conflict_status]).toEqual(["new", null, null, "not_checked"]);
    expect([row.contact_email, row.firm_org_id]).toEqual(["sami@example.test", FIRM]);
    // Skipped questions stay unanswered rather than becoming "no".
    expect(row.self_check).toEqual({ has_strategy: false, has_org_chart: true });
    const services = await owner.query(
      `SELECT sa.code FROM inquiry_services s JOIN service_areas sa ON sa.id = s.service_area_id WHERE s.inquiry_id = $1 ORDER BY 1`,
      [row.id],
    );
    expect(services.rows.map((r) => r.code)).toEqual(["delegation_matrix", "family_business_governance"]);
    const told = await owner.query(`SELECT user_id FROM notifications WHERE entity_id = $1 AND kind = 'inquiry.new'`, [row.id]);
    expect(told.rows.map((r) => r.user_id)).toEqual([U.admin]);
  });

  it("the public cannot read or write inquiries directly, but can read the lists", async () => {
    await expect(attempt(null, `SELECT * FROM inquiries`)).resolves.toMatchObject({ rowCount: 0 });
    await expect(attempt(null, `INSERT INTO inquiries (firm_org_id, public_ref) VALUES ($1, 'x')`, [FIRM])).rejects.toThrow(
      /permission denied/,
    );
    expect((await attempt(null, `SELECT code FROM service_areas`)).rowCount).toBe(7);
    expect((await attempt(null, `SELECT code FROM sectors`)).rowCount).toBe(8);
    await expect(attempt(null, `UPDATE sectors SET active = false`)).resolves.toMatchObject({ rowCount: 0 });
  });

  it("names the invalid field", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ email: "not-an-email" }, "email"],
      [{ org_name: " " }, "org_name"],
      [{ sector: "mining" }, "sector"],
      [{ services: [] }, "services"],
      [{ services: ["strategic_plan", "astrology"] }, "services"],
      [{ employee_band: "huge" }, "employee_band"],
      [{ consent: false }, "consent"],
      [{ message: "x".repeat(2001) }, "message"],
      [{ phone: "call me" }, "phone"],
      [{ preferred_language: "fr" }, "preferred_language"],
      [{ urgency: "yesterday" }, "urgency"],
    ];
    for (const [extra, field] of cases) {
      await expect(submit(form(extra)), field).rejects.toThrow(`invalid field: ${field}`);
    }
  });

  it("allows 5 an hour from one address", async () => {
    for (let i = 0; i < 5; i++) await submit(form({ ip_hash: "ip-1" }));
    await expect(submit(form({ ip_hash: "ip-1" }))).rejects.toThrow(/too many inquiries/);
    await submit(form({ ip_hash: "ip-2" }));
  });
});

describe("who sees an inquiry", () => {
  it("the firm admin sees all; a consultant only the ones they qualify; clients none", async () => {
    const ref = await submit(form());
    const iid = (await byRef(ref)).id;
    const sees = async (uid: string) => (await attempt(uid, `SELECT 1 FROM inquiries WHERE id = $1`, [iid])).rowCount;
    expect(await sees(U.admin)).toBe(1);
    expect(await sees(U.cons)).toBe(0);
    expect(await sees(U.cmgr)).toBe(0);
    await run(U.admin, `UPDATE inquiries SET owner_user_id = $2 WHERE id = $1`, [iid, U.cons]);
    expect(await sees(U.cons)).toBe(1);
    expect(await sees(U.other)).toBe(0);
    expect((await attempt(U.cons, `SELECT 1 FROM inquiry_events WHERE inquiry_id = $1`, [iid])).rowCount).toBeGreaterThan(0);
    expect((await attempt(U.other, `SELECT 1 FROM inquiry_events WHERE inquiry_id = $1`, [iid])).rowCount).toBe(0);
    await expect(run(U.admin, `UPDATE inquiries SET owner_user_id = $2 WHERE id = $1`, [iid, U.former])).rejects.toThrow(
      /active member of the firm/,
    );
  });
});

describe("the workflow", () => {
  let iid: string;
  const set = (uid: string, sql: string) => run(uid, `UPDATE inquiries SET ${sql} WHERE id = $1`, [iid]);

  beforeAll(async () => {
    iid = (await byRef(await submit(form()))).id;
    await run(U.admin, `UPDATE inquiries SET owner_user_id = $2 WHERE id = $1`, [iid, U.cons]);
  });

  it("the owner moves it forward and cannot decide the outcome or touch anything else", async () => {
    await set(U.cons, `status = 'triaged'`);
    await set(U.cons, `status = 'discovery_scheduled'`);
    await run(
      U.cons,
      `INSERT INTO discovery_sessions (inquiry_id, scheduled_at, mode, created_by) VALUES ($1, now(), 'video', $2)`,
      [iid, U.cons],
    );
    await set(U.cons, `status = 'discovery_done'`);
    await expect(set(U.cons, `status = 'won'`)).rejects.toThrow(/invalid inquiry status change/);
    await expect(set(U.cons, `conflict_status = 'flagged'`)).rejects.toThrow(/not allowed/);
    await expect(set(U.cons, `owner_user_id = '${U.other}'`)).rejects.toThrow(/not allowed/);
    await expect(set(U.cons, `contact_email = 'x@y.z'`)).rejects.toThrow(/not allowed/);
    await set(U.cons, `status = 'proposal_sent'`);
    await run(
      U.cons,
      `INSERT INTO inquiry_events (inquiry_id, actor_id, event, note) VALUES ($1,$2,'note','Sent the proposal')`,
      [iid, U.cons],
    );
    await expect(
      run(U.cons, `INSERT INTO inquiry_events (inquiry_id, actor_id, event, to_status) VALUES ($1,$2,'status_changed','won')`, [
        iid,
        U.cons,
      ]),
    ).rejects.toThrow(/row-level security/);
  });

  it("winning needs a conflict check, and a won inquiry becomes a client once", async () => {
    await expect(set(U.admin, `status = 'won'`)).rejects.toThrow(/check for conflicts/);
    await expect(set(U.admin, `conflict_status = 'waived'`)).rejects.toThrow(/say what the conflict is/);
    await expect(set(U.admin, `conflict_status = 'clear'`)).rejects.toThrow(/run the conflict search before clearing/);
    await run(U.admin, `SELECT app_record_conflict_search($1, NULL)`, [iid]);
    await set(U.admin, `conflict_status = 'clear'`);
    await expect(set(U.admin, `client_org_id = '${NEW_CLIENT}'`)).rejects.toThrow(/becomes a client once/);
    await set(U.admin, `status = 'won'`);
    await set(U.admin, `client_org_id = '${NEW_CLIENT}'`);
    await expect(set(U.admin, `client_org_id = '${ACME}'`)).rejects.toThrow(/becomes a client once/);
    const row = (await owner.query(`SELECT * FROM inquiries WHERE id = $1`, [iid])).rows[0];
    expect([row.conflict_checked_by, row.converted_by, row.purge_after]).toEqual([U.admin, U.admin, null]);
    const events = await owner.query(`SELECT event FROM inquiry_events WHERE inquiry_id = $1 ORDER BY created_at, event`, [iid]);
    expect(events.rows.map((r) => r.event)).toEqual(
      expect.arrayContaining(["submitted", "owner_changed", "status_changed", "note", "conflict_checked", "converted"]),
    );
    await expect(owner.query(`DELETE FROM inquiry_events WHERE inquiry_id = $1`, [iid])).rejects.toThrow(/append-only/);
  });
});

describe("the inquiry page", () => {
  const detail = (uid: string, iid: string) =>
    as(uid, async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return getInquiry(tx, (await loadPrincipal(tx, uid))!, iid);
    });

  it("tells each person what they may do, and never shows the rate-limit hashes", async () => {
    const iid = (await byRef(await submit(form()))).id;
    await run(U.admin, `UPDATE inquiries SET owner_user_id = $2 WHERE id = $1`, [iid, U.cons]);
    const admin = await detail(U.admin, iid);
    expect(admin.can).toEqual({ work: true, decide: true, forward: "triaged", declineMail: false, convert: false });
    expect(admin.inquiry).not.toHaveProperty("ipHash");
    expect(admin.inquiry).not.toHaveProperty("userAgentHash");
    expect((await detail(U.cons, iid)).can).toEqual({ work: true, decide: false, forward: "triaged", declineMail: false, convert: false });
    await expect(detail(U.other, iid)).rejects.toThrow(/not found/i);

    // After discovery and a clear check, the admin may make it a client.
    await run(U.cons, `UPDATE inquiries SET status = 'triaged' WHERE id = $1`, [iid]);
    await run(U.cons, `UPDATE inquiries SET status = 'discovery_scheduled' WHERE id = $1`, [iid]);
    await run(U.cons, `INSERT INTO discovery_sessions (inquiry_id, scheduled_at, mode, created_by) VALUES ($1, now(), 'video', $2)`, [iid, U.cons]);
    await run(U.cons, `UPDATE inquiries SET status = 'discovery_done' WHERE id = $1`, [iid]);
    expect((await detail(U.admin, iid)).can.convert).toBe(false);
    await run(U.admin, `SELECT app_record_conflict_search($1, NULL)`, [iid]);
    await run(U.admin, `UPDATE inquiries SET conflict_status = 'clear' WHERE id = $1`, [iid]);
    expect((await detail(U.admin, iid)).can).toMatchObject({ convert: true, forward: "proposal_sent" });
    expect((await detail(U.cons, iid)).can.convert).toBe(false);
  });
});

describe("retention", () => {
  it("closing sets a purge date, and the job clears exactly the requester's details", async () => {
    const spam = (await byRef(await submit(form({ ip_hash: "ip-9" })))).id;
    const lost = (await byRef(await submit(form()))).id;
    await run(U.admin, `UPDATE inquiries SET status = 'spam' WHERE id = $1`, [spam]);
    await run(U.admin, `UPDATE inquiries SET status = 'lost' WHERE id = $1`, [lost]);
    const dates = await owner.query(`SELECT id, purge_after - (closed_at AT TIME ZONE 'Asia/Riyadh')::date AS days FROM inquiries WHERE id IN ($1, $2)`, [
      spam,
      lost,
    ]);
    const days = Object.fromEntries(dates.rows.map((r) => [r.id, r.days]));
    expect(days[spam]).toBe(30);
    expect(days[lost]).toBeGreaterThanOrEqual(365);

    await expect(attempt(U.admin, `SELECT app_purge_inquiries('2099-01-01')`)).rejects.toThrow(/permission denied/);
    const n = Number((await owner.query(`SELECT app_purge_inquiries('2099-01-01') AS n`)).rows[0].n);
    expect(n).toBe(2);
    const row = (await owner.query(`SELECT * FROM inquiries WHERE id = $1`, [lost])).rows[0];
    const cleared = [
      "org_name",
      "org_name_ar",
      "cr_number",
      "contact_name",
      "contact_role",
      "contact_email",
      "contact_phone",
      "message",
      "ip_hash",
      "user_agent_hash",
    ];
    for (const col of cleared) expect(row[col], col).toBeNull();
    expect(row.anonymised_at).not.toBeNull();
    // Kept for statistics.
    expect([row.employee_band, row.ownership_type, row.status, row.sector_id === null]).toEqual([
      "50-249",
      "family_multi_partner",
      "lost",
      false,
    ]);
    expect(Number((await owner.query(`SELECT count(*) FROM inquiry_services WHERE inquiry_id = $1`, [lost])).rows[0].count)).toBe(
      2,
    );
    // A won inquiry is never purged, and jobs cannot change anything else.
    expect(Number((await owner.query(`SELECT app_purge_inquiries('2099-01-01') AS n`)).rows[0].n)).toBe(0);
    await expect(owner.query(`UPDATE inquiries SET status = 'won' WHERE id = $1`, [lost])).rejects.toThrow(/only anonymise/);
  });
});

describe("mails to the requester", () => {
  const detail = (uid: string, iid: string) =>
    as(uid, async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return getInquiry(tx, (await loadPrincipal(tx, uid))!, iid);
    });
  const mails = async (to: string) =>
    (
      await owner.query(`SELECT kind, reference, locale FROM outbound_emails WHERE lower(to_email) = lower($1) ORDER BY created_at`, [to])
    ).rows;
  const svc = <R>(userId: string, fn: (tx: Tx, p: Awaited<ReturnType<typeof loadPrincipal>>) => Promise<R>) =>
    as(userId, async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, await loadPrincipal(tx, userId));
    }, true);

  it("acknowledge each new inquiry with its reference, at most once a day to an address", async () => {
    const to = "ack@example.test";
    const ref = await submit(form({ email: to, preferred_language: "en" }));
    expect(await mails(to)).toEqual([{ kind: "inquiry.received", reference: ref, locale: "en" }]);
    const iid = (await byRef(ref)).id;
    expect((await owner.query(`SELECT event FROM inquiry_events WHERE inquiry_id = $1 ORDER BY event`, [iid])).rows.map((r) => r.event)).toEqual([
      "acknowledged",
      "submitted",
    ]);
    // A second inquiry from the same address the same day is stored, but not acknowledged again.
    const again = await submit(form({ email: "ACK@example.test" }));
    expect(await mails(to)).toHaveLength(1);
    expect((await owner.query(`SELECT 1 FROM inquiry_events e JOIN inquiries i ON i.id = e.inquiry_id WHERE i.public_ref = $1 AND e.event = 'acknowledged'`, [again])).rowCount).toBe(0);
  });

  it("only carry an inquiry's reference, and render it in both languages", async () => {
    await expect(owner.query(`INSERT INTO outbound_emails (to_email, kind, reference) VALUES ('x@example.test', 'invitation', 'INQ-1')`)).rejects.toThrow(
      /outbound_reference/,
    );
    const m = renderMail("inquiry.declined", null, "https://selah.example", "INQ-ABCD1234");
    expect(m.text.match(/INQ-ABCD1234/g)).toHaveLength(2);
    expect(m.text).not.toContain("{ref}");
  });

  it("send a courteous decline once, by the firm admin, for a lost or declined inquiry", async () => {
    const to = "decline@example.test";
    const iid = (await byRef(await submit(form({ email: to })))).id;
    const decline = (who: string) => svc(who, (tx, p) => mailDecline(tx, p!, iid));
    // Still open.
    await expect(decline(U.admin)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/closed as lost or declined/) } });
    await run(U.admin, `UPDATE inquiries SET owner_user_id = $2, status = 'declined' WHERE id = $1`, [iid, U.cons]);
    expect((await detail(U.cons, iid)).can.declineMail).toBe(false);
    expect((await detail(U.admin, iid)).can.declineMail).toBe(true);
    await expect(decline(U.cons)).rejects.toThrow(/forbidden/);
    // Straight to the function, a consultant is refused too.
    await expect(run(U.cons, `SELECT app_mail_inquiry_decline($1)`, [iid])).rejects.toThrow(/only the firm admin/);
    await decline(U.admin);
    expect((await mails(to)).map((m) => m.kind)).toEqual(["inquiry.received", "inquiry.declined"]);
    expect((await detail(U.admin, iid)).can.declineMail).toBe(false);
    await expect(decline(U.admin)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/already sent/) } });
  });

  it("never go out once the requester's details are removed", async () => {
    const iid = (await byRef(await submit(form({ email: "gone@example.test" })))).id;
    await run(U.admin, `UPDATE inquiries SET status = 'lost' WHERE id = $1`, [iid]);
    await owner.query(`UPDATE inquiries SET anonymised_at = now(), contact_email = NULL, contact_name = NULL, org_name = NULL WHERE id = $1`, [iid]);
    await expect(run(U.admin, `SELECT app_mail_inquiry_decline($1)`, [iid])).rejects.toThrow(/no longer kept/);
  });
});

describe("inquiries entered by firm staff", () => {
  const svc = <R>(userId: string, fn: (tx: Tx, p: NonNullable<Awaited<ReturnType<typeof loadPrincipal>>>) => Promise<R>) =>
    as(
      userId,
      async (c) => {
        const tx = drizzle(c, { schema }) as unknown as Tx;
        return fn(tx, (await loadPrincipal(tx, userId))!);
      },
      true,
    );
  // The test ids aren't RFC 4122 variants, so the client id joins after the form's check.
  const entry = ({ sourceClientOrgId, ...fields }: Record<string, unknown>) => ({
    ...enteredInquiryInput.parse({
      orgName: "Al-Rimal Holding",
      sector: "trade_distribution",
      services: ["delegation_matrix"],
      ...fields,
      ...(sourceClientOrgId ? { sourceClientOrgId: "6f1c2a52-6a5b-4b7e-9c1d-2f0b8e3a4d5c" } : {}),
    }),
    sourceClientOrgId: sourceClientOrgId as string | undefined,
  });
  const enter = (who: string, fields: Record<string, unknown>) => svc(who, (tx, p) => enterInquiry(tx, p, entry(fields)));

  it("the admin enters a referral: no consent asked, no mail to anyone, logged as entered", async () => {
    const before = Number((await owner.query(`SELECT count(*) FROM outbound_emails`)).rows[0].count);
    const { id: iid } = await enter(U.admin, { source: "referral", sourceClientOrgId: ACME, contactName: "Huda", email: "huda@rimal.example" });
    const row = (await owner.query(`SELECT * FROM inquiries WHERE id = $1`, [iid])).rows[0];
    expect(row).toMatchObject({ source: "referral", entered_by: U.admin, source_client_org_id: ACME, owner_user_id: null, status: "new", consented_at: null });
    expect(Number((await owner.query(`SELECT count(*) FROM outbound_emails`)).rows[0].count)).toBe(before);
    expect((await owner.query(`SELECT event, actor_id FROM inquiry_events WHERE inquiry_id = $1`, [iid])).rows).toEqual([{ event: "entered", actor_id: U.admin }]);
  });

  it("a consultant enters their own approach, owns it, and the admins are told", async () => {
    const { id: iid } = await enter(U.cons, { source: "firm_outreach" });
    expect((await owner.query(`SELECT owner_user_id FROM inquiries WHERE id = $1`, [iid])).rows[0].owner_user_id).toBe(U.cons);
    expect((await owner.query(`SELECT user_id FROM notifications WHERE entity_id = $1 AND kind = 'inquiry.new'`, [iid])).rows).toEqual([{ user_id: U.admin }]);
    const seen = await svc(U.cons, (tx, p) => getInquiry(tx, p, iid));
    expect(seen.inquiry).toMatchObject({ source: "firm_outreach", enteredByName: "cons", employeeBand: null });
    // Another consultant doesn't see it.
    expect((await attempt(U.other, `SELECT 1 FROM inquiries WHERE id = $1`, [iid])).rowCount).toBe(0);
  });

  it("names only clients the person can see, and only firm staff enter", async () => {
    await expect(enter(U.cons, { source: "existing_client", sourceClientOrgId: ACME })).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/source_client_org_id/) },
    });
    await expect(enter(U.cmgr, { source: "referral" })).rejects.toThrow();
    const payload = JSON.stringify({ source: "referral", org_name: "X", sector: "trade_distribution" });
    await expect(run(U.cmgr, `SELECT app_enter_inquiry($1::jsonb)`, [payload])).rejects.toThrow(/only firm staff/);
    await expect(run(null, `SELECT app_enter_inquiry($1::jsonb)`, [payload])).rejects.toThrow(/only firm staff/);
    // The public form's source can't be typed in.
    await expect(run(U.admin, `SELECT app_enter_inquiry($1::jsonb)`, [JSON.stringify({ source: "website", org_name: "X", sector: "trade_distribution" })])).rejects.toThrow(
      /invalid field: source/,
    );
  });

  it("a tender carries its number, and only a tender does; a returning client names the client", async () => {
    const { id: iid } = await enter(U.admin, { source: "tender", tenderNumber: "250139001234", tenderClosesOn: "2026-12-01" });
    expect((await owner.query(`SELECT tender_number, tender_closes_on::text AS closes FROM inquiries WHERE id = $1`, [iid])).rows[0]).toEqual({
      tender_number: "250139001234",
      closes: "2026-12-01",
    });
    expect(enteredInquiryInput.safeParse({ source: "tender", orgName: "X", sector: "s" }).success).toBe(false);
    expect(enteredInquiryInput.safeParse({ source: "referral", orgName: "X", sector: "s", tenderNumber: "1" }).success).toBe(false);
    expect(enteredInquiryInput.safeParse({ source: "existing_client", orgName: "X", sector: "s" }).success).toBe(false);
    // The database says the same, past the form.
    for (const p of [{ source: "tender" }, { source: "referral", tender_number: "1" }, { source: "existing_client" }]) {
      await expect(run(U.admin, `SELECT app_enter_inquiry($1::jsonb)`, [JSON.stringify({ org_name: "X", sector: "trade_distribution", ...p })]), p.source).rejects.toThrow(
        /inquiry_tender_fields|inquiry_source_client/,
      );
    }
  });

  it("the public form still needs consent, size and ownership", async () => {
    await expect(
      owner.query(
        `INSERT INTO inquiries (firm_org_id, public_ref, org_name, contact_name, contact_email, sector_id, preferred_language, self_check)
         SELECT $1, 'INQ-TEST0001', 'X', 'Y', 'y@example.test', id, 'ar', '{}' FROM sectors LIMIT 1`,
        [FIRM],
      ),
    ).rejects.toThrow(/inquiry_website_fields/);
  });
});
