// The information request list per project (wave 1, item 9) against a real
// Postgres: who writes and reads it, the status moves, answering with files
// (one file for several items), confidential items and the assistant, and
// the wall between clients.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { infoRequestInput } from "@/lib/info-requests";
import { runFollowUps } from "@/jobs/follow-ups";
import { loadPrincipal } from "@/services/principal";

const stored: string[] = [];
vi.mock("@/services/storage", () => ({ putObject: async (key: string) => void stored.push(key) }));
const svcModule = await import("@/services/info-requests");
const { withdrawDocument } = await import("@/services/documents");
const { addTemplateItems, answerWithExisting, answerWithUpload, createInfoRequest, deleteInfoRequest, listInfoRequests, moveInfoRequest, removeAnswer, updateInfoRequest } =
  svcModule;

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-8400-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = {
  admin: id(11),
  cons: id(12), // staffed on PROJ
  outsider: id(13), // a consultant not on PROJ
  cadmin: id(14),
  cmgr: id(15), // on PROJ
  owner1: id(16), // action owner on PROJ
  owner2: id(17), // action owner on PROJ
  betaAdmin: id(18),
};
const PROJ = id(21);
const INTERNAL = id(22);
const CLOSED = id(23);
const PROJ2 = id(24); // for the reminders
const SHARED_DOC = id(31);
const PRIVATE_DOC = id(32);
const INDEXED_DOC = id(33);

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
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>, commit = true) =>
  as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return fn(tx, (await loadPrincipal(tx, userId))!);
    },
    commit,
  );
const db = (re: RegExp) => ({ cause: { message: expect.stringMatching(re) } });
const statusOf = async (rid: string) => (await owner.query(`SELECT status, status_note FROM info_requests WHERE id = $1`, [rid])).rows[0];
const create = (who: string, extra: Record<string, unknown> = {}) =>
  svc(who, (tx, p) => createInfoRequest(tx, p, PROJ, infoRequestInput.parse({ area: "legal", title: "Signed shareholder agreement", ...extra })));
