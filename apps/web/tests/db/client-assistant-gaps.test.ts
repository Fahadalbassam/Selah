// The client assistant's four gaps (Gate B, 19 Nov 2026; docs/assistant.md,
// "The client assistant"), against a real Postgres: "who is my consultant"
// names the same people Help shows, read as the asker; "my deadlines" only
// narrows to the asker's own actions; the progress-update draft is built from
// the asker's readable records and marked as a draft; a legal question gets
// the facts without the ruling. A client manager limited to a department gets
// only that department's people and deadlines; another client gets nothing.
// Vectors and the model are faked; no AI is called.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { indexRecords, type Embed } from "@/jobs/index-documents";
import { CLIENT_AI_VERSION, CLIENT_REFUSAL, DRAFT_MARK, LEGAL_NOTE } from "@/lib/client-ai";
import { loadPrincipal } from "@/services/principal";

const ONE = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
const sent: { passages: { id: string; text: string; source: string }[]; question: string }[] = [];
const DEFAULT_REPLY = (passages: { id: string }[]) => ({ answer: "Here is what your records say.", cited_ids: [passages[0]!.id], grounded: true });
let reply = DEFAULT_REPLY;
vi.mock("@/services/ai-client", () => ({
  modelIsLocal: async () => true,
  embed: async (texts: string[]) => texts.map(() => ONE),
  answer: async (question: string, passages: { id: string; text: string; source: string }[]) => {
    sent.push({ passages, question });
    return reply(passages);
  },
  translateText: async () => {
    throw new Error("not in tests");
  },
  summarizePages: async () => {
    throw new Error("not in tests");
  },
}));
const A = await import("@/services/assistant");
const C = await import("@/services/client-ai");

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-f951-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const P1 = id(5);
const BETA_P = id(6);
const DEPT_FIN = id(31);
const DEPT_OPS = id(32);
const U = {
  admin: id(11),
  lead: id(12),
  deputy: id(13),
  cons: id(14), // staffed on P1
  observer: id(15), // observing P1: never named
  cadmin: id(16),
  fin: id(17), // client manager in Finance only
  owner1: id(18),
  bAdmin: id(19),
};
const NAMES: Record<keyof typeof U, string> = {
  admin: "Firm Admin",
  lead: "Lina Lead",
  deputy: "Dana Deputy",
  cons: "Karim Consultant",
  observer: "Omar Observer",
  cadmin: "Client Admin",
  fin: "Faisal Finance",
  owner1: "Owner One",
  bAdmin: "Beta Admin",
};
const R1 = id(201);
const ACT = {
  finOwn: id(211), // Finance, owned by fin
  finTyped: id(212), // Finance, no account: typed with fin's own name
  finOther: id(213), // Finance, owned by owner1
  ops: id(214), // Operations, owned by owner1: fin never reads it
  done: id(215), // Finance, verified
  draft: id(216), // Finance, a draft the firm has not released (D6)
};

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

const actionIds = (passages: { text: string }[] | { type: string; id: string }[]) =>
  (passages as { type?: string; id?: string }[]).filter((p) => p.type === "action").map((p) => p.id);

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
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
      ($1,$10,'firm_admin'), ($2,$10,'consultant'), ($3,$10,'consultant'), ($4,$10,'consultant'), ($5,$10,'consultant'),
      ($6,$11,'client_admin'), ($7,$11,'client_manager'), ($8,$11,'action_owner'), ($9,$12,'client_admin')`,
    [U.admin, U.lead, U.deputy, U.cons, U.observer, U.cadmin, U.fin, U.owner1, U.bAdmin, FIRM, ACME, BETA],
  );
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$3,'المالية','Finance'), ($2,$3,'العمليات','Operations')`, [DEPT_FIN, DEPT_OPS, ACME]);
  await q(`INSERT INTO department_members (department_id, user_id) VALUES ($1,$2)`, [DEPT_FIN, U.fin]);
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$3,$5,'Acme governance','active',$6), ($2,'client',$4,$5,'Beta strategy','active',$6)`,
    [P1, BETA_P, ACME, BETA, FIRM, U.admin],
  );
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES
      ($1,$2,true,false), ($1,$3,false,true), ($1,$4,false,false), ($1,$5,false,false), ($6,$2,true,false)`,
    [ACME, U.lead, U.deputy, U.cons, U.observer, BETA],
  );
  await q(
    `INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,false), ($1,$3,true), ($1,$4,false), ($1,$5,false)`,
    [P1, U.cons, U.observer, U.fin, U.owner1],
  );
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, rationale, visibility, created_by) VALUES ($1,$2,$3,'Approve the board charter','No written charter','shared',$4)`,
    [R1, P1, ACME, U.cons],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, owner_name, department_id, status, due_date, created_by) VALUES
      ($1,$7,$8,$9,'Draft the delegation table',$10,NULL,$12,'in_progress',app_firm_today() - 5,$14),
      ($2,$7,$8,$9,'Collect the signed declarations',NULL,'  faisal FINANCE ',$12,'assigned',app_firm_today() + 20,$14),
      ($3,$7,$8,$9,'Reconcile the budget lines',$11,NULL,$12,'awaiting_review',app_firm_today() + 10,$14),
      ($4,$7,$8,$9,'Map the plant procedures',$11,NULL,$13,'assigned',app_firm_today() + 30,$14),
      ($5,$7,$8,$9,'Publish the finance charter',$10,NULL,$12,'verified_complete',app_firm_today() - 40,$14),
      ($6,$7,$8,$9,'Unreleased finance step',$10,NULL,$12,'draft',app_firm_today() + 50,$14)`,
    [ACT.finOwn, ACT.finTyped, ACT.finOther, ACT.ops, ACT.done, ACT.draft, P1, ACME, R1, U.fin, U.owner1, DEPT_FIN, DEPT_OPS, U.cons],
  );
  // The recommendation and actions as passages, so a question with no status word still finds records.
  await indexRecords(owner, (async (texts: string[]) => texts.map(() => ONE)) as Embed);
  await svc(U.admin, (tx, p) => C.setClientAi(tx, p, ACME, { enabled: true, roles: ["client_admin", "client_manager"], dailyLimit: 100 }));
  await svc(U.cadmin, (tx, p) => C.consentClientAi(tx, p, { version: CLIENT_AI_VERSION, locale: "en" }));
});

