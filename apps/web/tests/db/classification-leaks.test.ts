// Classification leaks (phase 3 assessment, area 2: docs/review/work/phase3-classification.md).
// The assessor's proofs, turned round: each path that carried a labelled item,
// or a number built from one, to someone it should not reach is now closed.
//   L1 + S1  the leaving-person report and the hand-over respect a recommendation's label
//   L2 + L3  withdrawing a file writes no name or reason where the other side reads it
//   L4       frozen report numbers count only what the client may see
//   L5       the stored monthly history is the firm's
//   C1       a file answering a confidential request stays out of the assistant across versions
//   C3       only the uploader or the owning side's admin renames or refiles a file
// and the independent review of the fix (docs/review/work/leak-fixes-review.md):
//   B1       a version never leaves its chain
//   S1       old withdrawal audit rows lose the name when read; old assistant-read versions are switched off
//   S2       the report PDF lists only what the client may see
//   S3       the firm is told when a client admin switches off the owner of work the admin cannot see
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { indexDocument, pagesFromText, type Embed } from "@/jobs/index-documents";
import { setAssistantFlag, withdrawDocument } from "@/services/documents";
import { reportPdf } from "@/services/exports";
import { getReport, projectMetrics, projectProgress, shareReport, snapshotReport } from "@/services/follow-through";
import { loadPrincipal } from "@/services/principal";
import { issueStatusPack } from "@/services/status-pack";
import { truncateAuditLog } from "./audit-reset";

// The report PDF: keep the HTML the renderer would get (review S2).
const rendered: string[] = [];
vi.mock("@/services/pdf", () => ({
  renderPdf: async (html: string) => {
    rendered.push(html);
    return new Uint8Array([1]);
  },
}));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = { ar: (await import("../../messages/ar.json")).default, en: (await import("../../messages/en.json")).default };
  return {
    getTranslations: async ({ locale, namespace }: { locale: "ar" | "en"; namespace?: string }) =>
      createTranslator({ locale, messages: messages[locale], namespace: namespace as never }),
  };
});
const embed: Embed = async (texts) => texts.map(() => Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)));

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");
const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 3 });

