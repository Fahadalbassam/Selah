// A deliverable handed over, and the client confirms receipt (F21 in its
// minimal form; the gate A follow-ups of 17 Nov 2026, 4a; migration
// 0092_deliverable_receipts) against a real Postgres. Another client never
// reaches it; only the client's acceptor, admin or sponsor answers, asked in
// that order; the firm records a receipt only for a client it runs; a receipt
// keeps the exact versions; the reminder goes once after ten Saudi working
// days; a comment reaches the lead; the closure report lists the receipts
// (the export pack's are in export-pack.test.ts). "Received" is receipt only.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { DELIVERABLE_REMINDER_WORKING_DAYS } from "@/lib/deliverables";
import { truncateAuditLog } from "./audit-reset";

// The closure report is drawn by the PDF service; here its HTML is kept to read.
const rendered: string[] = [];
vi.mock("@/services/pdf", () => ({
  renderPdf: async (html: string) => {
    rendered.push(html);
    return new Uint8Array([37, 80, 68, 70]);
  },
}));
// Exports translate on the server; outside a request, the real messages through next-intl's own translator.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = { ar: (await import("../../messages/ar.json")).default, en: (await import("../../messages/en.json")).default };
  return {
    getTranslations: async ({ locale, namespace }: { locale: "ar" | "en"; namespace?: string }) =>
      createTranslator({ locale, messages: messages[locale], namespace: namespace as never }),
  };
});

const { commentOnDeliverable, getDeliverable, handOverChoices, handOverDeliverable, handOverPreview, listDeliverables, recordReceipt } = await import(
  "@/services/deliverables"
);
const { getEngagement, removeDeliverable } = await import("@/services/engagements");
const { listNotifications } = await import("@/services/notifications");
const { today } = await import("@/services/today");
const { getClosure, moveClosure, writeLessons } = await import("@/services/closure");
const { closurePdf } = await import("@/services/exports");
const { loadPrincipal } = await import("@/services/principal");
const { addValue } = await import("@/services/indicators");
const { shareDocument } = await import("@/services/documents");

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-d1d1-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2); // full, departments on
const BETA = id(3); // another client
const WAHA = id(4); // the firm runs it: no accounts
const U = {
  admin: id(11), // firm admin
  lead: id(12), // Acme's lead consultant
  deputy: id(13), // Acme's deputy
  cons: id(14), // staffed on Acme's project
  obs: id(15), // observes Acme's project
  bench: id(16), // on Acme's team, staffed on nothing
  wlead: id(17), // Waha's lead
  cadmin: id(21), // Acme's admin
  acceptor: id(22), // Acme's manager, the project's acceptor, in no department
  sponsor: id(23), // Acme's manager, the project's sponsor
  mgr: id(24), // Acme's manager on the project, no client role
  owner: id(25), // Acme's action owner on the project
  betaAdmin: id(31),
  hr: id(18), // on Acme's team, staffed only on the project of Acme's other engagement
};
const P = { acme: id(41), closing: id(42), beta: id(43), waha: id(44), hr: id(45) };
const G = { acme: id(51), beta: id(52), waha: id(53), hr: id(54) };
const FIN = id(61); // Acme's Finance department

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
/** A service call as a person, committed; the database's own words come up when it refuses. */
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!).catch((e: Error & { cause?: Error }) => {
        throw new Error(e.cause ? `${e.message} | ${e.cause.message}` : e.message);
      });
    },
    true,
  );
const sqlAs = (userId: string, text: string, params: unknown[] = []) => as(userId, (c) => c.query(text, params), true);
const q = (text: string, params: unknown[] = []) => owner.query(text, params);

