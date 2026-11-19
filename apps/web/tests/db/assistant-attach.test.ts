// "@" in the assistant: attach a Selah file the asker can already see
// (lead-log, "Progress report change"; docs/assistant.md, "Attaching a file"),
// against a real Postgres. The screen's file id is never trusted:
//   - a visible file that is open to the assistant and indexed goes first in
//     what is sent to the model, is cited like any passage, and counts toward
//     the passage limit;
//   - a file the asker can't open (firm-only, another department, left out
//     with the audience picker, another client's, outside the chat's project)
//     behaves exactly as an id that doesn't exist: "gone", and the model gets
//     the same passages as with no attachment at all;
//   - a file that is visible but not available to the assistant (switch off,
//     a confidential request's answer, not indexed yet, scanned pages only)
//     sends nothing, even with stale passages left in the index;
//   - a progress draft never reads an attached file;
//   - with masking on, an attached passage goes masked like the rest;
//   - the picker lists only files the asker can open, by name in either spelling.
// Vectors and the model are faked; no AI is called.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { indexDocument, indexRecords, pagesFromText, type Embed } from "@/jobs/index-documents";
import { CLIENT_AI_VERSION } from "@/lib/client-ai";
import { loadPrincipal } from "@/services/principal";

const ONE = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
type Sent = { id: string; text: string; source: string };
const sent: { passages: Sent[]; question: string }[] = [];
let cite = (passages: Sent[]) => [passages[0]!.id];
vi.mock("@/services/ai-client", () => ({
  modelIsLocal: async () => true,
  embed: async (texts: string[]) => texts.map(() => ONE),
  answer: async (question: string, passages: Sent[]) => {
    sent.push({ passages, question });
    return { answer: "Here is what your sources say.", cited_ids: cite(passages), grounded: true };
  },
  translateText: async () => {
    throw new Error("not in tests");
  },
  summarizePages: async () => {
    throw new Error("not in tests");
  },
}));
vi.mock("@/services/storage", () => ({
  DOWNLOAD_TTL_SECONDS: 60,
  putObject: async () => undefined,
  copyObject: async () => undefined,
  getObject: async () => new Uint8Array(),
  signedDownloadUrl: async (key: string) => `https://storage.test/${key}`,
}));
const A = await import("@/services/assistant");
const C = await import("@/services/client-ai");
const D = await import("@/services/documents");

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-a77a-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const P1 = id(5);
const BETA_P = id(6);
const DEPT_FIN = id(31);
const DEPT_OPS = id(32);
const RQ = id(41);
const U = {
  admin: id(11),
  lead: id(12), // the lead consultant of both clients
  cons: id(14), // staffed on P1
  cadmin: id(16),
  fin: id(17), // a client manager in Finance only
  left: id(18), // a client manager left out of one file
  owner1: id(19), // an action owner: no assistant at all
  bAdmin: id(20),
};
const NAMES: Record<keyof typeof U, string> = {
  admin: "Firm Admin",
  lead: "Lina Lead",
  cons: "Karim Consultant",
  cadmin: "Client Admin",
  fin: "Faisal Finance",
  left: "Layla Leftout",
  owner1: "Owner One",
  bAdmin: "Beta Admin",
};
// Each file's text holds its own canary word, so what reaches the model can be traced.
const DOC = {
  open: { id: id(301), title: "Board charter review", text: "ATTACHCANARY open: the charter of Acme Holding was reviewed by Faisal Finance." },
  arabic: { id: id(302), title: "خطة الإدارة", text: "ATTACHCANARY arabic plan." },
  firmOnly: { id: id(303), title: "Pricing memo", text: "FIRMONLYCANARY the firm's pricing." },
  off: { id: id(304), title: "Switched off file", text: "OFFCANARY not for the assistant." },
  pending: { id: id(305), title: "Pending file", text: "PENDINGCANARY not indexed yet." },
  scanned: { id: id(306), title: "Scanned file", text: "SCANCANARY scanned only." },
  ops: { id: id(307), title: "Plant procedures", text: "OPSCANARY operations only." },
  narrow: { id: id(308), title: "Salary review", text: "NARROWCANARY left out of this one." },
  conf: { id: id(309), title: "Board minutes", text: "CONFCANARY confidential minutes." },
  beta: { id: id(310), title: "Beta strategy deck", text: "BETACANARY another client's file." },
};
// Plenty of other shared files, so the search alone would fill the passages.
const FILLER = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => id(400 + n));
const MISSING = id(999);

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
const svc = <T>(userId: string, fn: (tx: Tx, p: Principal) => Promise<T>) =>
  as(userId, async (c) => {
    const tx = drizzle(c, { schema }) as unknown as Tx;
    return fn(tx, (await loadPrincipal(tx, userId))!);
  });