const id = (n: number) => `00000000-0000-4000-c1a6-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const P = id(5);
const DEPT = { fin: id(7), board: id(8) };
const U = { admin: id(11), lead: id(12), cadmin: id(15), mgr: id(16), owner: id(18), owner2: id(19) };
const REC = { shared: id(31), firm: id(32) };
const A = { shared: id(51), board: id(52), firm: id(53) };
const D = { clientPriv: id(61), firmPriv: id(62), answer: id(63), answerV2: id(64), cadminDoc: id(65), mgrDoc: id(66), answerV3: id(67) };
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
const refused = (p: Promise<unknown>) =>
  p.then(
    () => "",
    (e: Error & { cause?: Error }) => e.cause?.message ?? e.message,
  );
async function doc(docId: string, f: { by: string; ownerOrg: string; title: string; visibility: string; purpose?: string; ai?: boolean }) {
  await owner.query(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility,
       storage_key, content_type, size_bytes, sha256, scan_status, ai_indexable)
     VALUES ($1,$2,$3,$4,$5,$6,'submitted',$7,$8,$9,'application/pdf',10,'abc','clean',$10)`,
    [docId, P, ACME, f.ownerOrg, f.by, f.purpose ?? "deliverable", f.title, f.visibility, `k-${docId}`, f.ai ?? false],
  );
}
const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await truncateAuditLog(owner);
  await q(`INSERT INTO organizations (id, kind, name, departments_enabled) VALUES ($1,'firm','firm',false), ($2,'client','Acme',true)`, [FIRM, ACME]);
  await q(`INSERT INTO firm_settings (org_id) VALUES ($1)`, [FIRM]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$7,'firm_admin'), ($2,$7,'consultant'), ($3,$8,'client_admin'), ($4,$8,'client_manager'), ($5,$8,'action_owner'), ($6,$8,'action_owner')`,
    [U.admin, U.lead, U.cadmin, U.mgr, U.owner, U.owner2, FIRM, ACME],
  );
  await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Acme governance','active',$4)`, [P, ACME, FIRM, U.admin]);
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true)`, [ACME, U.lead]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4)`, [P, U.mgr, U.owner, U.owner2]);
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$3,'المالية','Finance'), ($2,$3,'أمانة المجلس','Board')`, [DEPT.fin, DEPT.board, ACME]);
  await q(`INSERT INTO department_members (department_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4)`, [DEPT.fin, U.mgr, U.owner, U.owner2]);
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
  // The lead adds a draft under the firm-only recommendation, names a client owner and releases it.
  await rowsAs(
    U.lead,
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by)
     VALUES ($1,$2,$3,$4,'Firm-only canary',$5,'draft',app_firm_today() - 3,$6)`,
    [A.firm, P, ACME, REC.firm, U.owner, U.lead],
    true,
  );
  await rowsAs(U.lead, `UPDATE actions SET status = 'assigned' WHERE id = $1`, [A.firm], true);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("L1 + S1: the leaving-person report and the hand-over keep to what the client admin may see", () => {
  it("the client cannot read the released firm-only action (the table's rule)", async () => {
    expect((await owner.query(`SELECT status FROM actions WHERE id = $1`, [A.firm])).rows[0].status).toBe("assigned");
    expect(await rowsAs(U.cadmin, `SELECT id FROM actions WHERE id = $1`, [A.firm])).toEqual([]);
  });

  it("the client admin's report lists the shared action and not the firm-only one; the firm admin's lists both", async () => {
    const client = await rowsAs(U.cadmin, `SELECT kind, title FROM app_person_holdings($1)`, [U.owner]);
    expect(client.map((r) => r.title)).toContain("Shared canary");
    expect(client.map((r) => r.title)).not.toContain("Firm-only canary");
    const firm = await rowsAs(U.admin, `SELECT kind, title FROM app_person_holdings($1)`, [U.owner]);
    expect(firm.map((r) => r.title)).toEqual(expect.arrayContaining(["Shared canary", "Firm-only canary"]));
  });

  it("the client admin's hand-over moves only the action they may see; the firm-only one stays for the firm to settle", async () => {
    const moved = await rowsAs(U.cadmin, `SELECT app_hand_over($1, $2, ARRAY['action']) AS n`, [U.owner, U.owner2], true);
    expect(moved[0].n).toBe(1);
    const rows = (await owner.query(`SELECT id, owner_user_id FROM actions WHERE id = ANY ($1)`, [[A.shared, A.firm]])).rows;
    const by = Object.fromEntries(rows.map((r) => [r.id, r.owner_user_id]));
    expect(by[A.shared]).toBe(U.owner2);
    expect(by[A.firm]).toBe(U.owner);
  });

  it("a firm-only action does not stop the client admin switching the person off; for the firm admin it still blocks", async () => {
    // The shared action was handed over above; the firm-only one is all the person still holds.
    const client = await refused(
      as(U.cadmin, async (c) => {
        await c.query(`SELECT app_hand_over($1, $2, ARRAY['action'])`, [U.owner, U.owner2]);
        await c.query(`UPDATE org_memberships SET active = false, deactivation_reason = 'left' WHERE user_id = $1`, [U.owner]);
      }),
    );
    expect(client).toBe("");
    const firm = await rowsAs(U.admin, `SELECT title, blocking FROM app_person_holdings($1) WHERE entity_id = $2`, [U.owner, A.firm]);
    expect(firm).toEqual([{ title: "Firm-only canary", blocking: true }]);
  });
});

describe("L4: numbers frozen on a shared report count only what the client may see", () => {
  it("a periodic report agrees with the client's own live numbers", async () => {
    const live = await svc(U.cadmin, (tx, p) => projectProgress(tx, p, P));
    expect(live.total).toBe(2);
    const { id: rid } = await svc(U.lead, (tx, p) => snapshotReport(tx, p, P, { title: "Monthly", periodStart: "2026-11-01", periodEnd: today() }), true);
    await svc(U.lead, (tx, p) => shareReport(tx, p, rid), true);
    const seen = await svc(U.cadmin, (tx, p) => getReport(tx, p, rid));
    const m = seen.report.metrics as { total: number; open: number; overdue: number };
    expect({ total: m.total, open: m.open, overdue: m.overdue }).toEqual({ total: live.total, open: live.open, overdue: live.overdue });
    // The firm's own live view still counts its firm-only work.
    expect((await svc(U.lead, (tx, p) => projectProgress(tx, p, P))).total).toBe(3);
  });

  it("an issued status pack freezes the client's numbers too", async () => {
    const rid = (
      await owner.query(
        `INSERT INTO reports (project_id, org_id, kind, title, body_md, generated_by, period_start, period_end)
         VALUES ($1,$2,'status_pack','Pack','',$3,'2026-11-01',app_firm_today()) RETURNING id`,
        [P, ACME, U.lead],
      )
    ).rows[0].id as string;
    await svc(U.lead, (tx, p) => issueStatusPack(tx, p, rid, { bodyMd: "" }), true);
    const m = (await owner.query(`SELECT metrics FROM reports WHERE id = $1`, [rid])).rows[0].metrics;
    expect([m.total, m.overdue]).toEqual([2, 1]);
  });
});

