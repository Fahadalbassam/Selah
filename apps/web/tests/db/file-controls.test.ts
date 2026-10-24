// File controls against a real Postgres (wave 1, item 3): sharing a file with
// the other side, the assistant flag and new versions. The service decides
// what to offer; the database refuses the same things on its own.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { loadPrincipal } from "@/services/principal";

const stored: string[] = [];
vi.mock("@/services/storage", () => ({
  putObject: async (key: string) => void stored.push(key),
  signedDownloadUrl: async () => "https://example.test/x",
  DOWNLOAD_TTL_SECONDS: 60,
}));
const { fileControls, loadDocument, setAssistantFlag, shareDocument, uploadNewVersion } = await import("@/services/documents");

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-a950-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const U = {
  admin: id(11),
  cons: id(12), // Acme's lead, on its project
  betaCons: id(13), // Beta's consultant only
  cadmin: id(14),
  cmgr: id(15),
  owner: id(16), // action owner
  betaAdmin: id(17),
};
const P = { acme: id(21), beta: id(22), internal: id(23), closed: id(25) };
const D = {
  firmOnly: id(51),
  clientPrivate: id(52),
  shared: id(53), // firm deliverable, already shared
  clientShared: id(54), // the client's own shared upload
  evidence: id(55),
  firmEvidence: id(56), // firm-only evidence draft (never shared by hand)
  beta: id(57),
  internal: id(58),
  closed: id(60),
  archived: id(61),
};

async function as<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    const out = await fn(c);
    await c.query("ROLLBACK"); // every test starts from the same files
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(userId, async (c) => {
    const tx = drizzle(c, { schema }) as unknown as Tx;
    return fn(tx, (await loadPrincipal(tx, userId))!);
  });
const sqlAs = (userId: string, sql: string, params: unknown[] = []) => as(userId, (c) => c.query(sql, params));
const controls = (userId: string, docId: string) =>
  svc(userId, async (tx, p) => {
    const loaded = await loadDocument(tx, docId);
    return loaded ? fileControls(p, loaded) : null;
  });
const upload = { bytes: new TextEncoder().encode("v2"), fileName: "plan v2.pdf", contentType: "application/pdf", sha256: "sha-v2", scanned: true, scanMs: 3 };

async function doc(docId: string, f: { project: string; org: string; by: string; ownerOrg: string; title: string; visibility?: string; purpose?: string; state?: string }) {
  await owner.query(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility,
       storage_key, content_type, size_bytes, sha256, scan_status, ai_indexable)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'application/pdf',10,'abc','clean',$11)`,
    [docId, f.project, f.org, f.ownerOrg, f.by, f.purpose ?? "deliverable", f.state ?? "submitted", f.title, f.visibility ?? "shared", `k-${docId}`, f.purpose !== "evidence"],
  );
}

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [FIRM, ACME, BETA]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$8,'firm_admin'), ($2,$8,'consultant'), ($3,$8,'consultant'),
      ($4,$9,'client_admin'), ($5,$9,'client_manager'), ($6,$9,'action_owner'), ($7,$10,'client_admin')`,
    [U.admin, U.cons, U.betaCons, U.cadmin, U.cmgr, U.owner, U.betaAdmin, FIRM, ACME, BETA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$5,$7,'Acme governance','active',$8), ($2,'client',$6,$7,'Beta governance','active',$8),
      ($3,'internal',$7,$7,'Firm methods','active',$8), ($4,'client',$5,$7,'Acme last year','closed',$8)`,
    [P.acme, P.beta, P.internal, P.closed, ACME, BETA, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($3,$4,true)`, [ACME, U.cons, BETA, U.betaCons]);
  await q(
    `INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4), ($5,$6), ($7,$2), ($8,$2), ($8,$3)`,
    [P.acme, U.cons, U.cmgr, U.owner, P.beta, U.betaCons, P.internal, P.closed],
  );
  const acme = { project: P.acme, org: ACME };
  await doc(D.firmOnly, { ...acme, by: U.cons, ownerOrg: FIRM, title: "draft plan", visibility: "firm_private" });
  await doc(D.clientPrivate, { ...acme, by: U.cadmin, ownerOrg: ACME, title: "board minutes", visibility: "client_private", purpose: "client_document" });
  await doc(D.shared, { ...acme, by: U.cons, ownerOrg: FIRM, title: "plan v1" });
  await doc(D.clientShared, { ...acme, by: U.cmgr, ownerOrg: ACME, title: "org chart", purpose: "client_document" });
  await doc(D.evidence, { ...acme, by: U.cmgr, ownerOrg: ACME, title: "signed charter", purpose: "evidence" });
  await doc(D.firmEvidence, { ...acme, by: U.cons, ownerOrg: FIRM, title: "firm evidence", purpose: "evidence", visibility: "firm_private" });
  await doc(D.archived, { ...acme, by: U.cons, ownerOrg: FIRM, title: "old", state: "archived" });
  await doc(D.beta, { project: P.beta, org: BETA, by: U.betaCons, ownerOrg: FIRM, title: "beta plan", visibility: "firm_private" });
  await doc(D.internal, { project: P.internal, org: FIRM, by: U.cons, ownerOrg: FIRM, title: "method", visibility: "firm_private" });
  await doc(D.closed, { project: P.closed, org: ACME, by: U.cons, ownerOrg: FIRM, title: "last report" });
});