const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
const embedAll = (async (texts: string[]) => texts.map(() => ONE)) as Embed;

async function doc(
  d: { id: string; title: string },
  o: { project?: string; org?: string; ownerOrg?: string; by?: string; visibility?: string; ai?: boolean; dept?: string | null } = {},
) {
  await q(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, department_id,
       ai_indexable, storage_key, content_type, size_bytes, sha256, scan_status)
     VALUES ($1,$2,$3,$4,$5,'deliverable','submitted',$6,$7,$8,$9,$10,'text/plain',1,$11,'clean')`,
    [d.id, o.project ?? P1, o.org ?? ACME, o.ownerOrg ?? FIRM, o.by ?? U.cons, d.title, o.visibility ?? "shared", o.dept ?? null, o.ai ?? true, `key-${d.id}`, `sha-${d.id}`],
  );
}
/** A passage left in the index whatever the file's state (as a stale one would be). */
const plant = (docId: string, text: string) =>
  q(
    `INSERT INTO ai_chunks (project_id, org_id, source_type, source_id, source_version, visibility, chunk_index, page, lang, content, embedding)
     SELECT project_id, org_id, 'document', id, version, visibility, 0, 1, 'en', $2, $3 FROM documents WHERE id = $1`,
    [docId, text, `[${ONE.join(",")}]`],
  );

const ask = (uid: string, input: Partial<Parameters<typeof A.ask>[2]> & { question: string }, masked?: boolean) =>
  svc(uid, (tx, p) => A.ask(tx, p, { projectId: P1, language: "en", ...input }, masked));
const lastText = () => sent.at(-1)!.passages.map((x) => x.text).join("\n");

beforeAll(async () => {
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, name_ar, short_names, engagement_mode) VALUES
      ($1,'firm','Mizan Advisory',NULL,'{}',NULL), ($2,'client','Acme Holding','شركة أكمي','{Acme}','full'),
      ($3,'client','Beta Trading','شركة بيتا للتجارة','{Beta}','full')`,
    [FIRM, ACME, BETA],
  );
  await q(`UPDATE organizations SET departments_enabled = true WHERE id = $1`, [ACME]);
  for (const [k, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, NAMES[k as keyof typeof U], `${k}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$9,'firm_admin'), ($2,$9,'consultant'), ($3,$9,'consultant'),
      ($4,$10,'client_admin'), ($5,$10,'client_manager'), ($6,$10,'client_manager'), ($7,$10,'action_owner'), ($8,$11,'client_admin')`,
    [U.admin, U.lead, U.cons, U.cadmin, U.fin, U.left, U.owner1, U.bAdmin, FIRM, ACME, BETA],
  );
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$3,'المالية','Finance'), ($2,$3,'العمليات','Operations')`, [DEPT_FIN, DEPT_OPS, ACME]);
  await q(`INSERT INTO department_members (department_id, user_id) VALUES ($1,$2)`, [DEPT_FIN, U.fin]);
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$3,$5,'Acme governance','active',$6), ($2,'client',$4,$5,'Beta strategy','active',$6)`,
    [P1, BETA_P, ACME, BETA, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES ($1,$2,true,false), ($1,$3,false,false), ($4,$2,true,false)`, [
    ACME,
    U.lead,
    U.cons,
    BETA,
  ]);
  await q(`INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,false), ($1,$3,false), ($1,$4,false), ($1,$5,false)`, [
    P1,
    U.cons,
    U.fin,
    U.left,
    U.owner1,
  ]);

  // Open to the assistant and indexed.
  for (const d of [DOC.open, DOC.arabic, DOC.narrow]) await doc(d);
  await doc(DOC.firmOnly, { visibility: "firm_private" });
  await doc(DOC.ops, { dept: DEPT_OPS });
  await doc(DOC.beta, { project: BETA_P, org: BETA, by: U.lead });
  for (const d of [DOC.open, DOC.arabic, DOC.firmOnly, DOC.ops, DOC.narrow, DOC.beta]) await indexDocument(owner, d.id, pagesFromText(d.text), embedAll);
  for (const f of FILLER) {
    await doc({ id: f, title: `Filler ${f.slice(-2)}` });
    await indexDocument(owner, f, pagesFromText(`Filler passage ${f.slice(-2)} about governance.`), embedAll);
  }
  // Visible to the client, but not available to the assistant: stale passages are left in the index on purpose.
  await doc(DOC.off, { ai: false });
  await doc(DOC.pending);
  await doc(DOC.scanned);
  await plant(DOC.off.id, DOC.off.text);
  await plant(DOC.pending.id, DOC.pending.text);
  await plant(DOC.scanned.id, DOC.scanned.text);
  await q(`UPDATE documents SET text_status = 'needs_ocr', ocr_pages = '{1}' WHERE id = $1`, [DOC.scanned.id]);
  // A confidential request's answer: the database keeps it off for the assistant (migration 0106).
  await q(`INSERT INTO info_requests (id, project_id, org_id, area, title, sensitivity, created_by) VALUES ($1,$2,$3,'governance','Board minutes','confidential',$4)`, [
    RQ,
    P1,
    ACME,
    U.lead,
  ]);
  await doc(DOC.conf, { ownerOrg: ACME, by: U.cadmin, ai: false });
  await as(U.cadmin, (c) => c.query(`INSERT INTO info_request_files (request_id, document_id, attached_by) VALUES ($1,$2,$3)`, [RQ, DOC.conf.id, U.cadmin]));
  await plant(DOC.conf.id, DOC.conf.text);
  await indexRecords(owner, embedAll);

  // Layla is left out of the salary review (who sees an item).
  await svc(U.cons, (tx, p) => D.setDocumentAudience(tx, p, DOC.narrow.id, { mode: "except", people: [U.left] }));

  await svc(U.admin, (tx, p) => C.setClientAi(tx, p, ACME, { enabled: true, roles: ["client_admin", "client_manager"], dailyLimit: 200 }));
  await svc(U.cadmin, (tx, p) => C.consentClientAi(tx, p, { version: CLIENT_AI_VERSION, locale: "en" }));
});

beforeEach(async () => {
  sent.length = 0;
  cite = (passages) => [passages[0]!.id];
  await q(`DELETE FROM ai_usage`);
  await q(`DELETE FROM ai_conversations`);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("a visible file, open to the assistant and indexed", () => {
  it("goes first in what is sent, is cited like any passage, and keeps within the passage limit", async () => {
    for (const uid of [U.cons, U.cadmin, U.fin]) {
      sent.length = 0;
      const out = await ask(uid, { question: "What does this say about governance?", attachments: [DOC.open.id] });
      const ps = sent[0]!.passages;
      expect(ps[0]!.text, uid).toContain("ATTACHCANARY open");
      expect(ps[0]!.source).toContain("attached by the person");
      expect(ps.length).toBeLessThanOrEqual(12);
      expect(sent[0]!.question).toContain("(The person attached a file to the question: passage P1.)");
      expect(out.attachments).toEqual([{ id: DOC.open.id, status: "ok" }]);
      expect(out.citations[0]).toMatchObject({ sourceType: "document", sourceId: DOC.open.id, page: 1 });
    }
  });

  it("takes a searched passage's place, never a duplicate of itself", async () => {
    await ask(U.cons, { question: "Governance" });
    const plain = sent[0]!.passages;
    await ask(U.cons, { question: "Governance", attachments: [DOC.open.id, DOC.arabic.id] });
    const withFiles = sent[1]!.passages;
    expect(withFiles.length).toBeLessThanOrEqual(Math.max(plain.length, 2));
    expect(withFiles.slice(0, 2).map((x) => x.text).sort()).toEqual([DOC.arabic.text, DOC.open.text].sort());
    expect(withFiles.filter((x) => x.text === DOC.open.text)).toHaveLength(1);
  });

  it("with masking on, goes to the model masked like every other passage", async () => {
    await ask(U.cons, { question: "What does the charter review say?", attachments: [DOC.open.id] }, true);
    const first = sent[0]!.passages[0]!;
    expect(first.text).toContain("ATTACHCANARY open");
    expect(first.text).not.toContain("Acme");
    expect(first.text).not.toContain("Faisal");
    expect(first.text).toMatch(/\[ORG_\d+\]/);
    expect(first.text).toMatch(/\[PERSON_\d+\]/);
  });
});

describe("a file the asker can't see behaves as one that doesn't exist", () => {
  // The same question with no attachment, and with an id that exists nowhere: the yardstick.
  const baseline = async (uid: string, projectId: string | null = P1) => {
    await ask(uid, { question: "What is in the files?", projectId, attachments: [MISSING] }).then((o) => expect(o.attachments).toEqual([{ id: MISSING, status: "gone" }]));
    return sent.at(-1)!.passages.map((x) => x.text);
  };
  const cases: [string, string, { id: string; text: string }, string | null][] = [
    ["firm-only, asked by the client admin", U.cadmin, DOC.firmOnly, P1],
    ["another department, asked by a Finance manager", U.fin, DOC.ops, P1],
    ["left out with the audience picker", U.left, DOC.narrow, P1],
    ["another client's, asked by the client admin", U.cadmin, DOC.beta, P1],
    ["another client's, across all the client admin's projects", U.cadmin, DOC.beta, null],
    ["another project than the chat's, asked by their lead", U.lead, DOC.beta, P1],
  ];
  for (const [name, uid, d, projectId] of cases) {
    it(name, async () => {
      const yardstick = await baseline(uid, projectId);
      const out = await ask(uid, { question: "What is in the files?", projectId, attachments: [d.id] });
      expect(out.attachments).toEqual([{ id: d.id, status: "gone" }]);
      expect(sent.at(-1)!.passages.map((x) => x.text).sort()).toEqual([...yardstick].sort());
      expect(lastText()).not.toContain(d.text.split(" ")[0]);
      expect(sent.at(-1)!.question).not.toContain("attached");
    });
  }

  it("while the people who may see it get it (the allow side)", async () => {
    expect((await ask(U.cadmin, { question: "Salary", attachments: [DOC.narrow.id] })).attachments[0]!.status).toBe("ok");
    expect(lastText()).toContain("NARROWCANARY");
    expect((await ask(U.cadmin, { question: "Plant", attachments: [DOC.ops.id] })).attachments[0]!.status).toBe("ok");
    expect((await ask(U.lead, { question: "Beta", projectId: null, attachments: [DOC.beta.id] })).attachments[0]!.status).toBe("ok");
    expect(lastText()).toContain("BETACANARY");
  });

  it("an action owner gets no assistant, attachment or not; another client is refused as before", async () => {
    await expect(ask(U.owner1, { question: "What is in it?", attachments: [DOC.open.id] })).rejects.toThrow();
    await expect(ask(U.bAdmin, { question: "What is in it?", attachments: [DOC.open.id] })).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });
});

describe("a visible file the assistant may not read sends nothing, whatever the index holds", () => {
  const cases: [string, { id: string; text: string }, string][] = [
    ["its assistant switch is off", DOC.off, "not_available"],
    ["it answers a confidential request", DOC.conf, "not_available"],
    ["it is not indexed yet", DOC.pending, "not_indexed"],
    ["it has scanned pages only", DOC.scanned, "scanned"],
  ];
  for (const [name, d, status] of cases) {
    it(name, async () => {
      for (const uid of [U.cons, U.cadmin]) {
        const out = await ask(uid, { question: "What does it say?", attachments: [d.id] });
        expect(out.attachments, uid).toEqual([{ id: d.id, status }]);
        expect(lastText()).not.toContain(d.text.split(" ")[0]);
      }
    });
  }

  it("one usable file among them still goes first, alone", async () => {
    const out = await ask(U.cadmin, { question: "Compare them", attachments: [DOC.off.id, DOC.open.id, DOC.firmOnly.id] });
    expect(out.attachments).toEqual([
      { id: DOC.off.id, status: "not_available" },
      { id: DOC.open.id, status: "ok" },
      { id: DOC.firmOnly.id, status: "gone" },
    ]);
    expect(sent[0]!.passages[0]!.text).toContain("ATTACHCANARY open");
    // The client admin may read the department's and the narrowed files through the search; never these.
    for (const c of ["OFFCANARY", "CONFCANARY", "PENDINGCANARY", "SCANCANARY", "FIRMONLYCANARY", "BETACANARY"]) expect(lastText()).not.toContain(c);
    expect(sent[0]!.passages.filter((x) => x.source.includes("attached by the person"))).toHaveLength(1);
  });
});

describe("a progress draft never reads an attached file", () => {
  it("for a client person and for firm staff", async () => {
    await q(
      `INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES ($1,$2,$3,'Approve the charter','shared',$4) ON CONFLICT DO NOTHING`,
      [id(501), P1, ACME, U.cons],
    );
    await q(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, status, due_date, created_by)
       VALUES ($1,$2,$3,$4,'Write the charter','in_progress',app_firm_today() + 10,$5) ON CONFLICT DO NOTHING`,
      [id(502), P1, ACME, id(501), U.cons],
    );
    for (const uid of [U.cadmin, U.cons]) {
      sent.length = 0;
      const out = await ask(uid, { question: "Draft my progress update", attachments: [DOC.open.id] });
      expect(out.attachments, uid).toEqual([{ id: DOC.open.id, status: "draft" }]);
      expect(sent[0]!.passages.some((x) => x.source.includes("attached by the person")), uid).toBe(false);
      expect(sent[0]!.question).not.toContain("attached");
    }
    // Firm staff's draft reads the progress records only (migration 0110): no file at all.
    expect(lastText()).not.toContain("ATTACHCANARY");
  });
});

