// No-login upload links for one information request item (wave 2, F14
// part 2, decision D6) against a real Postgres: who makes and sees them,
// what the public page gets, how a file sent through one is filed, and every
// way a link stops working (expired, revoked, item closed, project closed),
// with the wall between items and between clients.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { infoRequestInput } from "@/lib/info-requests";
import { renderMail } from "@/lib/mail-templates";
import { loadPrincipal } from "@/services/principal";
import { truncateAuditLog } from "./audit-reset";

const stored: string[] = [];
vi.mock("@/services/storage", () => ({ putObject: async (key: string) => void stored.push(key) }));
const { createInfoRequest, listInfoRequests, moveInfoRequest } = await import("@/services/info-requests");
const { createUploadLink, openUploadLink, revokeUploadLink, uploadByLink } = await import("@/services/upload-links");

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-f142-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = {
  admin: id(11),
  cons: id(12), // staffed on PROJ
  outsider: id(13), // a consultant not on PROJ
  cadmin: id(14),
  cmgr: id(15), // on PROJ
  betaAdmin: id(16),
  betaCons: id(17), // staffed on BETA_PROJ only
};
const PROJ = id(21);
const BETA_PROJ = id(22);

/** As a signed-in person (selah.user_id set), or, with null, as the public with no user. */
async function as<T>(userId: string | null, fn: (c: PoolClient) => Promise<T>, commit = true): Promise<T> {
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
const txOf = (c: PoolClient) => drizzle(c, { schema }) as unknown as Tx;
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(userId, async (c) => {
    const tx = txOf(c);
    return fn(tx, (await loadPrincipal(tx, userId))!);
  });
const pub = <R>(fn: (tx: Tx) => Promise<R>) => as(null, (c) => fn(txOf(c)));
const db = (re: RegExp) => ({ cause: { message: expect.stringMatching(re) } });

const file = (name: string) => ({
  bytes: new TextEncoder().encode(name),
  fileName: name,
  contentType: "text/plain",
  sha256: "0".repeat(64),
  scanned: true,
  scanMs: 1,
});
const item = (projectId = PROJ, by = U.cons, title = "Signed shareholder agreement") =>
  svc(by, (tx, p) => createInfoRequest(tx, p, projectId, infoRequestInput.parse({ area: "legal", title, description: "All pages, signed" })));
/** Make a link as the consultant and read its token from the queued mail. */
async function linkFor(requestId: string, by = U.cons, days = 7) {
  const link = await svc(by, (tx, p) => createUploadLink(tx, p, requestId, { email: " Partner@Acme.Example ", days }));
  const mail = (
    await owner.query(`SELECT link FROM outbound_emails WHERE kind = 'info_request.upload_link' ORDER BY created_at DESC LIMIT 1`)
  ).rows[0].link as string;
  return { ...link, token: mail.replace("/upload/", "") };
}
const open = (token: string) => pub((tx) => openUploadLink(tx, token, false));
const send = (token: string, name = "agreement.txt") => pub((tx) => uploadByLink(tx, token, file(name)));
const audit = async () =>
  (await owner.query(`SELECT action, actor_id, resource_type, outcome, reason, meta FROM audit_log ORDER BY created_at`)).rows as {
    action: string;
    actor_id: string | null;
    resource_type: string;
    outcome: string;
    reason: string | null;
    meta: Record<string, unknown>;
  }[];

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name, name_ar) VALUES ($1,'firm','Example Advisory','مكتب المثال'), ($2,'client','Acme',null), ($3,'client','Beta',null)`, [
    FIRM,
    ACME,
    BETA,
  ]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role, active) VALUES
      ($1,$8,'firm_admin',true), ($2,$8,'consultant',true), ($3,$8,'consultant',true), ($4,$9,'client_admin',true),
      ($5,$9,'client_manager',true), ($6,$10,'client_admin',true), ($7,$8,'consultant',true)`,
    [U.admin, U.cons, U.outsider, U.cadmin, U.cmgr, U.betaAdmin, U.betaCons, FIRM, ACME, BETA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$3,$5,'Acme governance','active',$6), ($2,'client',$4,$5,'Beta strategy','active',$6)`,
    [PROJ, BETA_PROJ, ACME, BETA, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,false), ($1,$3,false), ($4,$5,false)`, [
    ACME,
    U.cons,
    U.outsider,
    BETA,
    U.betaCons,
  ]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($4,$5)`, [PROJ, U.cons, U.cmgr, BETA_PROJ, U.betaCons]);
});

beforeEach(async () => {
  await owner.query(`TRUNCATE outbound_emails, notifications`);
  await truncateAuditLog(owner);
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

describe("making a link", () => {
  it("is for a consultant on the project: mailed to the address typed, only the token's hash kept, logged", async () => {
    const { id: rid } = await item();
    const link = await linkFor(rid);
    expect(link.email).toBe("partner@acme.example");
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = (await owner.query(`SELECT token_hash, expires_at - created_at AS span FROM info_request_links WHERE id = $1`, [link.id])).rows[0];
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.token_hash).not.toContain(link.token);
    expect(row.span).toEqual({ days: 7 });
    const mail = (await owner.query(`SELECT to_email, kind FROM outbound_emails`)).rows;
    expect(mail).toEqual([{ to_email: "partner@acme.example", kind: "info_request.upload_link" }]);
    // The mail carries the link and a line, never the item.
    const text = renderMail("info_request.upload_link", `/upload/${link.token}`, "http://selah.test").text;
    expect(text).toContain(`http://selah.test/upload/${link.token}`);
    expect(text).not.toContain("shareholder");
    expect((await audit()).map((a) => [a.action, a.outcome])).toEqual([["info_request.link_create", "allow"]]);
  });

  it("is refused to the client, to a consultant off the project, and outside one hour to 30 days", async () => {
    const { id: rid } = await item();
    for (const who of [U.cadmin, U.cmgr, U.outsider, U.betaCons]) {
      await expect(svc(who, (tx, p) => createUploadLink(tx, p, rid, { email: "x@acme.example", days: 7 })), who).rejects.toThrow();
    }
    const insert = `INSERT INTO info_request_links (request_id, project_id, org_id, token_hash, email, expires_at, created_by)
                    VALUES ($1,$2,$3,$4,'x@acme.example', now() + $5::interval, $6)`;
    const hash = (n: number) => String(n).repeat(64).slice(0, 64);
    await expect(as(U.cadmin, (c) => c.query(insert, [rid, PROJ, ACME, hash(1), "7 days", U.cadmin]))).rejects.toThrow(/row-level security/);
    await expect(as(U.cons, (c) => c.query(insert, [rid, PROJ, ACME, hash(2), "31 days", U.cons]))).rejects.toThrow(/one hour to 30 days/);
    await expect(as(U.cons, (c) => c.query(insert, [rid, PROJ, ACME, hash(3), "10 minutes", U.cons]))).rejects.toThrow(/one hour to 30 days/);
    await expect(svc(U.cons, (tx, p) => createUploadLink(tx, p, rid, { email: "not-an-address", days: 7 }))).rejects.toMatchObject(
      db(/not an email address/),
    );
  });

  it("can't be sent for a token other than its own, or by anyone but its maker", async () => {
    const { id: rid } = await item();
    const link = await linkFor(rid);
    await expect(as(U.cons, (c) => c.query(`SELECT app_send_upload_link($1, 'another-token')`, [link.id]))).rejects.toThrow(/not allowed/);
    await expect(as(U.admin, (c) => c.query(`SELECT app_send_upload_link($1, $2)`, [link.id, link.token]))).rejects.toThrow(/not allowed/);
  });

  it("is firm-only: the client sees neither links nor addresses", async () => {
    const { id: rid } = await item();
    await linkFor(rid);
    const count = (who: string) => as(who, async (c) => (await c.query(`SELECT count(*)::int AS n FROM info_request_links`)).rows[0].n);
    expect(await count(U.cons)).toBeGreaterThan(0);
    expect(await count(U.admin)).toBeGreaterThan(0);
    for (const who of [U.cadmin, U.cmgr, U.betaAdmin, U.betaCons]) expect(await count(who), who).toBe(0);
    const forClient = (await svc(U.cmgr, (tx, p) => listInfoRequests(tx, p, PROJ)))!.items.find((i) => i.id === rid)!;
    expect(forClient.links).toEqual([]);
    expect(forClient.can.sendLink).toBe(false);
    const forFirm = (await svc(U.cons, (tx, p) => listInfoRequests(tx, p, PROJ)))!.items.find((i) => i.id === rid)!;
    expect(forFirm.links).toMatchObject([{ email: "partner@acme.example", uploads: 0 }]);
    expect(forFirm.can.sendLink).toBe(true);
  });
});