const upload = (name: string) => ({
  bytes: new TextEncoder().encode(name),
  fileName: name,
  contentType: "text/plain",
  sha256: "0".repeat(64),
  scanned: true,
  scanMs: 1,
});

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [FIRM, ACME, BETA]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role, active) VALUES
      ($1,$9,'firm_admin',true), ($2,$9,'consultant',true), ($3,$9,'consultant',true), ($4,$10,'client_admin',true),
      ($5,$10,'client_manager',true), ($6,$10,'action_owner',true), ($7,$10,'action_owner',true), ($8,$11,'client_admin',true)`,
    [U.admin, U.cons, U.outsider, U.cadmin, U.cmgr, U.owner1, U.owner2, U.betaAdmin, FIRM, ACME, BETA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$4,$5,'Acme governance','active',$6), ($2,'internal',$5,$5,'Handbook','active',$6), ($3,'client',$4,$5,'Old phase','closed',$6),
      ($7,'client',$4,$5,'Acme strategy','active',$6)`,
    [PROJ, INTERNAL, CLOSED, ACME, FIRM, U.admin, PROJ2],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,false), ($1,$3,false)`, [ACME, U.cons, U.outsider]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4), ($1,$5), ($6,$2)`, [
    PROJ,
    U.cons,
    U.cmgr,
    U.owner1,
    U.owner2,
    INTERNAL,
  ]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4)`, [PROJ2, U.cons, U.cmgr, U.owner1]);
  for (const [doc, vis, ai] of [
    [SHARED_DOC, "shared", false],
    [PRIVATE_DOC, "client_private", false],
    [INDEXED_DOC, "shared", true],
  ] as const) {
    await q(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, ai_indexable, storage_key,
         content_type, size_bytes, sha256, scan_status)
       VALUES ($1::uuid,$2,$3,$3,$4,'client_document','submitted',$1::text,$5,$6,$1::text,'text/plain',1,$7,'clean')`,
      [doc, PROJ, ACME, U.cadmin, vis, ai, "0".repeat(64)],
    );
  }
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("writing the list", () => {
  it("is the firm's on the project: not the client, not a consultant off the project, not an internal or closed project", async () => {
    const { id: rid } = await create(U.cons, { ownerUserId: U.owner1, dueDate: "2026-11-15", description: "With every amendment" });
    expect(await statusOf(rid)).toEqual({ status: "requested", status_note: null });
    for (const who of [U.cadmin, U.cmgr, U.outsider]) await expect(create(who), who).rejects.toThrow();
    const insert = `INSERT INTO info_requests (project_id, org_id, area, title, created_by) VALUES ($1,$2,'legal','Anything',$3)`;
    await expect(attempt(U.cadmin, insert, [PROJ, ACME, U.cadmin])).rejects.toThrow(/row-level security/);
    await expect(attempt(U.admin, insert, [INTERNAL, FIRM, U.admin])).rejects.toThrow(/open client projects/);
    await expect(attempt(U.admin, insert, [CLOSED, ACME, U.admin])).rejects.toThrow(/open client projects/);
    // The client may only move the status; the firm edits the item.
    await expect(attempt(U.cadmin, `UPDATE info_requests SET due_date = NULL WHERE id = $1`, [rid])).rejects.toThrow(/only the firm edits/);
  });

  it("names an owner at the client who can see the project", async () => {
    await expect(create(U.cons, { ownerUserId: U.betaAdmin })).rejects.toMatchObject(db(/someone at the client on this project/));
    await expect(create(U.cons, { ownerUserId: U.cons })).rejects.toMatchObject(db(/someone at the client on this project/));
    await expect(create(U.cons, { ownerUserId: U.cadmin })).resolves.toMatchObject({ id: expect.any(String) });
    const told = await owner.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND kind = 'info_request.requested'`, [U.cadmin]);
    expect(told.rows[0].n).toBe(1);
  });

  it("adds template items once, in the reader's language, confidential where the template says", async () => {
    const out = await svc(U.cons, (tx, p) => addTemplateItems(tx, p, PROJ, { keys: ["legal.cr", "finance.statements"], dueDate: "2026-11-30" }));
    expect(out).toEqual({ added: 2 });
    expect(await svc(U.cons, (tx, p) => addTemplateItems(tx, p, PROJ, { keys: ["legal.cr"] }))).toEqual({ added: 0 });
    const list = (await svc(U.cons, (tx, p) => listInfoRequests(tx, p, PROJ)))!;
    expect(list.used).toEqual(["legal.cr", "finance.statements"]);
    expect(list.items.find((i) => i.templateKey === "finance.statements")).toMatchObject({ sensitivity: "confidential", dueDate: "2026-11-30" });
    // Reworded, an item is the firm's own.
    const cr = list.items.find((i) => i.templateKey === "legal.cr")!;
    await svc(U.cons, (tx, p) => updateInfoRequest(tx, p, cr.id, { title: "CR certificate and the latest amendment" }));
    expect((await owner.query(`SELECT template_key FROM info_requests WHERE id = $1`, [cr.id])).rows[0].template_key).toBeNull();
  });
});

describe("reading the list", () => {
  it("shows an action owner only their own items, and nothing to another client or a consultant off the project", async () => {
    await create(U.cons, { title: "Owner two's item", ownerUserId: U.owner2 });
    const mine = (await svc(U.owner1, (tx, p) => listInfoRequests(tx, p, PROJ)))!.items;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((i) => i.ownerUserId === U.owner1)).toBe(true);
    expect((await svc(U.cmgr, (tx, p) => listInfoRequests(tx, p, PROJ)))!.items.length).toBeGreaterThan(mine.length);
    await expect(svc(U.betaAdmin, (tx, p) => listInfoRequests(tx, p, PROJ))).rejects.toThrow();
    await expect(svc(U.outsider, (tx, p) => listInfoRequests(tx, p, PROJ))).rejects.toThrow();
    expect((await attempt(U.betaAdmin, `SELECT * FROM info_requests`)).rowCount).toBe(0);
    expect((await attempt(U.outsider, `SELECT * FROM info_requests`)).rowCount).toBe(0);
    expect(await svc(U.cons, (tx, p) => listInfoRequests(tx, p, INTERNAL))).toBeNull();
  });
});

describe("answering", () => {
  it("a file marks the item received; one file answers several; taking off the last file asks again", async () => {
    const a = await create(U.cons, { title: "Board minutes 2025", ownerUserId: U.owner1 });
    const b = await create(U.cons, { title: "Board minutes 2024", ownerUserId: U.owner1 });
    const doc = await svc(U.owner1, (tx, p) => answerWithUpload(tx, p, a.id, upload("minutes.pdf")));
    expect(stored.length).toBe(1);
    await svc(U.owner1, (tx, p) => answerWithExisting(tx, p, b.id, doc.id));
    expect((await statusOf(a.id)).status).toBe("received");
    expect((await statusOf(b.id)).status).toBe("received");
    const told = await owner.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND kind = 'info_request.received'`, [U.cons]);
    expect(told.rows[0].n).toBe(2);
    // The note has to match something the caller did.
    await expect(attempt(U.owner2, `SELECT app_notify_info_request($1, 'info_request.received')`, [a.id])).rejects.toThrow(/not visible|does not match/);
    await expect(attempt(U.cadmin, `SELECT app_notify_info_request($1, 'info_request.received')`, [a.id])).rejects.toThrow(/does not match/);
    await expect(attempt(U.betaAdmin, `SELECT app_notify_info_request($1, 'info_request.received')`, [a.id])).rejects.toThrow(/not visible/);
    await svc(U.owner1, (tx, p) => removeAnswer(tx, p, b.id, doc.id));
    expect((await statusOf(b.id)).status).toBe("requested");
    // Someone else's item, or a file only one side sees, does not answer.
    const other = await create(U.cons, { title: "Owner two's papers", ownerUserId: U.owner2 });
    await expect(svc(U.owner1, (tx, p) => answerWithExisting(tx, p, other.id, doc.id))).rejects.toThrow();
    await expect(svc(U.cadmin, (tx, p) => answerWithExisting(tx, p, b.id, PRIVATE_DOC))).rejects.toMatchObject(db(/both sides can see/));
  });

  it("the firm reviews or returns with a reason; the client may say an item does not apply", async () => {
    const r = await create(U.cons, { title: "Signed policies", ownerUserId: U.cmgr });
    await svc(U.cmgr, (tx, p) => answerWithExisting(tx, p, r.id, SHARED_DOC));
    await expect(svc(U.cmgr, (tx, p) => moveInfoRequest(tx, p, r.id, { status: "reviewed" }))).rejects.toMatchObject(db(/invalid request status/));
    await expect(svc(U.cons, (tx, p) => moveInfoRequest(tx, p, r.id, { status: "requested" }))).rejects.toMatchObject(db(/say why/));
    await svc(U.cons, (tx, p) => moveInfoRequest(tx, p, r.id, { status: "requested", note: "Unsigned copy; please send the signed one" }));
    expect(await statusOf(r.id)).toEqual({ status: "requested", status_note: "Unsigned copy; please send the signed one" });
    expect((await owner.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND kind = 'info_request.returned'`, [U.cmgr])).rows[0].n).toBe(1);
    await svc(U.cmgr, (tx, p) => answerWithUpload(tx, p, r.id, upload("signed.pdf")));
    await svc(U.cons, (tx, p) => moveInfoRequest(tx, p, r.id, { status: "reviewed" }));
    expect(await statusOf(r.id)).toEqual({ status: "reviewed", status_note: null });
    // A reviewed item keeps its files.
    await expect(attempt(U.cons, `DELETE FROM info_request_files WHERE request_id = $1`, [r.id])).resolves.toMatchObject({ rowCount: 0 });
    await expect(svc(U.cmgr, (tx, p) => answerWithExisting(tx, p, r.id, SHARED_DOC))).rejects.toMatchObject(db(/not open for files/));

    const na = await create(U.cons, { title: "Zakat certificate", ownerUserId: U.cmgr });
    await expect(svc(U.cmgr, (tx, p) => moveInfoRequest(tx, p, na.id, { status: "not_applicable" }))).rejects.toMatchObject(db(/say why/));
    await svc(U.cmgr, (tx, p) => moveInfoRequest(tx, p, na.id, { status: "not_applicable", note: "We are exempt" }));
    await expect(svc(U.cmgr, (tx, p) => moveInfoRequest(tx, p, na.id, { status: "requested", note: "x" }))).rejects.toMatchObject(db(/invalid request status/));
    await svc(U.cons, (tx, p) => moveInfoRequest(tx, p, na.id, { status: "requested", note: "The exemption ended in June" }));
    expect((await statusOf(na.id)).status).toBe("requested");
  });

  it("removes only an item nobody answered", async () => {
    const r = await create(U.cons, { title: "Spare item" });
    const answered = await create(U.cons, { title: "Answered item" });
    await svc(U.cadmin, (tx, p) => answerWithUpload(tx, p, answered.id, upload("zakat.pdf")));
    await expect(svc(U.cons, (tx, p) => deleteInfoRequest(tx, p, answered.id))).rejects.toThrow(/stays on the list/);
    await expect(svc(U.cadmin, (tx, p) => deleteInfoRequest(tx, p, r.id))).rejects.toThrow(/forbidden/);
    await svc(U.cons, (tx, p) => deleteInfoRequest(tx, p, r.id));
    expect((await owner.query(`SELECT 1 FROM info_requests WHERE id = $1`, [r.id])).rowCount).toBe(0);
  });
});

describe("confidential items", () => {
  it("keep their files out of the assistant", async () => {
    const r = await create(U.cons, { title: "Salary scale", sensitivity: "confidential" });
    await expect(svc(U.cadmin, (tx, p) => answerWithExisting(tx, p, r.id, INDEXED_DOC))).rejects.toMatchObject(db(/turn the assistant off/));
    await svc(U.cadmin, (tx, p) => answerWithExisting(tx, p, r.id, SHARED_DOC));
    await expect(owner.query(`UPDATE documents SET ai_indexable = true WHERE id = $1`, [SHARED_DOC])).rejects.toThrow(/stays out of the assistant/);
    // A standard item with an indexed file cannot quietly become confidential.
    const s = await create(U.cons, { title: "Process maps" });
    await svc(U.cadmin, (tx, p) => answerWithExisting(tx, p, s.id, INDEXED_DOC));
    await expect(svc(U.cons, (tx, p) => updateInfoRequest(tx, p, s.id, { sensitivity: "confidential" }))).rejects.toMatchObject(
      db(/assistant off for its files first/),
    );
  });
});

describe("reminders", () => {
  const DUE = "2027-03-10";
  const add = (extra: Record<string, unknown>) =>
    svc(U.cons, (tx, p) => createInfoRequest(tx, p, PROJ2, infoRequestInput.parse({ area: "finance", dueDate: DUE, ...extra })));
  const told = async () =>
    (
      await owner.query(
        `SELECT u.name, n.kind FROM notifications n JOIN "user" u ON u.id = n.user_id
         WHERE n.entity_id = $1 AND n.kind IN ('info_request.due_soon', 'info_request.overdue') ORDER BY n.kind, u.name`,
        [PROJ2],
      )
    ).rows.map((r) => `${r.name}:${r.kind}`);

  it("remind the owner (or the client admins) once per step, and widen to the managers and the firm when long overdue", async () => {
    await add({ title: "Audited statements", ownerUserId: U.owner1 });
    await add({ title: "Budget", ownerUserId: U.owner1 });
    await add({ title: "Loan agreements" });
    const answered = await add({ title: "Zakat certificate", ownerUserId: U.owner1 });
    await svc(U.cadmin, (tx, p) => answerWithUpload(tx, p, answered.id, upload("zakat.pdf")));
    // Nothing yet a week before.
    await runFollowUps(owner, "2027-03-03");
    expect(await told()).toEqual([]);
    // Due soon: one note for owner1 however many items, one for the client admin for the unowned one; never for the answered one.
    await runFollowUps(owner, "2027-03-08");
    await runFollowUps(owner, "2027-03-09");
    expect(await told()).toEqual(["cadmin:info_request.due_soon", "owner1:info_request.due_soon"]);
    await runFollowUps(owner, "2027-03-11");
    expect((await told()).filter((x) => x.endsWith("overdue"))).toEqual(["cadmin:info_request.overdue", "owner1:info_request.overdue"]);
    // A week over: the managers on the project and the firm-side team hear too.
    await runFollowUps(owner, "2027-03-17");
    expect((await told()).filter((x) => x.endsWith("overdue"))).toEqual([
      "cadmin:info_request.overdue",
      "cadmin:info_request.overdue",
      "cmgr:info_request.overdue",
      "cons:info_request.overdue",
      "owner1:info_request.overdue",
      "owner1:info_request.overdue",
    ]);
    // A re-run the same day sends nothing again.
    const before = (await told()).length;
    await runFollowUps(owner, "2027-03-17");
    expect((await told()).length).toBe(before);
    // Other clients' people hear nothing.
    expect((await told()).some((x) => x.startsWith("betaAdmin") || x.startsWith("outsider"))).toBe(false);
  });
});

describe("withdrawing a wrong file (N8)", () => {
  const docOf = async (doc: string) =>
    (await owner.query(`SELECT state, ai_indexable, withdrawn_reason FROM documents WHERE id = $1`, [doc])).rows[0];

  it("lets only the uploader take back a file nobody relied on, and the item asks again", async () => {
    const r = await create(U.cons, { title: "Shareholder register", ownerUserId: U.owner1 });
    const doc = await svc(U.owner1, (tx, p) => answerWithUpload(tx, p, r.id, upload("wrong.pdf")));
    expect((await statusOf(r.id)).status).toBe("received");
    await expect(svc(U.cadmin, (tx, p) => withdrawDocument(tx, p, doc.id, "Not ours"))).rejects.toThrow(/cannot be withdrawn/);
    await expect(attempt(U.cadmin, `SELECT app_withdraw_document($1, 'Not ours')`, [doc.id])).rejects.toThrow(/only the person who uploaded/);
    await expect(attempt(U.owner1, `SELECT app_withdraw_document($1, 'x')`, [doc.id])).rejects.toThrow(/say why/);
    await svc(U.owner1, (tx, p) => withdrawDocument(tx, p, doc.id, "Sent last year's register by mistake"));
    expect(await docOf(doc.id)).toEqual({ state: "archived", ai_indexable: false, withdrawn_reason: "Sent last year's register by mistake" });
    expect((await statusOf(r.id)).status).toBe("requested");
    const list = (await svc(U.owner1, (tx, p) => listInfoRequests(tx, p, PROJ)))!;
    expect(list.items.find((i) => i.id === r.id)!.files).toEqual([]);
    expect(list.files.some((f) => f.id === doc.id)).toBe(false);
    const logged = await owner.query(`SELECT 1 FROM activity_events WHERE entity_id = $1 AND event = 'document_withdrawn'`, [doc.id]);
    expect(logged.rowCount).toBe(1);
    await expect(svc(U.owner1, (tx, p) => withdrawDocument(tx, p, doc.id, "Again"))).rejects.toThrow(/cannot be withdrawn/);
    // Withdrawn stays withdrawn, and nobody writes the record by hand.
    await expect(attempt(U.owner1, `UPDATE documents SET state = 'submitted' WHERE id = $1`, [doc.id])).rejects.toThrow(/document_withdrawn/);
    await expect(attempt(U.owner1, `UPDATE documents SET withdrawn_reason = 'edited' WHERE id = $1`, [doc.id])).rejects.toThrow(/withdrawn only by/);
  });

  it("keeps a file someone relied on, evidence, and a file with versions", async () => {
    const r = await create(U.cons, { title: "Signed policy", ownerUserId: U.owner1 });
    const doc = await svc(U.owner1, (tx, p) => answerWithUpload(tx, p, r.id, upload("policy.pdf")));
    await svc(U.cons, (tx, p) => moveInfoRequest(tx, p, r.id, { status: "reviewed" }));
    await expect(attempt(U.owner1, `SELECT app_withdraw_document($1, 'Wrong one')`, [doc.id])).rejects.toThrow(/relied on/);

    const evidence = id(41);
    await owner.query(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, storage_key, content_type, size_bytes, sha256, scan_status)
       VALUES ($1::uuid,$2,$3,$3,$4,'evidence','submitted','e.pdf','shared',$1::text,'text/plain',1,$5,'clean')`,
      [evidence, PROJ, ACME, U.owner1, "0".repeat(64)],
    );
    await expect(attempt(U.owner1, `SELECT app_withdraw_document($1, 'Wrong one')`, [evidence])).rejects.toThrow(/returned by the reviewer/);

    const v1 = id(42);
    const v2 = id(43);
    await owner.query(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, storage_key, content_type, size_bytes, sha256, scan_status, version, supersedes_id)
       VALUES ($1::uuid,$3,$4,$4,$5,'client_document','submitted','v1','shared',$1::text,'text/plain',1,$6,'clean',1,NULL),
              ($2::uuid,$3,$4,$4,$5,'client_document','submitted','v2','shared',$2::text,'text/plain',1,$6,'clean',2,$1::uuid)`,
      [v1, v2, PROJ, ACME, U.owner1, "0".repeat(64)],
    );
    await expect(attempt(U.owner1, `SELECT app_withdraw_document($1, 'Wrong one')`, [v2])).rejects.toThrow(/new version/);
    await expect(attempt(U.owner1, `SELECT app_withdraw_document($1, 'Wrong one')`, [v1])).rejects.toThrow(/new version/);
  });
});