beforeEach(() => void (stored.length = 0));

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("what each side is offered", () => {
  it("the firm shares its firm-only file with the client, switches the assistant and adds versions", async () => {
    // Only the uploader may also withdraw a wrong file (N8).
    expect(await controls(U.cons, D.firmOnly)).toEqual({ shareWithClient: true, shareWithFirm: false, assistant: true, newVersion: true, withdraw: true });
    expect(await controls(U.admin, D.firmOnly)).toEqual({ shareWithClient: true, shareWithFirm: false, assistant: true, newVersion: true, withdraw: false });
  });

  it("the client's admin shares its private file with the firm; nobody else does", async () => {
    expect(await controls(U.cadmin, D.clientPrivate)).toEqual({ shareWithClient: false, shareWithFirm: true, assistant: true, newVersion: true, withdraw: true });
    expect((await controls(U.cmgr, D.clientPrivate))?.shareWithFirm ?? false).toBe(false);
  });

  it("nobody is offered anything on the other side's file", async () => {
    expect(await controls(U.cadmin, D.shared)).toEqual({ shareWithClient: false, shareWithFirm: false, assistant: false, newVersion: false, withdraw: false });
    expect(await controls(U.cons, D.clientShared)).toEqual({ shareWithClient: false, shareWithFirm: false, assistant: false, newVersion: false, withdraw: false });
    expect(await controls(U.owner, D.clientShared)).toEqual({ shareWithClient: false, shareWithFirm: false, assistant: false, newVersion: false, withdraw: false });
  });

  it("evidence, archived and superseded files and closed projects limit the offer", async () => {
    const none = { shareWithClient: false, shareWithFirm: false, assistant: false, newVersion: false, withdraw: false };
    expect(await controls(U.cmgr, D.evidence)).toEqual(none);
    expect(await controls(U.cons, D.firmEvidence)).toEqual(none);
    expect(await controls(U.cons, D.archived)).toEqual(none);
    expect(await controls(U.cons, D.internal)).toEqual({ ...none, assistant: true, newVersion: true, withdraw: true });
    expect(await controls(U.cons, D.closed)).toEqual({ ...none, assistant: true });
    const superseded = await svc(U.cons, async (tx, p) => {
      await uploadNewVersion(tx, p, D.shared, upload);
      return fileControls(p, (await loadDocument(tx, D.shared))!);
    });
    expect(superseded).toEqual(none);
  });
});

describe("sharing", () => {
  it("shares a firm-only file with the client and records it in the history", async () => {
    const seen = await svc(U.cons, async (tx, p) => {
      await shareDocument(tx, p, D.firmOnly);
      const { rows } = await tx.execute(
        sql`SELECT visibility, (SELECT count(*) FROM activity_events WHERE entity_id = ${D.firmOnly} AND event = 'document_shared')::int AS events
            FROM documents WHERE id = ${D.firmOnly}`,
      );
      return rows[0];
    });
    expect(seen).toEqual({ visibility: "shared", events: 1 });
  });

  it("refuses to share evidence by hand, or to take a shared file back", async () => {
    await expect(svc(U.cons, (tx, p) => shareDocument(tx, p, D.firmEvidence))).rejects.toThrow(/cannot be shared/);
    await expect(sqlAs(U.cons, `UPDATE documents SET visibility = 'shared' WHERE id = $1`, [D.firmEvidence])).rejects.toThrow(/submitting it/);
    await expect(sqlAs(U.cons, `UPDATE documents SET visibility = 'firm_private' WHERE id = $1`, [D.shared])).rejects.toThrow(/stays shared/);
  });

  it("refuses the other side, in the service and in the database", async () => {
    await expect(svc(U.cadmin, (tx, p) => shareDocument(tx, p, D.firmOnly))).rejects.toThrow(/not found|forbidden/);
    await expect(svc(U.cmgr, (tx, p) => shareDocument(tx, p, D.clientPrivate))).rejects.toThrow(/forbidden/);
    await expect(sqlAs(U.cmgr, `UPDATE documents SET ai_indexable = false WHERE id = $1`, [D.shared])).rejects.toThrow(/owns a file/);
  });

  it("a client's admin shares its private file with the firm", async () => {
    expect(await svc(U.cadmin, (tx, p) => shareDocument(tx, p, D.clientPrivate))).toEqual({ id: D.clientPrivate, visibility: "shared" });
  });
});