describe("using a link", () => {
  it("opens only the item and the firm's name, and logs the open", async () => {
    const { id: rid } = await item();
    const { token, id: linkId } = await linkFor(rid);
    const page = await open(token);
    expect(page).toEqual({
      title: "Signed shareholder agreement",
      description: "All pages, signed",
      confidential: false,
      firmName: "Example Advisory",
      expiresAt: expect.any(Date),
    });
    expect((await pub((tx) => openUploadLink(tx, token, true)))!.firmName).toBe("مكتب المثال");
    const opens = (await audit()).filter((a) => a.action === "info_request.link_opened");
    expect(opens).toHaveLength(2);
    expect(opens[0]).toMatchObject({ actor_id: null, resource_type: "info_request_link", outcome: "allow", meta: { request_id: rid } });
    // A made-up token: nothing, and nothing to log against.
    expect(await open("A".repeat(43))).toBeNull();
    expect(linkId).toBeTruthy();
  });

  it("files a file against its one item, as come by link from the address, for the firm to review like any answer", async () => {
    const { id: rid } = await item();
    const { id: other } = await item(PROJ, U.cons, "Board minutes");
    const { token, id: linkId } = await linkFor(rid);
    await send(token);
    const doc = (
      await owner.query(
        `SELECT d.id, d.org_id, d.owner_org_id, d.uploaded_by, d.visibility, d.purpose, d.scan_status, f.attached_by, f.via_link_id
         FROM info_request_files f JOIN documents d ON d.id = f.document_id WHERE f.request_id = $1`,
        [rid],
      )
    ).rows;
    expect(doc).toEqual([
      expect.objectContaining({
        org_id: ACME,
        owner_org_id: ACME,
        uploaded_by: U.cons,
        visibility: "shared",
        purpose: "client_document",
        scan_status: "clean",
        attached_by: U.cons,
        via_link_id: linkId,
      }),
    ]);
    expect(stored).toHaveLength(1);
    expect((await owner.query(`SELECT status FROM info_requests WHERE id = $1`, [rid])).rows[0].status).toBe("received");
    // The other item is untouched.
    expect((await owner.query(`SELECT status FROM info_requests WHERE id = $1`, [other])).rows[0].status).toBe("requested");
    expect((await owner.query(`SELECT uploads, last_used_at IS NOT NULL AS used FROM info_request_links WHERE id = $1`, [linkId])).rows[0]).toEqual({
      uploads: 1,
      used: true,
    });
    // The firm-side team is told, and the upload logged.
    const told = (await owner.query(`SELECT user_id FROM notifications WHERE kind = 'info_request.received'`)).rows.map((r) => r.user_id);
    expect(told).toContain(U.cons);
    expect((await audit()).at(-1)).toMatchObject({ action: "info_request.link_upload", actor_id: null, outcome: "allow", meta: { link_id: linkId, request_id: rid } });
    // The firm sees who sent it; the client sees the file came by link, not the address.
    const firmFile = (await svc(U.cons, (tx, p) => listInfoRequests(tx, p, PROJ)))!.items.find((i) => i.id === rid)!.files[0];
    expect(firmFile).toMatchObject({ viaLink: true, viaEmail: "partner@acme.example" });
    const clientFile = (await svc(U.cmgr, (tx, p) => listInfoRequests(tx, p, PROJ)))!.items.find((i) => i.id === rid)!.files[0];
    expect(clientFile).toMatchObject({ viaLink: true, viaEmail: null });
    // And reviews it like any other answer, which closes the link.
    await svc(U.cons, (tx, p) => moveInfoRequest(tx, p, rid, { status: "reviewed" }));
    expect(await open(token)).toBeNull();
  });

  it("stops working once expired", async () => {
    const { id: rid } = await item();
    const { token, id: linkId } = await linkFor(rid);
    await owner.query(`ALTER TABLE info_request_links DISABLE TRIGGER info_request_link_rules`);
    await owner.query(`UPDATE info_request_links SET expires_at = now() - interval '1 second' WHERE id = $1`, [linkId]);
    await owner.query(`ALTER TABLE info_request_links ENABLE TRIGGER info_request_link_rules`);
    expect(await open(token)).toBeNull();
    expect(await send(token)).toEqual({ ok: false, error: "link_closed" });
    const log = await audit();
    expect(log.find((a) => a.action === "info_request.link_opened")).toMatchObject({ outcome: "deny", reason: "expired" });
    expect(log.find((a) => a.action === "info_request.link_upload")).toMatchObject({ outcome: "deny", reason: "expired" });
    expect((await as(null, (c) => c.query(`SELECT * FROM app_upload_link_target($1)`, [hashOf(token)]))).rows).toEqual([]);
  });

  it("stops working once revoked, which only the firm on the project can do and only once", async () => {
    const { id: rid } = await item();
    const { token, id: linkId } = await linkFor(rid);
    await expect(svc(U.cmgr, (tx, p) => revokeUploadLink(tx, p, linkId))).rejects.toThrow();
    await expect(svc(U.outsider, (tx, p) => revokeUploadLink(tx, p, linkId))).rejects.toThrow();
    await svc(U.cons, (tx, p) => revokeUploadLink(tx, p, linkId));
    expect((await owner.query(`SELECT revoked_by FROM info_request_links WHERE id = $1`, [linkId])).rows[0].revoked_by).toBe(U.cons);
    expect(await open(token)).toBeNull();
    expect(await send(token)).toEqual({ ok: false, error: "link_closed" });
    expect((await audit()).find((a) => a.action === "info_request.link_revoke")).toMatchObject({ outcome: "allow" });
    // A revoked link stays revoked, and nothing else about a link can be changed.
    await expect(as(U.cons, (c) => c.query(`UPDATE info_request_links SET revoked_at = NULL, revoked_by = NULL WHERE id = $1`, [linkId]))).rejects.toThrow(
      /can only be revoked/,
    );
    const { id: fresh } = await linkFor(rid);
    await expect(
      as(U.cons, (c) => c.query(`UPDATE info_request_links SET expires_at = expires_at + interval '20 days' WHERE id = $1`, [fresh])),
    ).rejects.toThrow(/can only be revoked/);
  });

  it("stops working when its item is marked not applicable or the project closes", async () => {
    const { id: rid } = await item();
    const { token } = await linkFor(rid);
    await svc(U.cons, (tx, p) => moveInfoRequest(tx, p, rid, { status: "not_applicable", note: "They have no such agreement" }));
    expect(await open(token)).toBeNull();
    await expect(svc(U.cons, (tx, p) => createUploadLink(tx, p, rid, { email: "x@acme.example", days: 7 }))).rejects.toThrow(/not open/);

    const { id: rid2 } = await item();
    const second = await linkFor(rid2);
    await owner.query(`UPDATE projects SET state = 'closed' WHERE id = $1`, [PROJ]);
    try {
      expect(await open(second.token)).toBeNull();
      expect(await send(second.token)).toEqual({ ok: false, error: "link_closed" });
      expect((await audit()).filter((a) => a.action === "info_request.link_opened").at(-1)).toMatchObject({ outcome: "deny", reason: "project closed" });
    } finally {
      await owner.query(`UPDATE projects SET state = 'active' WHERE id = $1`, [PROJ]);
    }
  });

  it("takes at most ten files", async () => {
    const { id: rid } = await item();
    const { token } = await linkFor(rid);
    for (let i = 0; i < 10; i++) await send(token, `part-${i}.txt`);
    expect(await send(token, "part-10.txt")).toEqual({ ok: false, error: "too_many_files" });
    expect((await owner.query(`SELECT count(*)::int AS n FROM info_request_files WHERE request_id = $1`, [rid])).rows[0].n).toBe(10);
  });

  it("keeps clients apart: a link files only into its own client's project, which the other client never sees", async () => {
    const { id: acmeItem } = await item();
    const { id: betaItem } = await item(BETA_PROJ, U.betaCons, "Beta's charter");
    const acme = await linkFor(acmeItem);
    const beta = await linkFor(betaItem, U.betaCons);
    await send(acme.token, "acme.txt");
    await send(beta.token, "beta.txt");
    const files = (
      await owner.query(`SELECT f.request_id, d.org_id, d.project_id, d.title FROM info_request_files f JOIN documents d ON d.id = f.document_id
                         WHERE f.request_id = ANY($1) ORDER BY d.title`, [[acmeItem, betaItem]])
    ).rows;
    expect(files).toEqual([
      { request_id: acmeItem, org_id: ACME, project_id: PROJ, title: "acme.txt" },
      { request_id: betaItem, org_id: BETA, project_id: BETA_PROJ, title: "beta.txt" },
    ]);
    // Beta's admin sees neither Acme's link nor its file; Acme's people none of Beta's.
    const seen = (who: string) =>
      as(who, async (c) => (await c.query(`SELECT d.title FROM documents d WHERE d.title IN ('acme.txt', 'beta.txt') ORDER BY 1`)).rows.map((r) => r.title));
    expect(await seen(U.betaAdmin)).toEqual(["beta.txt"]);
    expect(await seen(U.cadmin)).toEqual(["acme.txt"]);
    // A consultant on Beta only can't revoke or read Acme's link.
    await expect(svc(U.betaCons, (tx, p) => revokeUploadLink(tx, p, acme.id))).rejects.toThrow();
  });

  it("can't be faked: nobody files an answer as come by link but the link itself", async () => {
    const { id: rid } = await item();
    const { id: linkId } = await linkFor(rid);
    const doc = id(90);
    await owner.query(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, storage_key, content_type, size_bytes, sha256, scan_status)
       VALUES ($1,$2,$3,$3,$4,'client_document','submitted','own.txt','shared','own-key','text/plain',1,$5,'clean')`,
      [doc, PROJ, ACME, U.cadmin, "0".repeat(64)],
    );
    await expect(
      as(U.cadmin, (c) => c.query(`INSERT INTO info_request_files (request_id, document_id, attached_by, via_link_id) VALUES ($1,$2,$3,$4)`, [rid, doc, U.cadmin, linkId])),
    ).rejects.toThrow(/only an upload link/);
    // The public has no direct way in: only the functions granted to it.
    await expect(as(null, (c) => c.query(`SELECT count(*) FROM info_request_links`))).resolves.toMatchObject({ rows: [{ count: "0" }] });
  });
});

/** The same hash the service stores. */
function hashOf(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