let n = 100;
/** A deliverable of an engagement, tied to a project or not. */
async function deliverable(engagement: string, project: string | null, title: string) {
  const did = id(n++);
  await q(`INSERT INTO engagement_deliverables (id, engagement_id, project_id, title, created_by) VALUES ($1,$2,$3,$4,$5)`, [did, engagement, project, title, U.admin]);
  return did;
}
/** A deliverable file the firm uploaded, cleared by the scan. */
async function file(org: string, project: string, title: string, opts: { visibility?: string; department?: string | null; supersedes?: string; version?: number } = {}) {
  const fid = id(n++);
  await q(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, department_id, version, supersedes_id,
       storage_key, content_type, size_bytes, sha256, scan_status)
     VALUES ($1,$2,$3,$4,$5,'deliverable','submitted',$6,$7,$8,$9,$10,$11,'application/pdf',10,repeat('a',64),'clean')`,
    [fid, project, org, FIRM, U.lead, title, opts.visibility ?? "shared", opts.department ?? null, opts.version ?? 1, opts.supersedes ?? null, `documents/${fid}`],
  );
  return fid;
}
const handOver = (who: string, did: string, versions: string[]) => svc(who, (tx, p) => handOverDeliverable(tx, p, did, versions));
const told = async (kind: string, did: string) =>
  (await q(`SELECT user_id FROM notifications WHERE kind = $1 AND entity_id = $2 ORDER BY user_id`, [kind, did])).rows.map((r) => r.user_id);
/** The first day with `target` working days after `day`, counted by the database. */
async function afterWorkingDays(day: string, target: number): Promise<string> {
  for (let k = 1; ; k++) {
    const r = (await q(`SELECT ($1::date + $2::int)::text AS d, app_working_days($1::date, $1::date + $2::int) AS n`, [day, k])).rows[0];
    if (r.n === target) return r.d as string;
  }
}
const mailedTo = async (kind: string) => (await q(`SELECT to_email FROM outbound_emails WHERE kind = $1 ORDER BY to_email`, [kind])).rows.map((r) => r.to_email);

beforeAll(async () => {
  await q(`TRUNCATE "user", organizations CASCADE`);
  await truncateAuditLog(owner);
  await q(
    `INSERT INTO organizations (id, kind, name, departments_enabled, engagement_mode) VALUES
      ($1,'firm','firm',false,NULL), ($2,'client','Acme',true,'full'), ($3,'client','Beta',false,'full'), ($4,'client','Waha',false,'consultant_managed')`,
    [FIRM, ACME, BETA, WAHA],
  );
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$14,'firm_admin'), ($2,$14,'consultant'), ($3,$14,'consultant'), ($4,$14,'consultant'), ($5,$14,'consultant'), ($6,$14,'consultant'), ($7,$14,'consultant'),
      ($8,$15,'client_admin'), ($9,$15,'client_manager'), ($10,$15,'client_manager'), ($11,$15,'client_manager'), ($12,$15,'action_owner'),
      ($13,$16,'client_admin')`,
    [U.admin, U.lead, U.deputy, U.cons, U.obs, U.bench, U.wlead, U.cadmin, U.acceptor, U.sponsor, U.mgr, U.owner, U.betaAdmin, FIRM, ACME, BETA],
  );
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES
      ($1,$3,true,false), ($1,$4,false,true), ($1,$5,false,false), ($1,$6,false,false), ($1,$7,false,false), ($2,$8,true,false)`,
    [ACME, WAHA, U.lead, U.deputy, U.cons, U.obs, U.bench, U.wlead],
  );
  await q(
    `INSERT INTO engagements (id, firm_org_id, client_org_id, title, signed_on, scope) VALUES
      ($1,$4,$5,'Acme governance',app_firm_today() - 30,'Board work'), ($2,$4,$6,'Beta governance',app_firm_today() - 30,'Board work'),
      ($3,$4,$7,'Waha charter',app_firm_today() - 30,'Family charter')`,
    [G.acme, G.beta, G.waha, FIRM, ACME, BETA, WAHA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, engagement_id, created_by) VALUES
      ($1,'client',$5,$8,'Acme board','active',$9,$12), ($2,'client',$5,$8,'Acme phase 2','active',$9,$12),
      ($3,'client',$6,$8,'Beta board','active',$10,$12), ($4,'client',$7,$8,'Waha charter','active',$11,$12)`,
    [P.acme, P.closing, P.beta, P.waha, ACME, BETA, WAHA, FIRM, G.acme, G.beta, G.waha, U.admin],
  );
  await q(
    `INSERT INTO project_members (project_id, user_id, observer) VALUES
      ($1,$3,false), ($1,$4,true), ($1,$5,false), ($1,$6,false), ($1,$7,false), ($1,$8,false), ($2,$3,false)`,
    [P.acme, P.closing, U.cons, U.obs, U.acceptor, U.sponsor, U.mgr, U.owner],
  );
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$2,'المالية','Finance')`, [FIN, ACME]);
  await q(`INSERT INTO department_members (department_id, user_id, is_head) VALUES ($1,$2,true)`, [FIN, U.sponsor]);
  await q(
    `INSERT INTO project_client_roles (project_id, org_id, role, user_id, created_by) VALUES ($1,$2,'acceptor',$3,$5), ($1,$2,'sponsor',$4,$5)`,
    [P.acme, ACME, U.acceptor, U.sponsor, U.admin],
  );
  // Acme's other engagement, with its own project, where only U.hr is staffed.
  await q(`INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$2,'consultant')`, [U.hr, FIRM]);
  await q(`INSERT INTO client_assignments (client_org_id, user_id) VALUES ($1,$2)`, [ACME, U.hr]);
  await q(`INSERT INTO engagements (id, firm_org_id, client_org_id, title, signed_on, scope) VALUES ($1,$2,$3,'Acme HR review',app_firm_today() - 20,'HR policies')`, [
    G.hr,
    FIRM,
    ACME,
  ]);
  await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, engagement_id, created_by) VALUES ($1,'client',$2,$3,'Acme HR review','active',$4,$5)`, [
    P.hr,
    ACME,
    FIRM,
    G.hr,
    U.admin,
  ]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [P.hr, U.hr]);
});