describe("L5: the stored monthly history is the firm's", () => {
  it("a client reader gets no stored history, neither from the service nor from the table; the firm keeps it", async () => {
    await owner.query(`SELECT app_snapshot_metrics(app_firm_today())`);
    const mgr = await svc(U.mgr, (tx, p) => projectMetrics(tx, p, P));
    expect(Number(mgr.live.actions_total)).toBe(1);
    expect(mgr.history).toEqual([]);
    expect((await svc(U.cadmin, (tx, p) => projectMetrics(tx, p, P))).history).toEqual([]);
    expect(await rowsAs(U.mgr, `SELECT metric FROM metric_snapshots WHERE project_id = $1`, [P])).toEqual([]);
    expect(await rowsAs(U.cadmin, `SELECT metric FROM metric_snapshots WHERE project_id = $1`, [P])).toEqual([]);
    const firm = await svc(U.lead, (tx, p) => projectMetrics(tx, p, P));
    const hist = Object.fromEntries(firm.history.map((h) => [h.metric, Number(h.value)]));
    expect(hist.actions_total).toBe(3);
  });
});

describe("L2 + L3: withdrawing a file writes no private name or reason where the other side reads it", () => {
  beforeAll(async () => {
    await doc(D.clientPriv, { by: U.cadmin, ownerOrg: ACME, title: "Salary scale 2027 (client private).pdf", visibility: "client_private", purpose: "client_document" });
    await doc(D.firmPriv, { by: U.lead, ownerOrg: FIRM, title: "Lead's private notes on the CFO.pdf", visibility: "firm_private" });
  });

  it("the audit row keeps the file's id, not its name", async () => {
    await svc(U.cadmin, (tx, p) => withdrawDocument(tx, p, D.clientPriv, "wrong file"), true);
    const rows = await rowsAs(U.admin, `SELECT action, resource_id, meta FROM app_audit_entries(NULL, NULL, NULL, NULL, NULL, NULL, 100, 0)`);
    const hit = rows.find((r) => r.action === "document.withdraw" && r.resource_id === D.clientPriv);
    expect(hit).toBeDefined();
    expect(JSON.stringify(hit?.meta ?? {})).not.toContain("Salary");
  });

  it("the activity event takes the file's label and carries no name or reason", async () => {
    const stored = (await owner.query(`SELECT visibility, meta FROM activity_events WHERE entity_id = $1 AND event = 'document_withdrawn'`, [D.clientPriv])).rows;
    expect(stored).toEqual([{ visibility: "client_private", meta: {} }]);
    expect(await rowsAs(U.lead, `SELECT id FROM activity_events WHERE entity_id = $1`, [D.clientPriv])).toEqual([]);
    expect(await rowsAs(U.cadmin, `SELECT event FROM activity_events WHERE entity_id = $1`, [D.clientPriv])).toEqual([{ event: "document_withdrawn" }]);

    await svc(U.lead, (tx, p) => withdrawDocument(tx, p, D.firmPriv, "wrong file"), true);
    expect(await rowsAs(U.cadmin, `SELECT id FROM activity_events WHERE entity_id = $1`, [D.firmPriv])).toEqual([]);
    const firm = await rowsAs(U.lead, `SELECT visibility, meta FROM activity_events WHERE entity_id = $1`, [D.firmPriv]);
    expect(firm).toEqual([{ visibility: "firm_private", meta: {} }]);
  });

  it("an event written the old way (shared, with the name) is hidden from the side that cannot open the file", async () => {
    // Events are append-only and are not rewritten; the read rule hides the old ones.
    await owner.query(
      `INSERT INTO activity_events (project_id, org_id, actor_id, entity_type, entity_id, event, meta)
       VALUES ($1,$2,$3,'document',$4,'document_withdrawn','{"title":"Lead''s private notes on the CFO.pdf","reason":"wrong file"}')`,
      [P, ACME, U.lead, D.firmPriv],
    );
    expect(await rowsAs(U.cadmin, `SELECT meta FROM activity_events WHERE entity_id = $1`, [D.firmPriv])).toEqual([]);
    expect((await rowsAs(U.lead, `SELECT meta FROM activity_events WHERE entity_id = $1`, [D.firmPriv])).length).toBe(2);
  });
});

