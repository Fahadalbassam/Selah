// Assistant chats (migration 0047) against a real Postgres: hybrid search,
// linked records, chats that close when their owner leaves the project,
// titles and cases, masking of names before the model, and retention.
// The model and the embeddings are faked; no AI is called.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { retrievalScope, type Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { indexDocument, pagesFromText, type Embed } from "@/jobs/index-documents";
import { loadPrincipal } from "@/services/principal";

// What the model was sent, and what it answers.
const sent: { question: string; passages: { id: string; text: string; source: string }[]; history: unknown[] }[] = [];
let reply: (passages: { id: string; text: string; source: string }[]) => { answer: string; cited_ids: string[]; grounded: boolean } = (p) => ({
  answer: "Answer.",
  cited_ids: p.slice(0, 1).map((x) => x.id),
  grounded: true,
});
const translated: string[] = [];
const ONE = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
vi.mock("@/services/ai-client", () => ({
  embed: async (texts: string[]) => texts.map(() => ONE),
  answer: async (question: string, passages: { id: string; text: string; source: string }[], _l: string, history: unknown[]) => {
    sent.push({ question, passages, history });
    return reply(passages);
  },
  translateText: async (text: string) => {
    translated.push(text);
    return { text: `EN: ${text}`, model: "fake" };
  },
  summarizePages: async () => {
    throw new Error("not in tests");
  },
}));
const A = await import("@/services/assistant");
const T = await import("@/services/translations");

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-f800-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const P1 = id(4);
const P2 = id(5);
const BETA_P = id(6);
const U = { admin: id(11), cons: id(12), other: id(13), cmgr: id(14) };
const DOC = { charter: id(101), zebra: id(102), beta: id(103), p2: id(104) };
const REC = id(201);
const ACT = id(202);
const BETA_REC = id(203);
const FINDING = id(204);