beforeEach(async () => {
  await q(`DELETE FROM notifications`);
  await q(`DELETE FROM outbound_emails`);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("another client's deliverable", () => {
  it("is not found at every route and in the database, for its people and for consultants not on that client", async () => {
    const did = await deliverable(G.acme, P.acme, "Board charter");
    const doc = await file(ACME, P.acme, "Board charter.pdf");
    const { round } = await handOver(U.lead, did, [doc]);
    expect(round).toBe(1);
    for (const who of [U.betaAdmin, U.wlead]) {
      // GET /api/deliverables/:id, GET and POST .../hand-over, POST .../receipt, POST .../comment
      await expect(svc(who, (tx, p) => getDeliverable(tx, p, did)), who).rejects.toThrow(/not found/);
      await expect(svc(who, (tx, p) => handOverChoices(tx, p, did)), who).rejects.toThrow(/not found/);
      await expect(handOver(who, did, [doc]), who).rejects.toThrow(/not found/);
      await expect(svc(who, (tx, p) => recordReceipt(tx, p, did, { round: 1 })), who).rejects.toThrow(/not found/);
      await expect(svc(who, (tx, p) => commentOnDeliverable(tx, p, did, { round: 1, comment: "Missing annex" })), who).rejects.toThrow(/not found/);
      expect((await sqlAs(who, `SELECT count(*)::int AS n FROM deliverable_handovers WHERE deliverable_id = $1`, [did])).rows[0].n, who).toBe(0);
      expect((await sqlAs(who, `SELECT count(*)::int AS n FROM engagement_deliverables WHERE id = $1`, [did])).rows[0].n, who).toBe(0);
      await expect(sqlAs(who, `SELECT app_confirm_deliverable_receipt($1, 1)`, [did]), who).rejects.toThrow(/acceptor, admin or sponsor/);
      expect(await svc(who, (tx, p) => listDeliverables(tx, p, { clientOrgId: ACME })), who).toEqual([]);
    }
    // And nobody hands over another client's file under this one's deliverable.
    const betaDoc = await file(BETA, P.beta, "Beta charter.pdf");
    await expect(handOver(U.lead, did, [betaDoc])).rejects.toThrow(/deliverable files/);
    await expect(sqlAs(U.lead, `SELECT app_hand_over_deliverable($1, ARRAY[$2]::uuid[])`, [did, betaDoc])).rejects.toThrow(/this client's deliverable files/);
  });
});

describe("who answers for the client", () => {
  it("is asked in order: the acceptors, else the client's admins, else the sponsor; told once in Selah and by mail", async () => {
    const did = await deliverable(G.acme, P.acme, "Committee bylaws");
    const doc = await file(ACME, P.acme, "Bylaws.pdf");
    await handOver(U.lead, did, [doc]);
    expect(await told("deliverable.handed_over", did)).toEqual([U.acceptor]);
    expect(await mailedTo("deliverable.handed_over")).toEqual(["acceptor@example.test"]);

    // A file filed under Finance: the acceptor, in no department, cannot open it, so the client's admin is asked.
    const finDid = await deliverable(G.acme, P.acme, "Finance policy");
    const finDoc = await file(ACME, P.acme, "Finance policy.pdf", { department: FIN });
    await handOver(U.lead, finDid, [finDoc]);
    expect(await told("deliverable.handed_over", finDid)).toEqual([U.cadmin]);
    // And she does not see that deliverable at all.
    await expect(svc(U.acceptor, (tx, p) => getDeliverable(tx, p, finDid))).rejects.toThrow(/not found/);

    // With no active admin either, the sponsor (in Finance) is asked.
    await q(`UPDATE org_memberships SET active = false WHERE user_id = $1`, [U.cadmin]);
    try {
      const lastDid = await deliverable(G.acme, P.acme, "Finance annex");
      await handOver(U.lead, lastDid, [finDoc]);
      expect(await told("deliverable.handed_over", lastDid)).toEqual([U.sponsor]);
    } finally {
      await q(`UPDATE org_memberships SET active = true WHERE user_id = $1`, [U.cadmin]);
    }
  });

  it("only an acceptor, the client's admin or the sponsor confirms; a manager with no such role and an action owner cannot", async () => {
    const did = await deliverable(G.acme, P.acme, "Delegation matrix");
    const doc = await file(ACME, P.acme, "Matrix.pdf");
    await handOver(U.lead, did, [doc]);
    for (const who of [U.mgr, U.owner]) {
      await expect(svc(who, (tx, p) => getDeliverable(tx, p, did)), who).rejects.toThrow(/not found/);
      await expect(svc(who, (tx, p) => recordReceipt(tx, p, did, { round: 1 })), who).rejects.toThrow(/not found/);
      await expect(svc(who, (tx, p) => commentOnDeliverable(tx, p, did, { round: 1, comment: "Looks short" })), who).rejects.toThrow(/not found/);
      await expect(sqlAs(who, `SELECT app_confirm_deliverable_receipt($1, 1)`, [did]), who).rejects.toThrow(/acceptor, admin or sponsor/);
      expect((await sqlAs(who, `SELECT count(*)::int AS n FROM deliverable_handovers WHERE deliverable_id = $1`, [did])).rows[0].n, who).toBe(0);
    }
    // The acceptor reads it, and may answer.
    const seen = await svc(U.acceptor, (tx, p) => getDeliverable(tx, p, did));
    expect(seen.status).toBe("waiting");
    expect(seen.can).toMatchObject({ confirm: true, comment: true, handOver: false, record: false });
    // The client's admin and the sponsor may confirm too, each on a round of their own.
    for (const who of [U.cadmin, U.sponsor]) {
      const other = await deliverable(G.acme, P.acme, `Charter for ${who}`);
      await handOver(U.lead, other, [doc]);
      const after = await svc(who, (tx, p) => recordReceipt(tx, p, other, { round: 1 }));
      expect(after.status, who).toBe("received");
      expect(after.rounds[0]!.receivedBy, who).toBe(who === U.cadmin ? "cadmin" : "sponsor");
    }
    const done = await svc(U.acceptor, (tx, p) => recordReceipt(tx, p, did, { round: 1 }));
    expect(done.status).toBe("received");
    expect(done.rounds[0]).toMatchObject({ receivedBy: "acceptor", receiptSource: "client_portal" });
    // Once per round.
    await expect(svc(U.cadmin, (tx, p) => recordReceipt(tx, p, did, { round: 1 }))).rejects.toThrow(/already answered/);
  });

  it("the firm hands over: the lead, the deputy and a staffed consultant; not an observer, a consultant staffed on nothing, or the firm admin", async () => {
    const did = await deliverable(G.acme, P.acme, "Board evaluation");
    const doc = await file(ACME, P.acme, "Evaluation.pdf");
    for (const who of [U.obs, U.bench, U.admin]) {
      // Refused by authorize(): the route answers 404, like a missing record.
      await expect(handOver(who, did, [doc]), who).rejects.toThrow(/forbidden/);
      await expect(sqlAs(who, `SELECT app_hand_over_deliverable($1, ARRAY[$2]::uuid[])`, [did, doc]), who).rejects.toThrow(/hands a deliverable over/);
    }
    for (const [i, who] of [U.lead, U.deputy, U.cons].entries()) expect((await handOver(who, did, [doc])).round).toBe(i + 1);
    // The firm on the client reads every round, the observer and the bench too; the client's acceptor reads them.
    for (const who of [U.admin, U.obs, U.bench, U.acceptor]) {
      expect((await svc(who, (tx, p) => getDeliverable(tx, p, did))).rounds.map((r) => r.round), who).toEqual([3, 2, 1]);
    }
    // A deliverable handed over stays on record.
    await expect(svc(U.admin, (tx, p) => removeDeliverable(tx, p, G.acme, did))).rejects.toThrow(/stays on record/);
    await expect(sqlAs(U.admin, `DELETE FROM engagement_deliverables WHERE id = $1`, [did])).rejects.toThrow(/stays on record/);
  });

  it("a firm user cannot confirm for a full client, but records the receipt for a client the firm runs", async () => {
    const did = await deliverable(G.acme, P.acme, "Audit committee charter");
    const doc = await file(ACME, P.acme, "Audit charter.pdf");
    await handOver(U.lead, did, [doc]);
    const recorded = { round: 1, receivedBy: "Board secretary", receivedVia: "email" as const, receivedOn: (await q(`SELECT app_firm_today()::text AS d`)).rows[0].d };
    for (const who of [U.lead, U.cons, U.admin]) {
      // Refused by authorize(): the route answers 404, like a missing record.
      await expect(svc(who, (tx, p) => recordReceipt(tx, p, did, recorded)), who).rejects.toThrow(/forbidden/);
      await expect(svc(who, (tx, p) => recordReceipt(tx, p, did, { round: 1 })), who).rejects.toThrow(/forbidden/);
    }
    await expect(sqlAs(U.lead, `SELECT app_confirm_deliverable_receipt($1, 1)`, [did])).rejects.toThrow(/acceptor, admin or sponsor/);
    await expect(sqlAs(U.lead, `SELECT app_record_deliverable_receipt($1, 1, 'Board secretary', 'email', app_firm_today())`, [did])).rejects.toThrow(
      /client confirms receipt itself/,
    );

    // Waha has no accounts: nobody is told, and its lead records who received it, how and when.
    const wdid = await deliverable(G.waha, P.waha, "Family charter");
    const wdoc = await file(WAHA, P.waha, "Family charter.pdf");
    await handOver(U.wlead, wdid, [wdoc]);
    expect(await told("deliverable.handed_over", wdid)).toEqual([]);
    expect(await mailedTo("deliverable.handed_over")).toEqual(["acceptor@example.test"]);
    const view = await svc(U.wlead, (tx, p) => getDeliverable(tx, p, wdid));
    expect(view.can).toMatchObject({ record: true, confirm: false });
    await expect(svc(U.wlead, (tx, p) => recordReceipt(tx, p, wdid, { round: 1 }))).rejects.toThrow(/who at the client received it/);
    await expect(svc(U.wlead, (tx, p) => recordReceipt(tx, p, wdid, { ...recorded, receivedOn: "2999-01-01" }))).rejects.toThrow(/between the hand-over and today/);
    await expect(svc(U.admin, (tx, p) => recordReceipt(tx, p, wdid, recorded))).rejects.toThrow(/forbidden/);
    const after = await svc(U.wlead, (tx, p) => recordReceipt(tx, p, wdid, recorded));
    expect(after.status).toBe("received");
    expect(after.rounds[0]).toMatchObject({ receiptSource: "consultant_recorded", receivedByName: "Board secretary", receivedVia: "email", receivedBy: "wlead" });
  });
});

describe("who hands over, with which files, and who will be asked (S2)", () => {
  it("only the lead, the deputy or a consultant staffed (not observing) on a project the engagement covers; only files of the engagement's projects", async () => {
    const did = await deliverable(G.acme, P.acme, "Board evaluation, second year");
    const doc = await file(ACME, P.acme, "Evaluation, second year.pdf");
    const hrDoc = await file(ACME, P.hr, "HR policy.pdf");
    // Staffed only under Acme's other engagement: not for this one.
    await expect(handOver(U.hr, did, [doc])).rejects.toThrow(/forbidden/);
    await expect(sqlAs(U.hr, `SELECT app_hand_over_deliverable($1, ARRAY[$2]::uuid[])`, [did, doc])).rejects.toThrow(/hands a deliverable over/);
    expect((await svc(U.hr, (tx, p) => getDeliverable(tx, p, did))).can.handOver).toBe(false);
    // Under its own engagement, they do.
    const hrDid = await deliverable(G.hr, P.hr, "HR handbook");
    expect((await handOver(U.hr, hrDid, [hrDoc])).round).toBe(1);
    // A file of another engagement's project is neither offered nor taken.
    const offered = (await svc(U.lead, (tx, p) => handOverChoices(tx, p, did))).files.flatMap((c) => c.versions.map((v) => v.id));
    expect(offered).toContain(doc);
    expect(offered).not.toContain(hrDoc);
    await expect(handOver(U.lead, did, [hrDoc])).rejects.toThrow(/engagement's projects/);
    await expect(sqlAs(U.lead, `SELECT app_hand_over_deliverable($1, ARRAY[$2]::uuid[])`, [did, hrDoc])).rejects.toThrow(/engagement's projects/);
  });

  it("before saving, says who will be asked, and when an acceptor is skipped because they cannot open every file", async () => {
    const did = await deliverable(G.acme, P.acme, "Finance pack");
    const plain = await file(ACME, P.acme, "Pack.pdf");
    const fin = await file(ACME, P.acme, "Pack, finance annex.pdf", { department: FIN });
    expect(await svc(U.lead, (tx, p) => handOverPreview(tx, p, did, [plain]))).toEqual({ asked: [{ name: "acceptor", as: "acceptor" }], skipped: [] });
    expect(await svc(U.lead, (tx, p) => handOverPreview(tx, p, did, [plain, fin]))).toEqual({ asked: [{ name: "cadmin", as: "admin" }], skipped: [{ name: "acceptor" }] });
    // Only someone who may hand it over gets the preview.
    await expect(svc(U.obs, (tx, p) => handOverPreview(tx, p, did, [plain]))).rejects.toThrow(/forbidden/);
    await expect(sqlAs(U.obs, `SELECT * FROM app_hand_over_preview($1, ARRAY[$2]::uuid[])`, [did, plain])).rejects.toThrow(/hands a deliverable over/);
    await expect(svc(U.acceptor, (tx, p) => handOverPreview(tx, p, did, [plain]))).rejects.toThrow(/not found/);
  });
});

describe("a receipt", () => {
  it("keeps the exact versions handed over: a later version changes nothing until it is handed over in a new round", async () => {
    const did = await deliverable(G.acme, P.acme, "Board charter, approved");
    const v1 = await file(ACME, P.acme, "Charter.pdf");
    await handOver(U.lead, did, [v1]);
    await svc(U.acceptor, (tx, p) => recordReceipt(tx, p, did, { round: 1 }));
    const v2 = await file(ACME, P.acme, "Charter.pdf", { supersedes: v1, version: 2 });

    const after = await svc(U.lead, (tx, p) => getDeliverable(tx, p, did));
    expect(after.status).toBe("received");
    expect(after.rounds[0]!.files.map((f) => [f.id, f.version])).toEqual([[v1, 1]]);
    // Nobody changes a round, not even the schema owner, and the app cannot write the table at all.
    await expect(q(`UPDATE deliverable_handovers SET version_ids = ARRAY[$2]::uuid[] WHERE deliverable_id = $1`, [did, v2])).rejects.toThrow(/keeps its files/);
    await expect(sqlAs(U.lead, `UPDATE deliverable_handovers SET version_ids = ARRAY[$2]::uuid[] WHERE deliverable_id = $1`, [did, v2])).rejects.toThrow(
      /permission denied/,
    );
    await expect(q(`UPDATE deliverable_handovers SET received_at = now() - interval '1 day' WHERE deliverable_id = $1`, [did])).rejects.toThrow(/already answered/);
    // A file handed over can no longer be withdrawn by its uploader.
    expect((await sqlAs(U.lead, `SELECT app_document_settled($1) AS s`, [v1])).rows[0].s).toBe(true);

    // The hand-over dialog offers the new version first, picked because the file was handed over before.
    const choices = await svc(U.lead, (tx, p) => handOverChoices(tx, p, did));
    const charter = choices.files.find((c) => c.key === v1)!;
    expect(charter.versions.map((v) => v.id)).toEqual([v2, v1]);
    expect(charter.picked).toBe(true);
    // A new round with the new version; the first keeps its receipt and its version.
    await handOver(U.lead, did, [v2]);
    const rounds = (await svc(U.acceptor, (tx, p) => getDeliverable(tx, p, did))).rounds;
    expect(rounds.map((r) => [r.round, r.files.map((f) => f.id), !!r.receivedAt])).toEqual([
      [2, [v2], false],
      [1, [v1], true],
    ]);
    // An answer is for the round the reader saw.
    await expect(svc(U.acceptor, (tx, p) => recordReceipt(tx, p, did, { round: 1 }))).rejects.toThrow(/newer version was handed over/);
  });

  it("offers and takes only files already shared with the client: a firm-only file is named, never offered, and never shared by a hand-over (B1)", async () => {
    const did = await deliverable(G.acme, null, "Engagement summary");
    const doc = await file(ACME, P.acme, "Summary.pdf", { visibility: "firm_private" });
    const annex = await file(ACME, P.acme, "Summary annex.pdf");
    const visibility = async () => (await q(`SELECT visibility FROM documents WHERE id = $1`, [doc])).rows[0].visibility;
    const choices = await svc(U.lead, (tx, p) => handOverChoices(tx, p, did));
    const offered = choices.files.flatMap((c) => c.versions.map((v) => v.id));
    expect(offered).toContain(annex);
    expect(offered).not.toContain(doc);
    expect(choices.firmOnly.map((f) => f.title)).toContain("Summary.pdf");
    // Neither the service nor the database takes it, and it stays firm-only.
    await expect(handOver(U.lead, did, [doc])).rejects.toThrow(/share it with the client first/);
    await expect(sqlAs(U.lead, `SELECT app_hand_over_deliverable($1, ARRAY[$2]::uuid[])`, [did, doc])).rejects.toThrow(/shared with it/);
    expect(await visibility()).toBe("firm_private");
    expect((await q(`SELECT count(*)::int AS n FROM deliverable_handovers WHERE deliverable_id = $1`, [did])).rows[0].n).toBe(0);
    // Shared from its own menu (which asks first), it is offered and handed over.
    await svc(U.lead, (tx, p) => shareDocument(tx, p, doc));
    expect((await svc(U.lead, (tx, p) => handOverChoices(tx, p, did))).firmOnly.map((f) => f.title)).not.toContain("Summary.pdf");
    await handOver(U.lead, did, [doc]);
    // Not tied to a project: its acceptors are those of every project the engagement covers.
    expect(await told("deliverable.handed_over", did)).toEqual([U.acceptor]);
  });
});

describe("the reminder", () => {
  it("goes once, to the receivers, after ten Saudi working days (Sunday to Thursday), with their other reminders", async () => {
    // The count: Friday and Saturday are off, as the mail rules hold them.
    const first = (await q(`SELECT app_working_days('2031-01-02', '2031-01-12') AS n`)).rows[0].n; // a Thursday to the next Sunday but one
    let expected = 0;
    for (let d = new Date("2031-01-03T00:00:00Z"); d <= new Date("2031-01-12T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
      if (![5, 6].includes(d.getUTCDay())) expected++;
    }
    expect(first).toBe(expected);
    expect((await q(`SELECT app_deliverable_reminder_days() AS n`)).rows[0].n).toBe(DELIVERABLE_REMINDER_WORKING_DAYS);

    // The rounds the other tests left waiting had their reminder already, so only this one counts.
    await q(`UPDATE deliverable_handovers SET reminded_at = now() WHERE reminded_at IS NULL`);
    const did = await deliverable(G.acme, P.acme, "Disclosure register");
    const doc = await file(ACME, P.acme, "Register.pdf");
    await handOver(U.lead, did, [doc]);
    const day = (await q(`SELECT app_firm_today()::text AS d`)).rows[0].d as string;
    // The first day with nine working days since the hand-over, and the first with ten.
    const after = (target: number) => afterWorkingDays(day, target);
    const nine = await after(DELIVERABLE_REMINDER_WORKING_DAYS - 1);
    const ten = await after(DELIVERABLE_REMINDER_WORKING_DAYS);
    const remind = async (on: string) => (await q(`SELECT app_remind_deliverables($1::date) AS n`, [on])).rows[0].n;
    expect(await remind(nine)).toBe(0);
    expect(await remind(ten)).toBe(1);
    expect(await remind(ten)).toBe(0);
    expect(await remind(await after(DELIVERABLE_REMINDER_WORKING_DAYS + 5))).toBe(0);
    expect(await told("deliverable.reminder", did)).toEqual([U.acceptor]);
    // Only the job sends it.
    await expect(sqlAs(U.lead, `SELECT app_remind_deliverables($1::date)`, [ten])).rejects.toThrow(/permission denied|daily job/);
    // Through the summary mail, by the reader's reminders cadence (daily by default), which waits for her sending hours.
    expect((await q(`SELECT app_queue_digests($1::date) AS n`, [ten])).rows[0].n).toBeGreaterThanOrEqual(1);
    expect(await mailedTo("follow_up.digest")).toContain("acceptor@example.test");
    // An answered round is never reminded.
    const answered = await deliverable(G.acme, P.acme, "Answered register");
    await handOver(U.lead, answered, [doc]);
    await svc(U.acceptor, (tx, p) => recordReceipt(tx, p, answered, { round: 1 }));
    expect(await remind(ten)).toBe(0);
  });

  it("goes in the same summary mail as an indicator that moved away (0090), on the same day, for the same person", async () => {
    await q(`UPDATE deliverable_handovers SET reminded_at = now() WHERE reminded_at IS NULL`);
    // No acceptor on the second project: the client's admin is asked.
    const did = await deliverable(G.acme, P.closing, "Board pack");
    const doc = await file(ACME, P.closing, "Board pack.pdf");
    await handOver(U.lead, did, [doc]);
    expect(await told("deliverable.handed_over", did)).toEqual([U.cadmin]);
    // An indicator whose latest value, typed by the staffed consultant, moved away from its baseline: the client's admin is told too.
    const kpi = id(n++);
    await q(
      `INSERT INTO client_kpis (id, org_id, name_en, name_ar, unit, direction, frequency, baseline, baseline_period, created_by)
       VALUES ($1,$2,'Complaints','الشكاوى','complaints','lower_better','monthly',30,'2026-01-01',$3)`,
      [kpi, ACME, U.admin],
    );
    await svc(U.cons, (tx, p) => addValue(tx, p, kpi, { period: "2026-02-01", value: 42, note: null }));
    expect((await q(`SELECT count(*)::int AS n FROM notifications WHERE kind = 'indicator.moved_away' AND user_id = $1`, [U.cadmin])).rows[0].n).toBe(1);

    const ten = await afterWorkingDays((await q(`SELECT app_firm_today()::text AS d`)).rows[0].d, DELIVERABLE_REMINDER_WORKING_DAYS);
    expect((await q(`SELECT app_remind_deliverables($1::date) AS n`, [ten])).rows[0].n).toBe(1);
    await q(`SELECT app_queue_digests($1::date)`, [ten]);
    // Both notices went into her one summary mail; the hand-over notice had its own mail already.
    const mailed = (await q(`SELECT kind FROM notifications WHERE user_id = $1 AND mailed_at IS NOT NULL ORDER BY kind`, [U.cadmin])).rows.map((r) => r.kind);
    expect(mailed).toEqual(["deliverable.reminder", "indicator.moved_away"]);
    expect((await mailedTo("follow_up.digest")).filter((m) => m === "cadmin@example.test")).toHaveLength(1);
  });
});

describe("a comment", () => {
  it("needs a text, reaches the client's lead and deputy, and waits on the lead's Today until a new version is handed over", async () => {
    const did = await deliverable(G.acme, P.acme, "Related-party policy");
    const doc = await file(ACME, P.acme, "Related parties.pdf");
    await handOver(U.lead, did, [doc]);
    await expect(sqlAs(U.acceptor, `SELECT app_comment_on_deliverable($1, 1, 'ok')`, [did])).rejects.toThrow(/write the comment/);
    const after = await svc(U.acceptor, (tx, p) => commentOnDeliverable(tx, p, did, { round: 1, comment: "Annex B is missing" }));
    expect(after.status).toBe("commented");
    expect(await told("deliverable.commented", did)).toEqual([U.lead, U.deputy].sort());
    expect(await mailedTo("deliverable.commented")).toEqual(["deputy@example.test", "lead@example.test"]);
    // The lead reads it in the notifications (linking to the engagement) and on Today's decisions.
    const notes = await svc(U.lead, (tx, p) => listNotifications(tx, p));
    expect(notes.items.find((x) => x.kind === "deliverable.commented")).toMatchObject({ title: "Related-party policy", href: `/engagements/${G.acme}` });
    const decisions = (await svc(U.lead, (tx, p) => today(tx, p))).decisions.filter((x) => x.kind === "deliverable_comment");
    expect(decisions.map((x) => [x.id, x.who])).toEqual([[did, "acceptor"]]);
    const firmView = await svc(U.lead, (tx, p) => getDeliverable(tx, p, did));
    expect(firmView.rounds[0]).toMatchObject({ comment: "Annex B is missing", commentedBy: "acceptor" });
    expect(firmView.can.handOver).toBe(true);
    await handOver(U.lead, did, [doc]);
    expect((await svc(U.lead, (tx, p) => today(tx, p))).decisions.filter((x) => x.kind === "deliverable_comment")).toEqual([]);
    // The engagement page lists both rounds under the deliverable.
    const page = await svc(U.cadmin, (tx, p) => getEngagement(tx, p, G.acme));
    expect(page.deliverables.find((d) => d.id === did)!.rounds.map((r) => r.round)).toEqual([2, 1]);
  });
});

describe("the closure report", () => {
  it("lists each deliverable of the project with its receipt, worded as receipt", async () => {
    const did = await deliverable(G.acme, P.closing, "Phase 2 report");
    const doc = await file(ACME, P.closing, "Phase 2 report.pdf");
    const waiting = await deliverable(G.acme, P.closing, "Phase 2 annex");
    await handOver(U.lead, did, [doc]);
    await svc(U.cadmin, (tx, p) => recordReceipt(tx, p, did, { round: 1 }));
    await handOver(U.lead, waiting, [doc]);
    const closing = await svc(U.admin, (tx, p) => moveClosure(tx, p, P.closing, { step: "start" }));
    // Closing warns about the rounds still waiting, and does not block (S1).
    expect(closing.waitingDeliverables.map((d) => d.title)).toContain("Phase 2 annex");
    expect(closing.waitingDeliverables.map((d) => d.title)).not.toContain("Phase 2 report");
    // Only the lessons are left to settle: the waiting round is not a blocker, and the project closes below.
    expect(closing.blockers.map((b) => b.kind)).toEqual(["lessons"]);
    expect((await svc(U.cadmin, (tx, p) => getClosure(tx, p, P.closing))).waitingDeliverables).toEqual([]);
    await svc(U.lead, (tx, p) => writeLessons(tx, p, P.closing, { wentWell: "Clear scope", toImprove: "Earlier reviews" }));
    await svc(U.admin, (tx, p) => moveClosure(tx, p, P.closing, { step: "close" }));
    // A closed project's deliverables stay as they are: no new write path.
    await expect(svc(U.cadmin, (tx, p) => recordReceipt(tx, p, waiting, { round: 1 }))).rejects.toThrow(/forbidden/);
    await expect(sqlAs(U.cadmin, `SELECT app_confirm_deliverable_receipt($1, 1)`, [waiting])).rejects.toThrow(/closed project/);
    await expect(handOver(U.lead, waiting, [doc])).rejects.toThrow(/forbidden/);
    await expect(sqlAs(U.lead, `SELECT app_hand_over_deliverable($1, ARRAY[$2]::uuid[])`, [waiting, doc])).rejects.toThrow(/closed project/);
    // The round never answered reads "No answer before the project closed", for every reader, and is never reminded.
    for (const who of [U.lead, U.cadmin]) {
      const seen = await svc(who, (tx, p) => getDeliverable(tx, p, waiting));
      expect(seen.status, who).toBe("no_answer");
      expect(seen.can, who).toEqual({ handOver: false, confirm: false, comment: false, record: false });
    }
    await q(`UPDATE deliverable_handovers SET reminded_at = now() WHERE reminded_at IS NULL AND deliverable_id <> $1`, [waiting]);
    const later = await afterWorkingDays((await q(`SELECT app_firm_today()::text AS d`)).rows[0].d, DELIVERABLE_REMINDER_WORKING_DAYS + 1);
    expect((await q(`SELECT app_remind_deliverables($1::date) AS n`, [later])).rows[0].n).toBe(0);
    expect(await told("deliverable.reminder", waiting)).toEqual([]);

    rendered.length = 0;
    await svc(U.cadmin, (tx, p) => closurePdf(tx, p, P.closing, "en"));
    const html = rendered[0]!;
    expect(html).toContain("What was handed over");
    expect(html).toContain("Phase 2 report");
    expect(html).toMatch(/Receipt confirmed on [^<]+ by cadmin/);
    expect(html).toMatch(/Phase 2 annex<\/td>\s*<td>No answer before the project closed<\/td>/);
    expect(html).toContain("Phase 2 report.pdf (v1)");
    expect(html).toContain("It never means the work was accepted.");
    // In Arabic for the firm, with the same words of receipt.
    rendered.length = 0;
    await svc(U.lead, (tx, p) => closurePdf(tx, p, P.closing, "ar"));
    expect(rendered[0]).toContain("ما سُلِّم للعميل");
    expect(rendered[0]).toContain("لم يصل رد قبل إغلاق المشروع");
    // A manager on the project who answers for none of them gets the report without the section.
    await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [P.closing, U.mgr]);
    rendered.length = 0;
    await svc(U.mgr, (tx, p) => closurePdf(tx, p, P.closing, "en"));
    expect(rendered[0]).not.toContain("What was handed over");
    expect(rendered[0]).not.toContain("Phase 2 report");
  });
});