describe("C1: a file answering a confidential request stays out of the assistant across its versions", () => {
  beforeAll(async () => {
    await owner.query(
      `INSERT INTO info_requests (id, project_id, org_id, area, title, sensitivity, created_by) VALUES ($1,$2,$3,'governance','Board minutes, last two years','confidential',$4)`,
      [RQ, P, ACME, U.lead],
    );
    await doc(D.answer, { by: U.cadmin, ownerOrg: ACME, title: "board minutes.pdf", visibility: "shared", purpose: "client_document" });
    await rowsAs(U.cadmin, `INSERT INTO info_request_files (request_id, document_id, attached_by) VALUES ($1,$2,$3)`, [RQ, D.answer, U.cadmin], true);
  });
  const version = (docId: string, n: number, supersedes: string, ai = false) =>
    rowsAs(
      U.cadmin,
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, version, supersedes_id,
         storage_key, content_type, size_bytes, sha256, scan_status, ai_indexable)
       VALUES ($1,$2,$3,$3,$4,'client_document','submitted',$5,'shared',$6,$7,$8,'application/pdf',1,'s2','clean',$9)`,
      [docId, P, ACME, U.cadmin, `board minutes v${n}.pdf`, n, supersedes, `k-${docId}`, ai],
      true,
    );

  it("the first version is refused, and so are its later versions", async () => {
    await expect(svc(U.cadmin, (tx, p) => setAssistantFlag(tx, p, D.answer, true), true)).rejects.toThrow(/confidential/);
    await version(D.answerV2, 2, D.answer);
    await expect(svc(U.cadmin, (tx, p) => setAssistantFlag(tx, p, D.answerV2, true), true)).rejects.toThrow(/confidential/);
    await version(D.answerV3, 3, D.answerV2);
    expect(await refused(rowsAs(U.cadmin, `UPDATE documents SET ai_indexable = true WHERE id = $1`, [D.answerV3]))).toMatch(/confidential/);
    expect((await owner.query(`SELECT bool_or(ai_indexable) AS on FROM documents WHERE id = ANY ($1)`, [[D.answer, D.answerV2, D.answerV3]])).rows[0].on).toBe(false);
  });

  it("a new version cannot arrive with the assistant already on", async () => {
    expect(await refused(version(id(68), 4, D.answerV3, true))).toMatch(/confidential/);
  });

  it("a request is not marked confidential while a later version of its file is with the assistant", async () => {
    const rq2 = id(72);
    const [d1, d2] = [id(81), id(82)];
    await owner.query(`INSERT INTO info_requests (id, project_id, org_id, area, title, sensitivity, created_by) VALUES ($1,$2,$3,'governance','Org structure','standard',$4)`, [rq2, P, ACME, U.lead]);
    await doc(d1, { by: U.cadmin, ownerOrg: ACME, title: "org.pdf", visibility: "shared", purpose: "client_document" });
    await rowsAs(U.cadmin, `INSERT INTO info_request_files (request_id, document_id, attached_by) VALUES ($1,$2,$3)`, [rq2, d1, U.cadmin], true);
    await version(d2, 2, d1, true);
    expect(await refused(rowsAs(U.lead, `UPDATE info_requests SET sensitivity = 'confidential' WHERE id = $1`, [rq2]))).toMatch(/assistant off/);
  });
});

describe("C3: only the uploader or the owning side's admin renames or refiles a file", () => {
  beforeAll(async () => {
    await doc(D.cadminDoc, { by: U.cadmin, ownerOrg: ACME, title: "HR grade structure.pdf", visibility: "shared", purpose: "client_document" });
    await doc(D.mgrDoc, { by: U.mgr, ownerOrg: ACME, title: "Finance plan.pdf", visibility: "shared", purpose: "client_document" });
  });

  it("a client manager cannot rename or refile a file the client admin uploaded", async () => {
    expect(await refused(rowsAs(U.mgr, `UPDATE documents SET title = 'renamed by the manager' WHERE id = $1`, [D.cadminDoc]))).toMatch(/uploaded/);
    expect(await refused(rowsAs(U.mgr, `UPDATE documents SET department_id = $2 WHERE id = $1`, [D.cadminDoc, DEPT.fin]))).toMatch(/uploaded/);
  });

  it("the uploader and the client admin can; the firm cannot touch a client file", async () => {
    expect(await rowsAs(U.mgr, `UPDATE documents SET title = 'Finance plan v1.pdf' WHERE id = $1 RETURNING title`, [D.mgrDoc])).toEqual([{ title: "Finance plan v1.pdf" }]);
    expect(await rowsAs(U.cadmin, `UPDATE documents SET department_id = $2 WHERE id = $1 RETURNING department_id`, [D.mgrDoc, DEPT.fin])).toEqual([{ department_id: DEPT.fin }]);
    expect(await refused(rowsAs(U.lead, `UPDATE documents SET title = 'x' WHERE id = $1`, [D.cadminDoc]))).toMatch(/uploaded/);
  });

  it("other changes by a reader are not affected (the assistant flag keeps its own rule)", async () => {
    // Unchanged rule (question C2 for gate B): a manager may still switch the flag on.
    const r = await svc(U.mgr, (tx, p) => setAssistantFlag(tx, p, D.cadminDoc, true));
    expect(r.aiIndexable).toBe(true);
  });
});

describe("review B1: a version never leaves its chain", () => {
  it("nobody unlinks a version, so a confidential answer's version stays off for the assistant", async () => {
    for (const who of [U.cadmin, U.lead]) {
      expect(await refused(rowsAs(who, `UPDATE documents SET supersedes_id = NULL WHERE id = $1`, [D.answerV2]))).toMatch(/versions never changes/);
    }
    expect(await refused(rowsAs(U.cadmin, `UPDATE documents SET supersedes_id = $2 WHERE id = $1`, [D.answerV3, D.answer]))).toMatch(/versions never changes/);
    expect(await refused(owner.query(`UPDATE documents SET supersedes_id = NULL WHERE id = $1`, [D.answerV2]))).toMatch(/versions never changes/);
    expect(await refused(rowsAs(U.cadmin, `UPDATE documents SET ai_indexable = true WHERE id = $1`, [D.answerV2]))).toMatch(/confidential/);
  });
});

describe("review S1: what was written before the fix", () => {
  it("a withdrawal audit row written with the file's name is read without it", async () => {
    await owner.query(
      `INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
       VALUES ($1,$2,'document.withdraw','document',$3,'allow','{"title":"Salary scale 2027 (client private).pdf"}')`,
      [U.cadmin, ACME, D.clientPriv],
    );
    for (const who of [U.admin, U.cadmin]) {
      const rows = await rowsAs(who, `SELECT action, meta FROM app_audit_entries(NULL, NULL, NULL, NULL, NULL, NULL, 1000, 0)`);
      const hits = rows.filter((r) => r.action === "document.withdraw");
      expect(hits.length).toBeGreaterThan(0);
      expect(JSON.stringify(hits)).not.toContain("Salary");
    }
    // The stored row is unchanged (append-only).
    expect((await owner.query(`SELECT count(*)::int AS n FROM audit_log WHERE meta->>'title' LIKE 'Salary%'`)).rows[0].n).toBe(1);
  });

  it("a version of a confidential answer already with the assistant is switched off and its passages go", async () => {
    const rq = id(73);
    const [v1, v2] = [id(83), id(84)];
    await owner.query(
      `INSERT INTO info_requests (id, project_id, org_id, area, title, sensitivity, created_by) VALUES ($1,$2,$3,'governance','Family charter','standard',$4)`,
      [rq, P, ACME, U.lead],
    );
    await doc(v1, { by: U.cadmin, ownerOrg: ACME, title: "charter.pdf", visibility: "shared", purpose: "client_document" });
    await rowsAs(U.cadmin, `INSERT INTO info_request_files (request_id, document_id, attached_by) VALUES ($1,$2,$3)`, [rq, v1, U.cadmin], true);
    await rowsAs(
      U.cadmin,
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, version, supersedes_id,
         storage_key, content_type, size_bytes, sha256, scan_status, ai_indexable)
       VALUES ($1,$2,$3,$3,$4,'client_document','submitted','charter v2.pdf','shared',2,$5,$6,'application/pdf',1,'s3','clean',true)`,
      [v2, P, ACME, U.cadmin, v1, `k-${v2}`],
      true,
    );
    expect(await indexDocument(owner, v2, pagesFromText("The family agreed the succession plan."), embed)).toBe(1);
    // The state before this fix: the request became confidential with v2 already read (the new check is set aside to build it).
    await owner.query(`ALTER TABLE info_requests DISABLE TRIGGER info_request_versions`);
    try {
      await owner.query(`UPDATE info_requests SET sensitivity = 'confidential' WHERE id = $1`, [rq]);
    } finally {
      await owner.query(`ALTER TABLE info_requests ENABLE TRIGGER info_request_versions`);
    }
    expect((await owner.query(`SELECT app_retire_confidential_versions() AS n`)).rows[0].n).toBe(1);
    expect((await owner.query(`SELECT ai_indexable FROM documents WHERE id = $1`, [v2])).rows[0].ai_indexable).toBe(false);
    expect((await owner.query(`SELECT count(*)::int AS n FROM ai_chunks WHERE source_id = $1`, [v2])).rows[0].n).toBe(0);
    expect(await refused(rowsAs(U.cadmin, `SELECT app_retire_confidential_versions()`))).toMatch(/permission denied/);
  });
});