const embed: Embed = async (texts) => texts.map(() => ONE);

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
const sqlAs = (userId: string, text: string, params: unknown[] = []) => as(userId, (c) => c.query(text, params));
async function svc<R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>): Promise<R> {
  return as(userId, async (c) => {
    const tx = drizzle(c, { schema }) as unknown as Tx;
    const p = await loadPrincipal(tx, userId);
    return fn(tx, p!).catch((e: Error & { cause?: Error }) => {
      throw new Error(e.cause ? `${e.message} | ${e.cause.message}` : e.message);
    });
  });
}
const ask = (uid: string, input: Partial<Parameters<typeof A.ask>[2]> & { question: string }) =>
  svc(uid, (tx, p) => A.ask(tx, p, { projectId: P1, language: "en", ...input }));

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, name_ar) VALUES
       ($1,'firm','Mizan Advisory','ميزان للاستشارات'), ($2,'client','Al-Nukhba Holding','شركة النخبة القابضة'), ($3,'client','Rawdah Group',NULL)`,
    [FIRM, ACME, BETA],
  );
  const names: Record<string, string> = { admin: "Sara Admin", cons: "Reem Al-Harbi", other: "Omar Faris", cmgr: "خالد العتيبي" };
  for (const [k, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, names[k], `${k}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$5,'firm_admin'), ($2,$5,'consultant'), ($3,$5,'consultant'), ($4,$6,'client_manager')`,
    [U.admin, U.cons, U.other, U.cmgr, FIRM, ACME],
  );
  await q(`INSERT INTO departments (org_id, name_ar, name_en) VALUES ($1,'المالية','Finance')`, [ACME]);
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$4,$6,'Board governance','active',$7), ($2,'client',$4,$6,'HR policy','active',$7),
      ($3,'client',$5,$6,'Beta strategy','active',$7)`,
    [P1, P2, BETA_P, ACME, BETA, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id) VALUES ($1,$3), ($2,$4)`, [ACME, BETA, U.cons, U.other]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$3), ($1,$4), ($2,$5)`, [P1, BETA_P, U.cons, U.cmgr, U.other]);

  const docs: [string, string, string, string][] = [
    [DOC.charter, P1, ACME, "The board charter of Al-Nukhba Holding. Reem Al-Harbi (reem@nukhba.example, 0551234567) leads it in Riyadh."],
    [DOC.zebra, P1, ACME, "Procurement rules. Article zebrapolicy sets the approval limit for the Finance department."],
    [DOC.beta, BETA_P, BETA, "Rawdah Group board charter. Article zebrapolicy is secret to Beta."],
    [DOC.p2, P2, ACME, "HR handbook, zebrapolicy mentioned here too."],
  ];
  for (const [docId, project, org, text] of docs) {
    await q(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility,
         ai_indexable, storage_key, content_type, size_bytes, sha256, scan_status)
       VALUES ($1,$2,$3,$4,$5,'deliverable','submitted',$6,'shared',true,$7,'text/plain',1,$8,'clean')`,
      [docId, project, org, FIRM, U.admin, `title-${docId}`, `key-${docId}`, `sha-${docId}`],
    );
    await indexDocument(owner, docId, pagesFromText(text), embed);
  }
  await q(
    `INSERT INTO findings (id, project_id, org_id, title, source_document_id, created_by) VALUES ($1,$2,$3,'No charter review',$4,$5)`,
    [FINDING, P1, ACME, DOC.charter, U.cons],
  );
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, finding_id, created_by) VALUES
       ($1,$2,$3,'Adopt the board charter',$4,$5), ($6,$7,$8,'Beta charter',NULL,$9)`,
    [REC, P1, ACME, FINDING, U.cons, BETA_REC, BETA_P, BETA, U.other],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, status, due_date, created_by)
     VALUES ($1,$2,$3,$4,'Update the audit committee mandate','in_progress','2026-11-15',$5)`,
    [ACT, P1, ACME, REC, U.cons],
  );
});

beforeEach(async () => {
  sent.length = 0;
  translated.length = 0;
  delete process.env.AI_MASKING;
  await owner.query(`DELETE FROM ai_conversations`);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("hybrid search", () => {
  it("finds an exact word the vectors can't tell apart, and only in the person's project", async () => {
    // Every passage has the same vector: only the keyword half can rank.
    const top = await as(U.cons, async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      const p = (await loadPrincipal(tx, U.cons))!;
      const scope = retrievalScope(p, { type: "project", id: P1, orgId: ACME, firmOrgId: FIRM, projectId: P1 })!;
      return A.retrieve(tx, scope, ONE, { query: "What does zebrapolicy say?" });
    });
    expect(top[0]!.sourceId).toBe(DOC.zebra);
    expect(top.every((r) => r.sourceId === DOC.charter || r.sourceId === DOC.zebra)).toBe(true);
  });

  it("can't be widened by a forged scope or by the words asked", async () => {
    // Beta's consultant forging Acme's project, asking for Beta's own word.
    const got = await as(U.other, async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return A.retrieve(
        tx,
        { projectId: P1, orgId: ACME, labels: ["shared", "firm_private", "client_private", "user_private"], userId: U.other },
        ONE,
        { query: "zebrapolicy Rawdah secret" },
      );
    });
    expect(got).toEqual([]);
  });

  it("puts the chat's case first", async () => {
    const top = await as(U.cons, async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      const p = (await loadPrincipal(tx, U.cons))!;
      const scope = retrievalScope(p, { type: "project", id: P1, orgId: ACME, firmOrgId: FIRM, projectId: P1 })!;
      return A.retrieve(tx, scope, ONE, { query: "zebrapolicy", case: { type: "document", id: DOC.charter } });
    });
    expect(top[0]!.sourceId).toBe(DOC.charter);
  });
});

describe("asking", () => {
  it("starts a titled chat, adds the case and the records behind the files, and cites records", async () => {
    reply = (p) => ({ answer: "See the action.", cited_ids: [p[p.length - 1]!.id], grounded: true });
    const first = await ask(U.cons, { question: "  What is   pending on the board charter?  ", case: { type: "action", id: ACT } });
    const passages = sent[0]!.passages;
    const records = passages.filter((p) => ["action", "recommendation", "finding", "meeting"].includes(p.source));
    // The case first, then the recommendation behind the charter (through its finding).
    expect(records.map((p) => p.source)).toEqual(["action", "recommendation"]);
    expect(records[0]!.text).toContain("status in_progress, due 2026-11-15");
    expect(records[1]!.text).toContain("Update the audit committee mandate");
    expect(first.citations).toEqual([
      { chunkId: null, sourceType: "recommendation", sourceId: REC, version: 1, page: null },
    ]);

    const chat = await svc(U.cons, (tx, p) => A.getConversation(tx, p, first.conversationId, "en"));
    expect(chat).toMatchObject({ title: "What is pending on the board charter?", caseType: "action", caseId: ACT });
    expect(chat.caseLabel).toBe("Update the audit committee mandate");
    expect(chat.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(chat.messages[1]!.citations[0]).toMatchObject({ label: "Adopt the board charter", available: true });

    // A follow-up gets the earlier turns as context, oldest first, and searches again.
    await ask(U.cons, { question: "And who owns it?", conversationId: first.conversationId });
    expect(sent[1]!.history).toEqual([
      { role: "user", content: "  What is   pending on the board charter?  ".replace(/\s+/g, " ").trim() },
      { role: "assistant", content: "See the action." },
    ]);
    expect(sent[1]!.passages.length).toBeGreaterThan(0);
  });

  it("refuses a case from another project or one the person can't see", async () => {
    await expect(ask(U.cons, { question: "q", case: { type: "recommendation", id: BETA_REC } })).rejects.toThrow(
      /case must be a record of the chat's project/,
    );
  });

  it("says why an action is blocked when the action is the case", async () => {
    await owner.query(`UPDATE actions SET status = 'blocked', blocked_reason = 'Waiting for the legal adviser' WHERE id = $1`, [ACT]);
    try {
      await ask(U.cons, { question: "Why is this blocked?", case: { type: "action", id: ACT } });
      const record = sent[0]!.passages.find((p) => p.source === "action")!;
      expect(record.text).toContain('Blocked because: "Waiting for the legal adviser"');
    } finally {
      await owner.query(`UPDATE actions SET status = 'in_progress', blocked_reason = NULL WHERE id = $1`, [ACT]);
    }
  });

  it("can't confirm in the question's language when the language is auto", async () => {
    reply = () => ({ answer: "x", cited_ids: [], grounded: false });
    expect((await ask(U.cons, { question: "What is the dividend policy?", language: "auto" })).answer).toMatch(/can't confirm/);
    expect((await ask(U.cons, { question: "ما سياسة توزيع الأرباح؟", language: "auto" })).answer).toMatch(/لا أستطيع/);
  });

  it("says it can't confirm, and cites nothing, when the model isn't grounded", async () => {
    reply = () => ({ answer: "Probably yes.", cited_ids: ["P1"], grounded: false });
    const r = await ask(U.cons, { question: "Is it compliant?" });
    expect(r.answer).toMatch(/can't confirm/);
    expect(r.citations).toEqual([]);
  });
});

describe("status questions", () => {
  const LATE = id(301);
  const STUCK = id(302);
  const OTHER = id(303);
  const P2_REC = id(304);
  beforeAll(async () => {
    const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
    await q(`INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES ($1,$2,$3,'HR rec',$4)`, [P2_REC, P2, ACME, U.other]);
    await q(
      `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, status, due_date, owner_name, blocked_reason, created_by) VALUES
         ($1,$5,$6,$8,'File the related-party register','assigned',current_date - 12,'Hind',NULL,$9),
         ($2,$5,$6,$8,'Appoint the board secretary','blocked',current_date + 20,NULL,'No candidate yet',$9),
         ($3,$7,$6,$4,'HR overdue secret','assigned',current_date - 3,NULL,NULL,$9)`,
      [LATE, STUCK, OTHER, P2_REC, P1, ACME, P2, REC, U.cons],
    );
  });
  afterAll(async () => {
    await owner.query(`DELETE FROM actions WHERE id = ANY($1)`, [[LATE, STUCK, OTHER]]);
    await owner.query(`DELETE FROM recommendations WHERE id = $1`, [P2_REC]);
  });

  it("answers from the project's action records, counted as of today, and cites them", async () => {
    reply = (p) => ({ answer: "One is late.", cited_ids: p.filter((x) => x.source === "project" || (x.source === "action" && x.text.includes("register"))).map((x) => x.id), grounded: true });
    const r = await ask(U.cons, { question: "What is overdue?" });
    const passages = sent[0]!.passages;
    const summary = passages.find((p) => p.source === "project")!;
    expect(summary.text).toMatch(/as of \d{4}-\d{2}-\d{2}/);
    expect(summary.text).toContain("1 overdue");
    expect(summary.text).toContain("1 blocked");
    const late = passages.find((p) => p.source === "action" && p.text.includes("File the related-party register"))!;
    expect(late.text).toContain("12 days overdue");
    expect(late.text).toContain("owner Hind");
    // Only what was asked about, and nothing from another project.
    expect(passages.filter((p) => p.source === "action").map((p) => p.text).join()).not.toContain("Appoint the board secretary");
    expect(JSON.stringify(passages)).not.toContain("HR overdue secret");
    expect(r.citations.map((c) => c.sourceType).sort()).toEqual(["action", "project"]);
    const chat = await svc(U.cons, (tx, p) => A.getConversation(tx, p, r.conversationId, "en"));
    expect(chat.messages[1]!.citations.find((c) => c.sourceType === "project")).toMatchObject({ label: "Board governance", available: true });
  });

  it("works in Arabic and says why an action is blocked", async () => {
    reply = (p) => ({ answer: "x", cited_ids: [p[0]!.id], grounded: true });
    await ask(U.cons, { question: "ما الإجراءات المتعثرة؟", language: "ar" });
    const stuck = sent[0]!.passages.find((p) => p.source === "action" && p.text.includes("Appoint the board secretary"))!;
    expect(stuck.text).toContain('Blocked because: "No candidate yet"');
  });

  it("leaves other questions to search", async () => {
    await ask(U.cons, { question: "What does the charter say about the chair?" });
    expect(sent[0]!.passages.some((p) => p.source === "project")).toBe(false);
  });
});

describe("a chat closes when its owner leaves the project", () => {
  it("hides the chat and its messages, and shows them again on re-staffing", async () => {
    reply = (p) => ({ answer: "Answer.", cited_ids: [p[0]!.id], grounded: true });
    const r = await ask(U.cons, { question: "Summarise the charter" });
    const visible = async () => ({
      chats: (await sqlAs(U.cons, `SELECT id FROM ai_conversations`)).rowCount,
      messages: (await sqlAs(U.cons, `SELECT id FROM ai_messages WHERE conversation_id = $1`, [r.conversationId])).rowCount,
    });
    expect(await visible()).toEqual({ chats: 1, messages: 2 });

    await owner.query(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [P1, U.cons]);
    await owner.query(`DELETE FROM client_assignments WHERE client_org_id = $1 AND user_id = $2`, [ACME, U.cons]);
    try {
      expect(await visible()).toEqual({ chats: 0, messages: 0 });
      await expect(svc(U.cons, (tx, p) => A.getConversation(tx, p, r.conversationId, "en"))).rejects.toThrow(/not found/);
      await expect(
        svc(U.cons, (tx, p) => T.translate(tx, p, { entityType: "ai_message", entityId: r.messageId, field: "content", to: "ar" })),
      ).rejects.toThrow(/not found/);
    } finally {
      await owner.query(`INSERT INTO client_assignments (client_org_id, user_id) VALUES ($1,$2)`, [ACME, U.cons]);
      await owner.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [P1, U.cons]);
    }
    expect(await visible()).toEqual({ chats: 1, messages: 2 });
  });

  it("keeps messages as they were, and the chat in its project", async () => {
    const r = await ask(U.cons, { question: "Summarise the charter" });
    await expect(sqlAs(U.cons, `UPDATE ai_messages SET content = 'edited' WHERE id = $1`, [r.messageId])).rejects.toThrow(
      /permission denied/,
    );
    await expect(sqlAs(U.cons, `UPDATE ai_conversations SET project_id = $1 WHERE id = $2`, [P2, r.conversationId])).rejects.toThrow(
      /stays in its project/,
    );
    await expect(
      sqlAs(U.cons, `UPDATE ai_conversations SET last_message_at = now() - interval '1 year' WHERE id = $1`, [r.conversationId]),
    ).rejects.toThrow(/set by the database/);
    // Nobody else reads it, even firm admins.
    expect((await sqlAs(U.admin, `SELECT id FROM ai_messages WHERE conversation_id = $1`, [r.conversationId])).rowCount).toBe(0);
  });
});

describe("chat list", () => {
  it("renames, keeps, archives and deletes, and a new message brings a chat back", async () => {
    const r = await ask(U.cons, { question: "Summarise the charter" });
    await svc(U.cons, (tx, p) => A.updateConversation(tx, p, r.conversationId, { title: "Charter summary", keep: true }));
    await svc(U.cons, (tx, p) => A.updateConversation(tx, p, r.conversationId, { archived: true }));
    const open = await svc(U.cons, (tx, p) => A.listConversations(tx, p, { archived: false }));
    const archived = await svc(U.cons, (tx, p) => A.listConversations(tx, p, { archived: true }));
    expect(open).toEqual([]);
    expect(archived[0]).toMatchObject({ title: "Charter summary", keep: true, orgName: "Al-Nukhba Holding", projectTitle: "Board governance" });

    await ask(U.cons, { question: "And again?", conversationId: r.conversationId });
    expect((await svc(U.cons, (tx, p) => A.listConversations(tx, p, { archived: false }))).map((c) => c.id)).toEqual([
      r.conversationId,
    ]);
    await expect(svc(U.other, (tx, p) => A.deleteConversation(tx, p, r.conversationId))).rejects.toThrow(/not found/);
    await svc(U.cons, (tx, p) => A.deleteConversation(tx, p, r.conversationId));
    expect((await owner.query(`SELECT 1 FROM ai_messages WHERE conversation_id = $1`, [r.conversationId])).rowCount).toBe(0);
    expect(
      (await owner.query(`SELECT 1 FROM audit_log WHERE action = 'assistant.chat_deleted' AND resource_id = $1`, [r.conversationId]))
        .rowCount,
    ).toBe(1);
  });

  it("unlinks a chat from its case when the record is deleted", async () => {
    const extra = id(299);
    await owner.query(
      `INSERT INTO recommendations (id, project_id, org_id, title, created_by) VALUES ($1,$2,$3,'Temporary',$4)`,
      [extra, P1, ACME, U.cons],
    );
    const r = await ask(U.cons, { question: "q", case: { type: "recommendation", id: extra } });
    await owner.query(`DELETE FROM recommendations WHERE id = $1`, [extra]);
    const row = (await owner.query(`SELECT case_type, case_id, project_id FROM ai_conversations WHERE id = $1`, [r.conversationId]))
      .rows[0];
    expect(row).toEqual({ case_type: null, case_id: null, project_id: P1 });
  });

  it("shows a kept translation without calling the model, and marks sources that are gone", async () => {
    reply = (p) => ({ answer: "الإجابة هنا.", cited_ids: [p[0]!.id], grounded: true });
    const r = await ask(U.cons, { question: "ما الجديد؟", language: "ar" });
    let chat = await svc(U.cons, (tx, p) => A.getConversation(tx, p, r.conversationId, "en"));
    expect(chat.messages[1]!.translation).toBeNull();
    await svc(U.cons, (tx, p) => T.translate(tx, p, { entityType: "ai_message", entityId: r.messageId, field: "content", to: "en" }));
    expect(translated).toHaveLength(1);
    chat = await svc(U.cons, (tx, p) => A.getConversation(tx, p, r.conversationId, "en"));
    expect(chat.messages[1]!.translation).toMatchObject({ text: "EN: الإجابة هنا.", reviewed: false });
    expect(translated).toHaveLength(1);

    const cited = chat.messages[1]!.citations[0]!;
    await owner.query(`UPDATE documents SET visibility = 'user_private' WHERE id = $1`, [cited.sourceId]);
    try {
      chat = await svc(U.cons, (tx, p) => A.getConversation(tx, p, r.conversationId, "en"));
      expect(chat.messages[1]!.citations[0]).toMatchObject({ available: false, label: null });
    } finally {
      await owner.query(`UPDATE documents SET visibility = 'shared' WHERE id = $1`, [cited.sourceId]);
      await indexDocument(owner, cited.sourceId, pagesFromText("restored text"), embed);
    }
  });
});

describe("masking names before the model", () => {
  const KNOWN = [
    "Al-Nukhba",
    "النخبة",
    "Mizan",
    "Reem",
    "Al-Harbi",
    "خالد",
    "العتيبي",
    "Finance",
    "المالية",
    "Riyadh",
    "reem@nukhba.example",
    "0551234567",
  ];

  it("sends no known name, and puts the names back in the answer", async () => {
    process.env.AI_MASKING = "on";
    reply = (p) => ({ answer: `[PERSON_1] leads it for [ORG_1].`, cited_ids: [p[0]!.id], grounded: true });
    const r = await ask(U.cons, {
      question: "What does Reem Al-Harbi do for Al-Nukhba Holding and خالد العتيبي in the Finance department?",
      case: { type: "document", id: DOC.charter },
    });
    const payload = JSON.stringify(sent[0]);
    for (const name of KNOWN) expect(payload, name).not.toContain(name);
    expect(payload).toContain("[ORG_");
    expect(payload).toContain("[PERSON_");
    expect(r.answer).toBe("Reem Al-Harbi leads it for Al-Nukhba Holding.");
    const stored = (await owner.query(`SELECT content FROM ai_messages WHERE id = $1`, [r.messageId])).rows[0].content;
    expect(stored).toBe("Reem Al-Harbi leads it for Al-Nukhba Holding.");
    const audit = (await owner.query(`SELECT meta FROM audit_log WHERE action = 'assistant.query' ORDER BY created_at DESC LIMIT 1`))
      .rows[0].meta;
    expect(audit.masked).toBeGreaterThan(3);
  });

  it("masks translations too, and leaves text alone with a local model", async () => {
    process.env.AI_MASKING = "on";
    reply = (p) => ({ answer: "تقود ريم الحربي العمل في شركة النخبة القابضة.", cited_ids: [p[0]!.id], grounded: true });
    const r = await ask(U.cons, { question: "من يقود؟", language: "ar" });
    const out = await svc(U.cons, (tx, p) =>
      T.translate(tx, p, { entityType: "ai_message", entityId: r.messageId, field: "content", to: "en" }),
    );
    expect(translated[0]).not.toContain("النخبة");
    expect(out.text).toContain("شركة النخبة القابضة");

    delete process.env.AI_MASKING;
    process.env.LLM_PROVIDER = "ollama";
    try {
      await ask(U.cons, { question: "What does Reem do?" });
      expect(sent.at(-1)!.question).toBe("What does Reem do?");
    } finally {
      delete process.env.LLM_PROVIDER;
    }
  });

  it("gives a client's English and Arabic names one placeholder", async () => {
    process.env.AI_MASKING = "on";
    await ask(U.cons, { question: "Is Al-Nukhba Holding the same as شركة النخبة القابضة?" });
    expect(sent[0]!.question).toBe("Is [ORG_1] the same as [ORG_1]?");
  });

  it("is on by default with a hosted model", async () => {
    process.env.LLM_PROVIDER = "openai_compat";
    try {
      await ask(U.cons, { question: "What does Reem do?" });
      expect(sent[0]!.question).toBe("What does [PERSON_1] do?");
    } finally {
      delete process.env.LLM_PROVIDER;
    }
  });

  it("masks second-language names, short names and Latin spellings", async () => {
    process.env.AI_MASKING = "on";
    await owner.query(`UPDATE "user" SET name_alt = 'Khalid Al-Otaibi' WHERE id = $1`, [U.cmgr]);
    await owner.query(`UPDATE organizations SET short_names = ARRAY['Nukhba Co','النخبة'] WHERE id = $1`, [ACME]);
    try {
      await ask(U.cons, { question: "Did Khalid AlOtaibi from Nukhba Co meet Reem Alharbi?" });
      expect(sent[0]!.question).toBe("Did [PERSON_1] from [ORG_1] meet [PERSON_2]?");
      // The other-language name is the same person as the registered one.
      await ask(U.cons, { question: "Is خالد العتيبي Khalid Al-Otaibi?" });
      expect(sent[1]!.question).toBe("Is [PERSON_1] [PERSON_1]?");
      // A client person with no account, named as an action's owner, without the role.
      await owner.query(`UPDATE actions SET owner_name = 'Hind Bakr (CFO)' WHERE id = $1`, [ACT]);
      await ask(U.cons, { question: "Has Hind Bakr replied?" });
      expect(sent[2]!.question).toBe("Has [PERSON_1] replied?");
    } finally {
      await owner.query(`UPDATE actions SET owner_name = NULL WHERE id = $1`, [ACT]);
      await owner.query(`UPDATE "user" SET name_alt = NULL WHERE id = $1`, [U.cmgr]);
      await owner.query(`UPDATE organizations SET short_names = '{}' WHERE id = $1`, [ACME]);
    }
  });

  it("masks the firm's other clients for its staff, but never lists them to a client", async () => {
    process.env.AI_MASKING = "on";
    await ask(U.cons, { question: "Does Rawdah Group have the same charter?" });
    expect(sent[0]!.question).toBe("Does [ORG_1] have the same charter?");
    const terms = async (uid: string) => (await sqlAs(uid, `SELECT term FROM app_mask_terms($1)`, [P1])).rows.map((r) => r.term);
    expect(await terms(U.cons)).toContain("Rawdah Group");
    expect(await terms(U.cmgr)).not.toContain("Rawdah Group");
    expect(await terms(U.cmgr)).toContain("Al-Nukhba Holding");
  });

  it("lets only an admin set a second-language name or short names, and erasure clears the name", async () => {
    const logs = async () =>
      (await owner.query(`SELECT 1 FROM audit_log WHERE action = 'user.name_alt' AND resource_id = $1`, [U.other])).rowCount;
    const before = await logs();
    await expect(sqlAs(U.cons, `SELECT app_set_name_alt($1, 'Omar')`, [U.other])).rejects.toThrow(/not allowed/);
    await sqlAs(U.admin, `SELECT app_set_name_alt($1, '  Omar F.  ')`, [U.other]);
    expect((await owner.query(`SELECT name_alt FROM "user" WHERE id = $1`, [U.other])).rows[0].name_alt).toBe("Omar F.");
    expect(await logs()).toBe(before! + 1);

    const E = await import("@/services/engagement");
    await expect(svc(U.cons, (tx, p) => E.setShortNames(tx, p, ACME, "Nukhba"))).rejects.toThrow();
    await svc(U.admin, (tx, p) => E.setShortNames(tx, p, ACME, "Nukhba, النخبة\nNukhba"));
    expect((await owner.query(`SELECT short_names FROM organizations WHERE id = $1`, [ACME])).rows[0].short_names).toEqual(["Nukhba", "النخبة"]);
    await expect(svc(U.admin, (tx, p) => E.setShortNames(tx, p, ACME, "a,b,c,d,e,f,g"))).rejects.toThrow();
    await svc(U.admin, (tx, p) => E.setShortNames(tx, p, ACME, ""));

    await owner.query(`UPDATE "user" SET email = 'erased-x@erased.invalid' WHERE id = $1`, [U.other]);
    expect((await owner.query(`SELECT name_alt FROM "user" WHERE id = $1`, [U.other])).rows[0].name_alt).toBeNull();
    await owner.query(`UPDATE "user" SET email = 'other@example.test' WHERE id = $1`, [U.other]);
  });

  it("gives the names only for a project the caller can see", async () => {
    expect((await sqlAs(U.other, `SELECT * FROM app_mask_terms($1)`, [P1])).rowCount).toBe(0);
    expect((await sqlAs(U.cons, `SELECT * FROM app_mask_terms($1)`, [P1])).rowCount).toBeGreaterThan(0);
  });
});

describe("retention", () => {
  const backdate = (chat: string, days: number) =>
    owner.query(`ALTER TABLE ai_conversations DISABLE TRIGGER check_chat;
      UPDATE ai_conversations SET last_message_at = now() - make_interval(days => ${days}) WHERE id = '${chat}';
      ALTER TABLE ai_conversations ENABLE TRIGGER check_chat;`);
  const purge = async (today = "now") =>
    (
      await owner.query(
        `SELECT archived, deleted FROM app_purge_chats(${today === "now" ? "(now() AT TIME ZONE 'Asia/Riyadh')::date" : `'${today}'::date`})`,
      )
    ).rows[0];
  const exists = async (chat: string) =>
    (await owner.query(`SELECT archived_at IS NOT NULL AS archived FROM ai_conversations WHERE id = $1`, [chat])).rows[0] ?? null;

  it("archives idle chats unless kept", async () => {
    const a = (await ask(U.cons, { question: "a" })).conversationId;
    const b = (await ask(U.cons, { question: "b" })).conversationId;
    const fresh = (await ask(U.cons, { question: "c" })).conversationId;
    await svc(U.cons, (tx, p) => A.updateConversation(tx, p, b, { keep: true }));
    await backdate(a, 31);
    await backdate(b, 31);
    expect(await purge()).toEqual({ archived: 1, deleted: 0 });
    expect(await exists(a)).toEqual({ archived: true });
    expect(await exists(b)).toEqual({ archived: false });
    expect(await exists(fresh)).toEqual({ archived: false });
  });

  it("deletes 180 days after the last message, kept or not, with the messages' translations", async () => {
    const r = await ask(U.cons, { question: "a" });
    await svc(U.cons, (tx, p) => A.updateConversation(tx, p, r.conversationId, { keep: true }));
    await svc(U.cons, (tx, p) => T.translate(tx, p, { entityType: "ai_message", entityId: r.messageId, field: "content", to: "ar" }));
    await backdate(r.conversationId, 181);
    expect((await purge()).deleted).toBe(1);
    expect(await exists(r.conversationId)).toBeNull();
    expect((await owner.query(`SELECT 1 FROM content_translations WHERE entity_id = $1`, [r.messageId])).rowCount).toBe(0);
    const log = await owner.query(`SELECT actor_id, reason FROM audit_log WHERE resource_id = $1`, [r.conversationId]);
    expect(log.rows).toEqual([{ actor_id: null, reason: "retention" }]);
  });

  it("deletes 90 days after the project closes, and a closed project gets its date from the database", async () => {
    const r = await ask(U.cons, { question: "a" });
    await svc(U.admin, async (tx, p) => (await import("@/services/handover")).setProjectState(tx, p, P1, "closed"));
    try {
      const closed = (await owner.query(`SELECT closed_at FROM projects WHERE id = $1`, [P1])).rows[0].closed_at;
      expect(closed).not.toBeNull();
      const due = (
        await sqlAs(U.cons, `SELECT app_chat_delete_on(last_message_at, project_id) AS d FROM ai_conversations WHERE id = $1`, [
          r.conversationId,
        ])
      ).rows[0].d;
      const expected = new Date(closed);
      const riyadh = new Date(expected.getTime() + 3 * 3600_000);
      riyadh.setUTCDate(riyadh.getUTCDate() + 90);
      expect(new Date(due).toISOString().slice(0, 10)).toBe(riyadh.toISOString().slice(0, 10));
      const day = riyadh.toISOString().slice(0, 10);
      const before = new Date(riyadh.getTime() - 86400_000).toISOString().slice(0, 10);
      expect((await purge(before)).deleted).toBe(0);
      expect((await purge(day)).deleted).toBe(1);
      // Only a firm admin closes a project.
      await expect(
        svc(U.cons, async (tx, p) => (await import("@/services/handover")).setProjectState(tx, p, P1, "active")),
      ).rejects.toThrow();
    } finally {
      await owner.query(`UPDATE projects SET state = 'active' WHERE id = $1`, [P1]);
    }
    expect((await owner.query(`SELECT closed_at FROM projects WHERE id = $1`, [P1])).rows[0].closed_at).toBeNull();
  });

  it("the firm's numbers apply, within their limits", async () => {
    await owner.query(
      `INSERT INTO firm_settings (org_id, chat_archive_days, chat_idle_delete_days) VALUES ($1, 10, 40)
       ON CONFLICT (org_id) DO UPDATE SET chat_archive_days = 10, chat_idle_delete_days = 40`,
      [FIRM],
    );
    try {
      const r = await ask(U.cons, { question: "a" });
      await backdate(r.conversationId, 41);
      expect((await purge()).deleted).toBe(1);
      await expect(owner.query(`UPDATE firm_settings SET chat_idle_delete_days = 5 WHERE org_id = $1`, [FIRM])).rejects.toThrow(
        /chat_idle_delete_days_range/,
      );
    } finally {
      await owner.query(`DELETE FROM firm_settings WHERE org_id = $1`, [FIRM]);
    }
  });
});
