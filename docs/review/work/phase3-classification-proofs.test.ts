// PHASE 3 ASSESSMENT PROOFS (not for commit). Each `it` shows a path where a
// labelled item, or a number built from one, reaches someone it should not,
// or a rule that can be stepped around. Passing = the problem is real.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { indexDocument, pagesFromText, type Embed } from "@/jobs/index-documents";
import { setAssistantFlag, withdrawDocument } from "@/services/documents";
import { getReport, projectMetrics, projectProgress, shareReport, snapshotReport } from "@/services/follow-through";
import { loadPrincipal } from "@/services/principal";
import { getProject } from "@/services/queries";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");
const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 3 });

const id = (n: number) => `00000000-0000-4000-c1a5-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const P = id(5);
const DEPT = { fin: id(7), board: id(8) };
const U = { admin: id(11), lead: id(12), cadmin: id(15), mgr: id(16), owner: id(18) };
const REC = { shared: id(31), firm: id(32) };
const A = { shared: id(51), board: id(52), firm: id(53) };
const D = { clientPriv: id(61), firmPriv: id(62), answer: id(63), answerV2: id(64), cadminDoc: id(65) };
const RQ = id(71);

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
const rowsAs = async (userId: string, sql: string, params: unknown[] = [], commit = false) =>
  (await as(userId, (c) => c.query(sql, params), commit)).rows;
async function svc<R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>, commit = false): Promise<R> {
  return as(
    userId,
    async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      const p = await loadPrincipal(tx, userId);
      return fn(tx, p!).catch((e: Error & { cause?: Error }) => {
        throw new Error(e.cause ? `${e.message} | ${e.cause.message}` : e.message);
      });
    },
    commit,
  );
}
async function doc(docId: string, f: { by: string; ownerOrg: string; title: string; visibility: string; purpose?: string; ai?: boolean }) {
  await owner.query(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility,
       storage_key, content_type, size_bytes, sha256, scan_status, ai_indexable)
     VALUES ($1,$2,$3,$4,$5,$6,'submitted',$7,$8,$9,'application/pdf',10,'abc','clean',$10)`,
    [docId, P, ACME, f.ownerOrg, f.by, f.purpose ?? "deliverable", f.title, f.visibility, `k-${docId}`, f.ai ?? false],
  );
}
const embed: Embed = async (texts) => texts.map(() => Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)));

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await truncateAuditLog(owner);
  await q(`INSERT INTO organizations (id, kind, name, departments_enabled) VALUES ($1,'firm','firm',false), ($2,'client','Acme',true)`, [FIRM, ACME]);
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$6,'firm_admin'), ($2,$6,'consultant'), ($3,$7,'client_admin'), ($4,$7,'client_manager'), ($5,$7,'action_owner')`,
    [U.admin, U.lead, U.cadmin, U.mgr, U.owner, FIRM, ACME],
  );
  await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Acme governance','active',$4)`, [P, ACME, FIRM, U.admin]);
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [ACME, U.lead]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3)`, [P, U.mgr, U.owner]);
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$3,'المالية','Finance'), ($2,$3,'أمانة المجلس','Board')`, [DEPT.fin, DEPT.board, ACME]);
  await q(`INSERT INTO department_members (department_id, user_id) VALUES ($1,$2), ($1,$3)`, [DEPT.fin, U.mgr, U.owner]);
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES
      ($1,$3,$4,'Shared recommendation','shared',$5), ($2,$3,$4,'Merge the two divisions (firm only)','firm_private',$5)`,
    [REC.shared, REC.firm, P, ACME, U.lead],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, department_id, created_by) VALUES
      ($1,$3,$4,$5,'Shared canary',$6,'in_progress',app_firm_today() + 30,NULL,$7),
      ($2,$3,$4,$5,'Board canary',NULL,'in_progress',app_firm_today() - 10,$8,$7)`,
    [A.shared, A.board, P, ACME, REC.shared, U.owner, U.lead, DEPT.board],
  );
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("an action under a firm-only recommendation, owned by a client person, is reachable through the app's rules", () => {
  it("the lead adds a draft under the firm-only recommendation, names a client owner and releases it", async () => {
    await rowsAs(
      U.lead,
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
       VALUES ($1,$2,$3,$4,'Firm-only canary',$5,'draft',app_firm_today() - 3,$6)`,
      [A.firm, P, ACME, REC.firm, U.owner, U.lead],
      true,
    );
    await rowsAs(U.lead, `UPDATE actions SET status = 'assigned' WHERE id = $1`, [A.firm], true);
    const [a] = (await owner.query(`SELECT status FROM actions WHERE id = $1`, [A.firm])).rows;
    expect(a.status).toBe("assigned");
    // Clients cannot read it (the label holds on the table).
    expect(await rowsAs(U.cadmin, `SELECT id FROM actions WHERE id = $1`, [A.firm])).toEqual([]);
    expect(await rowsAs(U.owner, `SELECT id FROM actions WHERE id = $1`, [A.firm])).toEqual([]);
  });

  it("LEAK: the client admin reads its title in the leaving-person report (app_person_holdings)", async () => {
    const rows = await rowsAs(U.cadmin, `SELECT kind, title FROM app_person_holdings($1)`, [U.owner]);
    expect(rows.map((r) => r.title)).toContain("Firm-only canary");
  });
});

describe("numbers frozen by the firm reach the client with firm-only work counted", () => {
  it("LEAK: a shared periodic report counts the firm-only action, the client's own live numbers do not", async () => {
    const live = await svc(U.cadmin, (tx, p) => projectProgress(tx, p, P));
    const { id: rid } = await svc(
      U.lead,
      (tx, p) => snapshotReport(tx, p, P, { title: "Monthly", periodStart: "2026-11-01", periodEnd: new Date().toISOString().slice(0, 10) }),
      true,
    );
    await svc(U.lead, (tx, p) => shareReport(tx, p, rid), true);
    const seen = await svc(U.cadmin, (tx, p) => getReport(tx, p, rid));
    const m = seen.report.metrics as { total: number; open: number; overdue: number };
    console.log("client live", live.total, live.open, live.overdue, "| report the client reads", m.total, m.open, m.overdue);
    expect(live.total).toBe(2);
    expect(m.total).toBe(3);
    expect(m.overdue).toBe(live.overdue + 1);
  });

  it("LEAK: the monthly history on the Progress tab counts firm-only and other-department actions for a Finance manager", async () => {
    await owner.query(`SELECT app_snapshot_metrics(app_firm_today())`);
    const m = await svc(U.mgr, (tx, p) => projectMetrics(tx, p, P));
    const hist = Object.fromEntries(m.history.map((h) => [h.metric, Number(h.value)]));
    console.log("manager live actions_total", m.live.actions_total, "overdue", m.live.overdue, "| history", hist.actions_total, hist.overdue);
    expect(Number(m.live.actions_total)).toBe(1); // only the company-wide shared action
    expect(hist.actions_total).toBe(3); // + the Board action + the firm-only one
    expect(hist.overdue).toBe(2);
  });
});

describe("withdrawing a file writes its name where the other side reads it", () => {
  beforeAll(async () => {
    await doc(D.clientPriv, { by: U.cadmin, ownerOrg: ACME, title: "Salary scale 2027 (client private).pdf", visibility: "client_private", purpose: "client_document" });
    await doc(D.firmPriv, { by: U.lead, ownerOrg: FIRM, title: "Lead's private notes on the CFO.pdf", visibility: "firm_private" });
  });

  it("the firm admin cannot open the client-private file, and the client admin cannot open the firm-only one", async () => {
    expect(await rowsAs(U.admin, `SELECT id FROM documents WHERE id = $1`, [D.clientPriv])).toEqual([]);
    expect(await rowsAs(U.cadmin, `SELECT id FROM documents WHERE id = $1`, [D.firmPriv])).toEqual([]);
  });

  it("LEAK: the firm admin reads the client-private file's name in the audit log (as the Audit page prints meta)", async () => {
    await svc(U.cadmin, (tx, p) => withdrawDocument(tx, p, D.clientPriv, "wrong file"), true);
    const rows = await rowsAs(U.admin, `SELECT action, meta FROM app_audit_entries(NULL, NULL, NULL, NULL, NULL, NULL, 100, 0)`);
    const hit = rows.find((r) => r.action === "document.withdraw");
    expect(hit?.meta.title).toBe("Salary scale 2027 (client private).pdf");
  });

  it("LEAK: the firm reads it in the activity record too (stored 'shared'), and the client admin reads the firm-only file's name", async () => {
    const firmSees = await rowsAs(U.lead, `SELECT visibility, meta->>'title' AS title FROM activity_events WHERE entity_id = $1`, [D.clientPriv]);
    expect(firmSees).toEqual([{ visibility: "shared", title: "Salary scale 2027 (client private).pdf" }]);
    await svc(U.lead, (tx, p) => withdrawDocument(tx, p, D.firmPriv, "wrong file"), true);
    const clientSees = await rowsAs(U.cadmin, `SELECT meta->>'title' AS title, meta->>'reason' AS reason FROM activity_events WHERE entity_id = $1`, [D.firmPriv]);
    expect(clientSees).toEqual([{ title: "Lead's private notes on the CFO.pdf", reason: "wrong file" }]);
    // On screen the client admin's activity record lists the event (no name): the firm withdrew a file.
    const page = await svc(U.cadmin, (tx, p) => getProject(tx, p, P));
    expect(JSON.stringify(page)).toContain("document_withdrawn");
  });
});

describe("a file answering a confidential request reaches the assistant through a new version", () => {
  it("the old version is refused, the new version is switched on, indexed and read by the firm", async () => {
    await owner.query(
      `INSERT INTO info_requests (id, project_id, org_id, area, title, sensitivity, created_by) VALUES ($1,$2,$3,'governance','Board minutes, last two years','confidential',$4)`,
      [RQ, P, ACME, U.lead],
    );
    await doc(D.answer, { by: U.cadmin, ownerOrg: ACME, title: "board minutes.pdf", visibility: "shared", purpose: "client_document" });
    await rowsAs(U.cadmin, `INSERT INTO info_request_files (request_id, document_id, attached_by) VALUES ($1,$2,$3)`, [RQ, D.answer, U.cadmin], true);
    await expect(svc(U.cadmin, (tx, p) => setAssistantFlag(tx, p, D.answer, true), true)).rejects.toThrow(/confidential/);
    // The client admin uploads the next version (what uploadNewVersion writes), then switches it on.
    await rowsAs(
      U.cadmin,
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, version, supersedes_id,
         storage_key, content_type, size_bytes, sha256, scan_status, ai_indexable)
       VALUES ($1,$2,$3,$3,$4,'client_document','submitted','board minutes v2.pdf','shared',2,$5,'k-v2','application/pdf',1,'s2','clean',false)`,
      [D.answerV2, P, ACME, U.cadmin, D.answer],
      true,
    );
    await svc(U.cadmin, (tx, p) => setAssistantFlag(tx, p, D.answerV2, true), true);
    expect(await indexDocument(owner, D.answerV2, pagesFromText("Minutes: the board approved the merger of divisions."), embed)).toBe(1);
    const firm = await rowsAs(U.lead, `SELECT content FROM ai_chunks WHERE source_id = $1`, [D.answerV2]);
    expect(firm[0]?.content).toContain("approved the merger");
    // The request still lists only the first version: nothing ties v2 to the confidential item.
    expect((await owner.query(`SELECT count(*)::int AS n FROM info_request_files WHERE document_id = $1`, [D.answerV2])).rows[0].n).toBe(0);
  });
});

describe("who may switch a client file's assistant flag", () => {
  it("a client manager switches on the assistant for a file the client admin uploaded", async () => {
    await doc(D.cadminDoc, { by: U.cadmin, ownerOrg: ACME, title: "HR grade structure.pdf", visibility: "shared", purpose: "client_document" });
    const r = await svc(U.mgr, (tx, p) => setAssistantFlag(tx, p, D.cadminDoc, true), true);
    expect(r.aiIndexable).toBe(true);
  });
});

describe("the database backstop on documents", () => {
  it("a client manager renames and refiles a file the client admin uploaded (no screen does this; the row policy allows it)", async () => {
    const out = await rowsAs(
      U.mgr,
      `UPDATE documents SET title = 'renamed by the manager', department_id = $2 WHERE id = $1 RETURNING title, department_id`,
      [D.cadminDoc, DEPT.fin],
    );
    expect(out).toEqual([{ title: "renamed by the manager", department_id: DEPT.fin }]);
  });
});