beforeEach(async () => {
  sent.length = 0;
  reply = DEFAULT_REPLY;
  await owner.query(`DELETE FROM ai_usage`);
  await owner.query(`DELETE FROM ai_conversations`);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("who is my consultant", () => {
  it("names the client's lead, deputy and the consultants staffed on the project, never an observer, read as the asker", async () => {
    for (const uid of [U.cadmin, U.fin]) {
      const [rec] = await svc(uid, (tx, p) => A.consultantRecords(tx, p, [{ id: P1, kind: "client" }]));
      expect(rec, uid).toMatchObject({ type: "project", id: P1, projectId: P1 });
      expect(rec!.text).toContain("lead consultant Lina Lead");
      expect(rec!.text).toContain("deputy consultant Dana Deputy");
      expect(rec!.text).toContain("Karim Consultant");
      expect(rec!.text).not.toContain("Omar Observer");
      expect(rec!.text).not.toContain("@example.test");
    }
  });

  it("gives another client's person nothing about the project, and staff no passage", async () => {
    expect(await svc(U.bAdmin, (tx, p) => A.consultantRecords(tx, p, [{ id: P1, kind: "client" }]))).toEqual([]);
    expect(await svc(U.cons, (tx, p) => A.consultantRecords(tx, p, [{ id: P1, kind: "client" }]))).toEqual([]);
  });

  it("goes to the model with the question and is cited as the project's record", async () => {
    const out = await svc(U.fin, (tx, p) => A.ask(tx, p, { projectId: P1, question: "Who is my consultant?", language: "en" }));
    expect(sent[0]!.passages[0]!.text).toContain("lead consultant Lina Lead");
    expect(out.citations[0]).toMatchObject({ sourceType: "project", sourceId: P1 });
  });
});

describe("my deadlines", () => {
  const status = (uid: string, mine: boolean) =>
    svc(uid, (tx, p) => A.statusRecords(tx, P1, new Set(["open"]), undefined, mine ? { mine: p.userId } : {}));

  it("a department-limited manager: the department's actions, and with 'my' only their own or those typed with their name", async () => {
    expect(actionIds(await status(U.fin, false)).sort()).toEqual([ACT.finOwn, ACT.finTyped, ACT.finOther].sort());
    const mine = await status(U.fin, true);
    expect(actionIds(mine).sort()).toEqual([ACT.finOwn, ACT.finTyped].sort());
    expect(mine[0]!.text).toContain('"your actions"');
    expect(mine[0]!.text).toContain("2 open");
  });

  it("only narrows: the client admin reads every released action, and 'mine' gives them none of others'", async () => {
    expect(actionIds(await status(U.cadmin, false)).sort()).toEqual([ACT.finOwn, ACT.finTyped, ACT.finOther, ACT.ops].sort());
    const mine = await status(U.cadmin, true);
    expect(actionIds(mine)).toEqual([]);
    expect(mine[0]!.text).toContain("0 open");
  });

  it("another client's person reads no action and no count of them", async () => {
    for (const mine of [false, true]) {
      const out = await status(U.bAdmin, mine);
      expect(actionIds(out)).toEqual([]);
      expect(out.map((r) => r.text).join(" ")).toContain("0 open");
    }
    await expect(svc(U.bAdmin, (tx, p) => A.ask(tx, p, { projectId: P1, question: "What are my deadlines?", language: "en" }))).rejects.toThrow();
  });

  it("the question decides: 'my deadlines' and «ما المطلوب مني؟» narrow, 'what is still open?' does not", async () => {
    await svc(U.fin, (tx, p) => A.ask(tx, p, { projectId: P1, question: "What are my deadlines?", language: "en" }));
    await svc(U.fin, (tx, p) => A.ask(tx, p, { projectId: P1, question: "ما المطلوب مني؟", language: "ar" }));
    await svc(U.fin, (tx, p) => A.ask(tx, p, { projectId: P1, question: "What is still open?", language: "en" }));
    const titles = (i: number) => sent[i]!.passages.map((x) => x.text).join("\n");
    for (const i of [0, 1]) {
      expect(titles(i)).toContain("Draft the delegation table");
      expect(titles(i)).toContain("Collect the signed declarations");
      expect(titles(i)).not.toContain("Reconcile the budget lines");
      expect(titles(i)).toContain('"your actions"');
    }
    expect(titles(2)).toContain("Reconcile the budget lines");
    expect(titles(2)).not.toContain('"your actions"');
    for (const i of [0, 1, 2]) expect(titles(i)).not.toContain("Map the plant procedures");
  });
});

describe("the progress-update draft", () => {
  it("is built only from the asker's readable records: a department's, done ones included, never a draft action", async () => {
    const recs = await svc(U.fin, (tx) => A.progressRecords(tx, [P1]));
    expect(actionIds(recs).sort()).toEqual([ACT.finOwn, ACT.finTyped, ACT.finOther, ACT.done].sort());
    const text = recs.map((r) => r.text).join("\n");
    expect(text).toContain("1 done");
    expect(text).toContain("1 late");
    expect(text).toContain("5 days late");
    expect(text).not.toContain("Unreleased finance step");
    expect(await svc(U.bAdmin, (tx) => A.progressRecords(tx, [P1]))).toEqual([]);
  });

  it("always starts with the draft mark, in the language asked", async () => {
    reply = (ps) => ({ answer: "Done: Publish the finance charter. Late: Draft the delegation table.", cited_ids: [ps[0]!.id], grounded: true });
    const en = await svc(U.fin, (tx, p) => A.ask(tx, p, { projectId: P1, question: "Draft my progress update for this month", language: "en" }));
    expect(en.answer.startsWith(`${DRAFT_MARK.en}\n\n`)).toBe(true);
    expect(sent[0]!.passages.map((x) => x.text).join(" ")).toContain("For a progress-update draft");
    const ar = await svc(U.fin, (tx, p) => A.ask(tx, p, { projectId: P1, question: "اكتب لي مسودة تحديث التقدم لهذا الشهر", language: "ar" }));
    expect(ar.answer.startsWith(DRAFT_MARK.ar)).toBe(true);
    // A mark the model already wrote is not written twice.
    reply = (ps) => ({ answer: `${DRAFT_MARK.en}\nDone: Publish the finance charter.`, cited_ids: [ps[0]!.id], grounded: true });
    const once = await svc(U.fin, (tx, p) => A.ask(tx, p, { projectId: P1, question: "Draft my progress update", language: "en" }));
    expect(once.answer.split(DRAFT_MARK.en).length).toBe(2);
  });
});

describe("legal questions", () => {
  it("gives the facts the sources state, takes out the ruling, and leaves the judgement to the consultant", async () => {
    reply = (ps) => ({
      answer: "Your charter requires an annual declaration by each director. Your company is compliant with the Companies Law.",
      cited_ids: [ps[0]!.id],
      grounded: true,
    });
    const out = await svc(U.fin, (tx, p) => A.ask(tx, p, { projectId: P1, question: "Are we compliant with the Companies Law?", language: "en" }));
    expect(out.answer).toBe(`Your charter requires an annual declaration by each director.\n\n${LEGAL_NOTE.en}`);
    expect(out.grounded).toBe(true);
    expect(out.citations.length).toBe(1);
  });

  it("a reply that is only a ruling still gets no ruling: the refusal, with the sources listed", async () => {
    reply = (ps) => ({ answer: "Your company is not compliant with the Companies Law.", cited_ids: [ps[0]!.id], grounded: true });
    const out = await svc(U.fin, (tx, p) => A.ask(tx, p, { projectId: P1, question: "Are we compliant?", language: "en" }));
    expect(out.answer).toBe(CLIENT_REFUSAL.legal_ruling.en);
    expect(out.citations.length).toBe(1);
    const [row] = (await owner.query(`SELECT meta FROM audit_log WHERE action = 'assistant.query' AND actor_id = $1 AND meta ? 'filtered' ORDER BY created_at DESC LIMIT 1`, [U.fin])).rows;
    expect(row.meta.filtered).toBe("legal_ruling");
  });
});