describe("the picker", () => {
  const pick = (uid: string, query: string, projectId: string | null = P1) =>
    svc(uid, (tx, p) => A.attachableFiles(tx, p, { projectId, query, locale: "en" }));

  it("lists only the files the asker can open, each with what the assistant can do with it", async () => {
    const titles = async (uid: string) => (await svc(uid, (tx, p) => A.attachableFiles(tx, p, { projectId: P1, query: "", locale: "en" }))).map((f) => f.title);
    // At most 8 a search: narrow with a word the canaries share.
    const fin = await pick(U.fin, "e");
    expect(fin.map((f) => f.id)).not.toContain(DOC.ops.id);
    expect(fin.map((f) => f.id)).not.toContain(DOC.firmOnly.id);
    expect(fin.map((f) => f.id)).not.toContain(DOC.beta.id);
    expect(await pick(U.left, "Salary")).toEqual([]);
    expect((await pick(U.cadmin, "Salary")).map((f) => f.id)).toEqual([DOC.narrow.id]);
    expect(await pick(U.cadmin, "Pricing")).toEqual([]);
    expect((await pick(U.cons, "Pricing")).map((f) => f.id)).toEqual([DOC.firmOnly.id]);
    expect((await pick(U.cadmin, "switched off"))[0]).toMatchObject({ id: DOC.off.id, status: "not_available" });
    expect((await pick(U.cadmin, "pending"))[0]).toMatchObject({ id: DOC.pending.id, status: "not_indexed" });
    expect((await pick(U.cadmin, "scanned"))[0]).toMatchObject({ id: DOC.scanned.id, status: "scanned" });
    expect((await pick(U.cadmin, "board minutes"))[0]).toMatchObject({ id: DOC.conf.id, status: "not_available" });
    expect((await pick(U.cadmin, "BOARD CHARTER"))[0]).toMatchObject({ id: DOC.open.id, status: "ok" });
    expect((await titles(U.cadmin)).length).toBeLessThanOrEqual(8);
  });

  it("finds a name in either spelling (the person picker's folding)", async () => {
    expect((await pick(U.cadmin, "خطه الاداره")).map((f) => f.id)).toEqual([DOC.arabic.id]);
    expect((await pick(U.cadmin, "خِطَّة")).map((f) => f.id)).toEqual([DOC.arabic.id]);
  });

  it("across projects names where each file is; a project the asker can't ask about is not found", async () => {
    const all = await pick(U.lead, "Beta strategy deck", null);
    expect(all).toEqual([{ id: DOC.beta.id, title: DOC.beta.title, place: "Beta Trading · Beta strategy", status: "ok" }]);
    expect(await pick(U.lead, "Beta strategy deck", P1)).toEqual([]);
    await expect(pick(U.bAdmin, "", P1)).rejects.toThrow(/not found/i);
    await expect(pick(U.owner1, "", P1)).rejects.toThrow(/not found/i);
    expect(await pick(U.owner1, "", null).catch(() => [])).toEqual([]);
  });
});
