// The file explorer and reusing a file as evidence, against a real Postgres:
// every role sees exactly the files it could already open, and nothing more.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { loadPrincipal } from "@/services/principal";

const copied: [string, string][] = [];
vi.mock("@/services/storage", () => ({
  copyObject: async (from: string, to: string) => void copied.push([from, to]),
}));
const { attachExistingEvidence, listFiles } = await import("@/services/files");

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 4 });

const id = (n: number) => `00000000-0000-4000-a900-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2); // departments on
const BETA = id(3); // another client
const MANAGED = id(4); // consultant-managed, no accounts
const U = {
  admin: id(11),
  cons: id(12), // on Acme's team, staffed on its project
  bench: id(13), // consultant on no client
  betaCons: id(14), // Beta's consultant only
  cadmin: id(15),
  hrMgr: id(16), // manager in HR
  finMgr: id(17), // manager in Finance
  owner: id(18), // action owner in HR
  betaAdmin: id(19),
};
const P = { acme: id(21), beta: id(22), internal: id(23), managed: id(24) };
const REC = { acme: id(31), beta: id(32), managed: id(33) };
const DEPT = { hr: id(41), fin: id(42) };
const D = {
  shared: id(51), // project file, shared, no department
  sharedV2: id(52), // its second version
  clientPrivate: id(53),
  firmPrivate: id(54),
  hrEvidence: id(55), // HR evidence on an HR action
  toOwner: id(56), // HR manager's file shared with the owner one by one
  finance: id(61), // Finance department file
  ownerDraft: id(57), // the owner's unsubmitted evidence
  beta: id(58),
  internal: id(59),
  infected: id(60),
};
const A = { hr: id(71), beta: id(72), managed: id(73) };

async function as<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    const out = await fn(c);
    await c.query("COMMIT");
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
const titles = async (userId: string, actionId?: string) =>
  (await svc(userId, (tx, p) => listFiles(tx, p, { actionId }))).map((f) => f.title).sort();

async function doc(
  docId: string,
  fields: {
    project: string;
    org: string;
    by: string;
    ownerOrg: string;
    title: string;
    visibility?: string;
    purpose?: string;
    state?: string;
    dept?: string;
    version?: number;
    supersedes?: string;
    scan?: string;
  },
) {
  await owner.query(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, department_id,
       version, supersedes_id, storage_key, content_type, size_bytes, sha256, scan_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'application/pdf',10,'abc',$14)`,
    [
      docId,
      fields.project,
      fields.org,
      fields.ownerOrg,
      fields.by,
      fields.purpose ?? "client_document",
      fields.state ?? "submitted",
      fields.title,
      fields.visibility ?? "shared",
      fields.dept ?? null,
      fields.version ?? 1,
      fields.supersedes ?? null,
      `k-${docId}`,
      fields.scan ?? "clean",
    ],
  );
}

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, departments_enabled) VALUES ($1,'firm','firm',false), ($2,'client','Acme',true), ($3,'client','Beta',false)`,
    [FIRM, ACME, BETA],
  );
  await q(`INSERT INTO organizations (id, kind, name, engagement_mode) VALUES ($1,'client','Family','consultant_managed')`, [MANAGED]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$10,'firm_admin'), ($2,$10,'consultant'), ($3,$10,'consultant'), ($4,$10,'consultant'),
      ($5,$11,'client_admin'), ($6,$11,'client_manager'), ($7,$11,'client_manager'), ($8,$11,'action_owner'),
      ($9,$12,'client_admin')`,
    [U.admin, U.cons, U.bench, U.betaCons, U.cadmin, U.hrMgr, U.finMgr, U.owner, U.betaAdmin, FIRM, ACME, BETA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$4,$6,'Acme governance','active',$7), ($2,'client',$5,$6,'Beta governance','active',$7),
      ($3,'internal',$6,$6,'Firm methods','active',$7)`,
    [P.acme, P.beta, P.internal, ACME, BETA, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($3,$4,true)`, [
    ACME,
    U.cons,
    BETA,
    U.betaCons,
  ]);
  await q(
    `INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4), ($1,$5), ($6,$7), ($8,$2)`,
    [P.acme, U.cons, U.hrMgr, U.finMgr, U.owner, P.beta, U.betaCons, P.internal],
  );
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$3,'الموارد البشرية','HR'), ($2,$3,'المالية','Finance')`, [
    DEPT.hr,
    DEPT.fin,
    ACME,
  ]);
  await q(`INSERT INTO department_members (department_id, user_id, is_head) VALUES ($1,$2,true), ($1,$3,false), ($4,$5,true)`, [
    DEPT.hr,
    U.hrMgr,
    U.owner,
    DEPT.fin,
    U.finMgr,
  ]);
  await q(`INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES ($1,$2,$3,'Charter',$4), ($5,$6,$7,'Charter',$8)`, [
    REC.acme,
    P.acme,
    ACME,
    U.cons,
    REC.beta,
    P.beta,
    BETA,
    U.betaCons,
  ]);
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, department_id, status, created_by) VALUES
      ($1,$2,$3,$4,'Hire a board secretary',$5,$6,'in_progress',$7), ($8,$9,$10,$11,'Beta action',NULL,NULL,'in_progress',$12)`,
    [A.hr, P.acme, ACME, REC.acme, U.owner, DEPT.hr, U.cons, A.beta, P.beta, BETA, REC.beta, U.betaCons],
  );

  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Family charter','active',$4)`,
    [P.managed, MANAGED, FIRM, U.admin],
  );
  await q(`INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES ($1,$2,$3,'Charter',$4)`, [REC.managed, P.managed, MANAGED, U.admin]);
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_name, status, created_by) VALUES ($1,$2,$3,$4,'Family council','Majed','in_progress',$5)`,
    [A.managed, P.managed, MANAGED, REC.managed, U.admin],
  );
  const acme = { project: P.acme, org: ACME };
  await doc(D.shared, { ...acme, by: U.cons, ownerOrg: FIRM, title: "plan v1", purpose: "deliverable" });
  await doc(D.sharedV2, { ...acme, by: U.cons, ownerOrg: FIRM, title: "plan v2", purpose: "deliverable", version: 2, supersedes: D.shared });
  await doc(D.clientPrivate, { ...acme, by: U.cadmin, ownerOrg: ACME, title: "client private", visibility: "client_private" });
  await doc(D.firmPrivate, { ...acme, by: U.cons, ownerOrg: FIRM, title: "firm notes", visibility: "firm_private", purpose: "deliverable" });
  await doc(D.hrEvidence, { ...acme, by: U.hrMgr, ownerOrg: ACME, title: "hr evidence", purpose: "evidence", dept: DEPT.hr });
  await q(`INSERT INTO evidence_submissions (project_id, org_id, action_id, document_id, submitted_by) VALUES ($1,$2,$3,$4,$5)`, [
    P.acme,
    ACME,
    A.hr,
    D.hrEvidence,
    U.hrMgr,
  ]);
  await doc(D.toOwner, { ...acme, by: U.hrMgr, ownerOrg: ACME, title: "hr sheet", dept: DEPT.hr });
  await q(`INSERT INTO document_shares (document_id, user_id, granted_by) VALUES ($1,$2,$3)`, [D.toOwner, U.owner, U.hrMgr]);
  await doc(D.finance, { ...acme, by: U.finMgr, ownerOrg: ACME, title: "finance sheet", dept: DEPT.fin });
  await doc(D.ownerDraft, { ...acme, by: U.owner, ownerOrg: ACME, title: "owner draft", purpose: "evidence", state: "draft" });
  await doc(D.infected, { ...acme, by: U.cadmin, ownerOrg: ACME, title: "not cleared", scan: "pending" });
  await doc(D.beta, { project: P.beta, org: BETA, by: U.betaCons, ownerOrg: FIRM, title: "beta file", purpose: "deliverable" });
  await doc(D.internal, { project: P.internal, org: FIRM, by: U.cons, ownerOrg: FIRM, title: "internal file", purpose: "deliverable" });
});

beforeEach(() => {
  copied.length = 0;
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("who sees which files", () => {
  it("the firm admin sees every client's cleared files and internal work, never a client-private file", async () => {
    expect(await titles(U.admin)).toEqual([
      "beta file",
      "finance sheet",
      "firm notes",
      "hr evidence",
      "hr sheet",
      "internal file",
      "not cleared",
      "plan v2",
    ]);
  });

  it("a consultant sees only the clients and projects they are on", async () => {
    expect(await titles(U.cons)).toEqual(["finance sheet", "firm notes", "hr evidence", "hr sheet", "internal file", "not cleared", "plan v2"]);
    expect(await titles(U.betaCons)).toEqual(["beta file"]);
    expect(await titles(U.bench)).toEqual([]);
  });

  it("the client admin sees all of the company's files, including private ones, and nothing of the firm or other clients", async () => {
    expect(await titles(U.cadmin)).toEqual(["client private", "finance sheet", "hr evidence", "hr sheet", "not cleared", "plan v2"]);
    expect(await titles(U.betaAdmin)).toEqual(["beta file"]);
  });

  it("a manager sees their own department's files and the shared ones, not another department's", async () => {
    expect(await titles(U.hrMgr)).toEqual(["client private", "hr evidence", "hr sheet", "not cleared", "plan v2"]);
    expect(await titles(U.finMgr)).toEqual(["client private", "finance sheet", "not cleared", "plan v2"]);
  });

  it("an action owner sees only their own uploads and files shared with them", async () => {
    expect(await titles(U.owner)).toEqual(["hr sheet", "owner draft"]);
  });

  it("someone else's unsubmitted evidence stays with its uploader", async () => {
    for (const u of [U.admin, U.cons, U.cadmin, U.hrMgr]) expect(await titles(u)).not.toContain("owner draft");
  });

  it("shows where a file came from, who shared it, and whether it can be opened yet", async () => {
    const files = await svc(U.admin, (tx, p) => listFiles(tx, p));
    const byTitle = Object.fromEntries(files.map((f) => [f.title, f]));
    expect(byTitle["hr evidence"]!.source).toEqual({ kind: "evidence", id: A.hr, title: "Hire a board secretary" });
    expect(byTitle["hr evidence"]!.departmentNameEn).toBe("HR");
    expect(byTitle["plan v2"]!.source).toEqual({ kind: "deliverable" });
    expect(byTitle["plan v2"]!.version).toBe(2);
    expect(byTitle["hr sheet"]!.sharedWith).toEqual(["owner"]);
    expect(byTitle["not cleared"]!.available).toBe(false);
    expect(byTitle["internal file"]!.project.kind).toBe("internal");
  });

  it("for an action, lists only that action's client, and refuses an action the person cannot open", async () => {
    expect(await titles(U.admin, A.hr)).toEqual(["finance sheet", "firm notes", "hr evidence", "hr sheet", "not cleared", "plan v2"]);
    await expect(titles(U.cons, A.beta)).rejects.toThrow(/not found/);
    await expect(titles(U.betaAdmin, A.hr)).rejects.toThrow();
  });
});

describe("using an existing file as evidence", () => {
  const attach = (userId: string, documentId: string, actionId = A.hr) =>
    svc(userId, (tx, p) => attachExistingEvidence(tx, p, actionId, { documentId, submitForReview: false }));

  it("copies the file into a new evidence record and leaves the original as it was", async () => {
    const out = await attach(U.owner, D.toOwner);
    expect(copied).toEqual([[`k-${D.toOwner}`, expect.any(String)]]);
    const { rows } = await owner.query(
      `SELECT d.purpose, d.visibility, d.uploaded_by, d.department_id, d.sha256, d.scan_status, d.storage_key FROM documents d WHERE d.id = $1`,
      [out.documentId],
    );
    expect(rows[0]).toMatchObject({ purpose: "evidence", visibility: "shared", uploaded_by: U.owner, department_id: DEPT.hr, sha256: "abc", scan_status: "clean" });
    expect(rows[0].storage_key).toBe(copied[0]![1]);
    const original = (await owner.query(`SELECT purpose, state FROM documents WHERE id = $1`, [D.toOwner])).rows[0];
    expect(original).toEqual({ purpose: "client_document", state: "submitted" });
    const history = await owner.query(`SELECT meta FROM activity_events WHERE entity_id = $1 AND event = 'evidence_submitted'`, [A.hr]);
    expect(history.rows.at(-1).meta).toEqual({ documentId: out.documentId, copiedFrom: D.toOwner });
  });

  it("refuses a file the person cannot open", async () => {
    await expect(attach(U.owner, D.sharedV2)).rejects.toThrow(/forbidden/);
    await expect(attach(U.owner, D.hrEvidence)).rejects.toThrow(/forbidden/);
    await expect(attach(U.hrMgr, D.finance)).rejects.toThrow(/not found/);
    expect(copied).toEqual([]);
  });

  it("refuses private files, files of another client and files not cleared by the scan", async () => {
    await expect(attach(U.hrMgr, D.clientPrivate)).rejects.toThrow(/shared with the firm/);
    await expect(attach(U.hrMgr, D.infected)).rejects.toThrow(/cleared/);
    // Firm staff record for a consultant-managed client, but only with that client's files.
    await expect(attach(U.admin, D.sharedV2, A.managed)).rejects.toThrow(/same client/);
    await expect(attach(U.admin, D.firmPrivate, A.managed)).rejects.toThrow(/same client/);
    expect(copied).toEqual([]);
  });

  it("is refused to someone who cannot submit evidence on the action", async () => {
    // The client admin and the firm don't work a full client's actions.
    await expect(attach(U.cadmin, D.sharedV2)).rejects.toThrow(/forbidden/);
    await expect(attach(U.cons, D.sharedV2)).rejects.toThrow(/forbidden/);
    await expect(attach(U.betaAdmin, D.beta, A.hr)).rejects.toThrow(/not found/);
  });
});