describe("the assistant flag", () => {
  it("the owning side turns it off and on again", async () => {
    const flags = await svc(U.cmgr, async (tx, p) => {
      await setAssistantFlag(tx, p, D.clientShared, false);
      const off = (await loadDocument(tx, D.clientShared))!.doc.aiIndexable;
      await setAssistantFlag(tx, p, D.clientShared, true);
      return [off, (await loadDocument(tx, D.clientShared))!.doc.aiIndexable];
    });
    expect(flags).toEqual([false, true]);
  });

  it("is refused on the other side's file and on evidence", async () => {
    await expect(svc(U.cons, (tx, p) => setAssistantFlag(tx, p, D.clientShared, false))).rejects.toThrow(/forbidden/);
    await expect(svc(U.cmgr, (tx, p) => setAssistantFlag(tx, p, D.evidence, false))).rejects.toThrow(/cannot be changed/);
  });
});

describe("new versions", () => {
  it("keeps the label and department, takes the next number and retires the old version from the assistant", async () => {
    const out = await svc(U.cons, async (tx, p) => {
      const made = await uploadNewVersion(tx, p, D.shared, upload);
      const next = (await loadDocument(tx, made.id))!.doc;
      const old = (await loadDocument(tx, D.shared))!.doc;
      return { version: made.version, visibility: next.visibility, supersedes: next.supersedesId, title: next.title, oldFlag: old.aiIndexable };
    });
    expect(out).toEqual({ version: 2, visibility: "shared", supersedes: D.shared, title: "plan v2.pdf", oldFlag: false });
    expect(stored).toHaveLength(1);
  });

  it("refuses a second version of the same file, a version of evidence and a version by the other side", async () => {
    await expect(
      svc(U.cons, async (tx, p) => {
        await uploadNewVersion(tx, p, D.shared, upload);
        await uploadNewVersion(tx, p, D.shared, upload);
      }),
    ).rejects.toThrow(/cannot be added/);
    await expect(svc(U.cmgr, (tx, p) => uploadNewVersion(tx, p, D.evidence, upload))).rejects.toThrow(/cannot be added/);
    await expect(svc(U.cadmin, (tx, p) => uploadNewVersion(tx, p, D.shared, upload))).rejects.toThrow(/forbidden/);
  });

  it("the database refuses a version that changes the label, skips a number or comes from the other side", async () => {
    const insert = (userId: string, visibility: string, version: number, ownerOrg = FIRM) =>
      sqlAs(
        userId,
        `INSERT INTO documents (project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, version, supersedes_id,
           storage_key, content_type, size_bytes, sha256)
         VALUES ($1,$2,$3,$4,'deliverable','submitted','v2',$5,$6,$7,'k-x','application/pdf',1,'s')`,
        [P.acme, ACME, ownerOrg, userId, visibility, version, D.shared],
      );
    await expect(insert(U.cons, "firm_private", 2)).rejects.toThrow(/keeps its file/);
    await expect(insert(U.cons, "shared", 3)).rejects.toThrow(/next number/);
    await expect(insert(U.cadmin, "shared", 2)).rejects.toThrow(/row-level security|owns a file/);
  });
});

describe("cross-tenant", () => {
  it("another client's consultant and admin can neither see nor change Acme's files", async () => {
    expect(await controls(U.betaCons, D.firmOnly)).toBeNull();
    expect(await controls(U.betaAdmin, D.clientPrivate)).toBeNull();
    await expect(svc(U.betaCons, (tx, p) => shareDocument(tx, p, D.firmOnly))).rejects.toThrow(/not found/);
    await expect(svc(U.betaCons, (tx, p) => setAssistantFlag(tx, p, D.shared, false))).rejects.toThrow(/not found/);
    await expect(svc(U.betaAdmin, (tx, p) => uploadNewVersion(tx, p, D.clientShared, upload))).rejects.toThrow(/not found/);
    const touched = await sqlAs(U.betaCons, `UPDATE documents SET visibility = 'shared' WHERE id = $1`, [D.firmOnly]);
    expect(touched.rowCount).toBe(0);
  });

  it("Acme's consultant can't reach Beta's file", async () => {
    expect(await controls(U.cons, D.beta)).toBeNull();
  });
});