describe("review S2: the report PDF is the client's copy", () => {
  it("lists no firm-only action, for the firm reader and for the client", async () => {
    const { id: rid } = await svc(U.lead, (tx, p) => snapshotReport(tx, p, P, { title: "For the PDF", periodStart: "2026-11-01", periodEnd: today() }), true);
    await svc(U.lead, (tx, p) => shareReport(tx, p, rid), true);
    for (const who of [U.lead, U.cadmin]) {
      rendered.length = 0;
      await svc(who, (tx, p) => reportPdf(tx, p, rid, "en"));
      expect(rendered).toHaveLength(1);
      expect(rendered[0]).toContain("Board canary");
      expect(rendered[0]).not.toContain("Firm-only canary");
    }
  });
});

describe("review S3: the firm is told about work left with someone who has gone", () => {
  it("switching off the owner of a firm-only action tells the project's lead consultant and the firm admin", async () => {
    // The shared action was handed over earlier; the firm-only one is still the person's.
    await rowsAs(U.cadmin, `UPDATE org_memberships SET active = false, deactivation_reason = 'left' WHERE user_id = $1`, [U.owner], true);
    const told = (
      await owner.query(`SELECT user_id FROM notifications WHERE kind = 'action.owner_left' AND entity_id = $1 ORDER BY user_id`, [A.firm])
    ).rows.map((r) => r.user_id);
    expect(told).toEqual([U.admin, U.lead].sort());
    // Nothing about the actions the client admin could see, and nothing for the client.
    expect((await owner.query(`SELECT count(*)::int AS n FROM notifications WHERE kind = 'action.owner_left' AND entity_id <> $1`, [A.firm])).rows[0].n).toBe(0);
    expect(await rowsAs(U.cadmin, `SELECT id FROM notifications WHERE kind = 'action.owner_left'`)).toEqual([]);
    // The firm admin settles it: hands it to an active colleague of the person.
    const moved = await rowsAs(U.admin, `SELECT app_hand_over($1, $2, ARRAY['action']) AS n`, [U.owner, U.owner2], true);
    expect(moved[0].n).toBe(1);
    expect((await owner.query(`SELECT owner_user_id FROM actions WHERE id = $1`, [A.firm])).rows[0].owner_user_id).toBe(U.owner2);
  });
});
