// From the assistant's facts-only draft to a report the client reads
// (migration 0110, Fahad 19 Nov: "firm's report only"), against a real
// Postgres:
//   - firm staff get the same facts-only progress draft as a client person:
//     built from the work the client may be shown, marked as a draft, other
//     drafts refused before the model is asked;
//   - "Use as draft" reads the person's own draft and saves nothing until the
//     report is saved, and the report remembers only its writer's own draft;
//   - a report reaches the client only once a firm person other than its
//     writer approved it (the client's lead or deputy, an internal project's
//     lead, or the firm admin), and only when someone confirms the send;
//   - the Send dialog, from the report page or from the assistant, only reads.
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
import { DRAFT_MARK } from "@/lib/client-ai";
import { loadPrincipal } from "@/services/principal";

const ONE = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
// Every request the model would get, whole: the question, the passages and the earlier turns.
const sent: { question: string; passages: { id: string; text: string; source: string }[]; history: unknown; opts: unknown }[] = [];
const DEFAULT_REPLY = (passages: { id: string }[]) => ({
  answer: "Draft: check before sending\n\nOne action is verified.",
  cited_ids: [passages[0]!.id],
  grounded: true,
});
let reply = DEFAULT_REPLY;
vi.mock("@/services/ai-client", () => ({
  modelIsLocal: async () => true,
  embed: async (texts: string[]) => texts.map(() => ONE),
  answer: async (question: string, passages: { id: string; text: string; source: string }[], _l: string, history: unknown, _a: string, opts: unknown) => {
    sent.push({ question, passages, history, opts });
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
const F = await import("@/services/follow-through");
const S = await import("@/services/report-send");
const SP = await import("@/services/status-pack");

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 3 });

const id = (n: number) => `00000000-0000-4000-a110-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const P = id(5);
const BETA_P = id(6);
const U = {
  admin: id(11), // firm admin
  lead: id(12), // Acme's lead consultant
  deputy: id(13), // Acme's deputy consultant
  cons: id(14), // consultant staffed on P
  outsider: id(15), // consultant on nothing of Acme
  cadmin: id(16),
  cman: id(17),
  bAdmin: id(18), // Beta's admin
};
const R = { shared: id(21), secret: id(22), dept: id(23) };
const ACT = { open: id(31), done: id(32), secret: id(33), deptTagged: id(34), underDeptRec: id(35) };
const DEPT = id(41);
const FIRM_FILE = id(51);
// Everything here is work some client reader may not see: none of it may reach a staff draft.
const HIDDEN = /Replace the CFO|Firm-only canary|Firm file canary|Finance canary|Finance plan canary/;

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
const run = (userId: string, text: string, params: unknown[] = []) => as(userId, (c) => c.query(text, params));
const svc = <T>(userId: string, fn: (tx: Tx, p: Principal) => Promise<T>) =>
  as(userId, async (c) => {
    const tx = drizzle(c, { schema }) as unknown as Tx;
    return fn(tx, (await loadPrincipal(tx, userId))!);
  });
const refused = (p: Promise<unknown>) =>
  p.then(
    () => "",
    (e: Error & { cause?: Error }) => e.cause?.message ?? e.message,
  );
const row = async (rid: string) =>
  (await owner.query(`SELECT visibility, approved_by, approved_at, drafted_by, draft_message_id, shared_at FROM reports WHERE id = $1`, [rid])).rows[0];
const count = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows[0].n as number;
const newReport = (who: string, extra: { draftMessageId?: string } = {}) =>
  svc(who, (tx, p) => F.snapshotReport(tx, p, P, { title: "Monthly", periodStart: "2026-11-01", periodEnd: "2026-11-30", bodyMd: "Note", ...extra }));
const clientSees = async (who: string, rid: string) =>
  (await svc(who, (tx, p) => F.listReports(tx, p, P))).reports.some((r) => r.id === rid);

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, name_ar, short_names, engagement_mode) VALUES
      ($1,'firm','Mizan Advisory',NULL,'{}',NULL), ($2,'client','Acme Holding','شركة أكمي','{Acme}','full'),
      ($3,'client','Beta Trading','شركة بيتا','{Beta}','full')`,
    [FIRM, ACME, BETA],
  );
  for (const [k, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)`, [uid, `Person ${k}`, `${k}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$9,'firm_admin'), ($2,$9,'consultant'), ($3,$9,'consultant'), ($4,$9,'consultant'), ($5,$9,'consultant'),
      ($6,$10,'client_admin'), ($7,$10,'client_manager'), ($8,$11,'client_admin')`,
    [U.admin, U.lead, U.deputy, U.cons, U.outsider, U.cadmin, U.cman, U.bAdmin, FIRM, ACME, BETA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$3,$5,'Acme governance','active',$6), ($2,'client',$4,$5,'Beta plan','active',$6)`,
    [P, BETA_P, ACME, BETA, FIRM, U.admin],
  );
  await q(
    `INSERT INTO client_assignments (client_org_id, user_id, is_lead, is_deputy) VALUES ($1,$2,true,false), ($1,$3,false,true), ($1,$4,false,false)`,
    [ACME, U.lead, U.deputy, U.cons],
  );
  await q(`INSERT INTO project_members (project_id, user_id, observer) VALUES ($1,$2,false), ($1,$3,false)`, [P, U.cons, U.cman]);
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, created_by) VALUES
      ($1,$3,$4,'Adopt a board charter','shared',$5), ($2,$3,$4,'Replace the CFO','firm_private',$5)`,
    [R.shared, R.secret, P, ACME, U.lead],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, status, created_by, due_date) VALUES
      ($1,$4,$5,$6,'Write the charter','in_progress',$8,app_firm_today() + 10),
      ($2,$4,$5,$6,'Name the secretary','verified_complete',$8,app_firm_today() - 10),
      ($3,$4,$5,$7,'Firm-only canary','in_progress',$8,app_firm_today() + 10)`,
    [ACT.open, ACT.done, ACT.secret, P, ACME, R.shared, R.secret, U.lead],
  );
  // Departments on: a shared action tagged to Finance, and an untagged action under a Finance recommendation (review B2).
  await q(`UPDATE organizations SET departments_enabled = true WHERE id = $1`, [ACME]);
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$2,'المالية','Finance')`, [DEPT, ACME]);
  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, visibility, department_id, created_by) VALUES ($1,$2,$3,'Finance plan canary','shared',$4,$5)`,
    [R.dept, P, ACME, DEPT, U.lead],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, department_id, status, created_by, due_date) VALUES
      ($1,$3,$4,$5,'Finance canary',$6,'in_progress',$7,app_firm_today() + 5),
      ($2,$3,$4,$8,'Finance plan canary step',NULL,'in_progress',$7,app_firm_today() + 5)`,
    [ACT.deptTagged, ACT.underDeptRec, P, ACME, R.shared, DEPT, U.lead, R.dept],
  );
  // A firm-private file, indexed, and every record as a passage, so the search would find them (review B1).
  await q(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility,
       ai_indexable, storage_key, content_type, size_bytes, sha256, scan_status)
     VALUES ($1,$2,$3,$4,$5,'deliverable','submitted','Firm notes','firm_private',true,'key-firm-file','text/plain',1,'sha-firm-file','clean')`,
    [FIRM_FILE, P, ACME, FIRM, U.lead],
  );
  const embed = (async (texts: string[]) => texts.map(() => ONE)) as Embed;
  await indexDocument(owner, FIRM_FILE, pagesFromText("Firm file canary: the lead thinks the CFO should go. Draft a progress update."), embed);
  await indexRecords(owner, embed);
});

beforeEach(async () => {
  sent.length = 0;
  reply = DEFAULT_REPLY;
  await owner.query(`DELETE FROM ai_usage`);
  await owner.query(`DELETE FROM ai_conversations`);
  await owner.query(`ALTER TABLE reports DISABLE TRIGGER USER`);
  await owner.query(`DELETE FROM reports`);
  await owner.query(`ALTER TABLE reports ENABLE TRIGGER USER`);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

/** A firm person's facts-only progress draft, asked through the assistant (the model is faked). */
const staffDraft = (who: string) =>
  svc(who, (tx, p) => A.ask(tx, p, { projectId: P, question: "Draft a progress update for this month", language: "en" }));

describe("the consultants' facts-only progress draft", () => {
  it("is built from work every client reader may see: never firm-only work, never a department's (review B2)", async () => {
    const staff = await svc(U.lead, (tx) => A.progressRecords(tx, [P], undefined, { clientSide: true }));
    const ids = staff.filter((r) => r.type === "action").map((r) => r.id);
    expect(ids.sort()).toEqual([ACT.open, ACT.done].sort());
    expect(JSON.stringify(staff)).not.toMatch(HIDDEN);
    // The count says the same: two actions, not five.
    expect(staff[0]!.text).toMatch(/1 done \(verified\)/);
    expect(staff[0]!.text).toMatch(/1 in progress or not started/);
    // With departments off, the Finance-tagged work is every client reader's again.
    await owner.query(`UPDATE organizations SET departments_enabled = false WHERE id = $1`, [ACME]);
    try {
      const off = (await svc(U.lead, (tx) => A.progressRecords(tx, [P], undefined, { clientSide: true }))).map((r) => r.id);
      expect(off).toEqual(expect.arrayContaining([ACT.deptTagged, ACT.underDeptRec]));
      expect(off).not.toContain(ACT.secret);
    } finally {
      await owner.query(`UPDATE organizations SET departments_enabled = true WHERE id = $1`, [ACME]);
    }
    // Without the client side, the firm's own view still holds it (the draft never asks for that).
    expect((await svc(U.lead, (tx) => A.progressRecords(tx, [P]))).some((r) => r.id === ACT.secret)).toBe(true);
  });

  it("is marked as a draft, asks the model for a draft, and is kept as one", async () => {
    reply = (ps) => ({ answer: "**Draft: check before sending**\nOne action is verified.", cited_ids: [ps[0]!.id], grounded: true });
    const out = await staffDraft(U.cons);
    expect(out.answer.startsWith(`${DRAFT_MARK.en}\n\n`)).toBe(true);
    expect(out.answer.match(/check before sending/gi)).toHaveLength(1);
    expect(out.progressDraft).toBe(true);
    expect(sent[0]!.opts).toEqual({ progressDraft: true });
    expect(sent[0]!.passages.map((x) => x.text).join(" ")).toContain("For a progress-update draft");
    expect(JSON.stringify(sent[0])).not.toMatch(HIDDEN);
    expect(await count(`SELECT count(*)::int AS n FROM ai_messages WHERE id = $1 AND progress_draft`, [out.messageId])).toBe(1);
    // The chat shows it with its flag.
    const chat = await svc(U.cons, (tx, p) => A.getConversation(tx, p, out.conversationId, "en"));
    expect(chat.messages.find((m) => m.id === out.messageId)?.progressDraft).toBe(true);
  });

  it("B1: sends the model nothing but the progress records: no file, searched record, chat subject or earlier turn", async () => {
    // A chat about the firm-only recommendation, with an earlier turn about firm-only work.
    reply = (ps) => ({ answer: "Replace the CFO canary is the firm's view.", cited_ids: [ps[0]!.id], grounded: true });
    const first = await svc(U.lead, (tx, p) =>
      A.ask(tx, p, { projectId: P, question: "What does the Firm-only canary action need?", case: { type: "recommendation", id: R.secret }, language: "en" }),
    );
    // The ordinary answer did get the chat's record and the firm's file (staff may read them): the test can see a leak.
    expect(JSON.stringify(sent[0])).toMatch(/Replace the CFO/);
    expect(JSON.stringify(sent[0])).toMatch(/Firm file canary/);
    sent.length = 0;
    reply = DEFAULT_REPLY;
    const out = await svc(U.lead, (tx, p) =>
      A.ask(tx, p, { conversationId: first.conversationId, projectId: P, question: "Draft a progress update for this month", language: "en" }),
    );
    expect(sent).toHaveLength(1);
    const request = sent[0]!;
    expect(JSON.stringify(request)).not.toMatch(HIDDEN);
    expect(request.history).toEqual([]);
    expect(request.passages.filter((x) => x.source.startsWith("action")).length).toBe(2);
    expect(request.passages.length).toBe(3);
    expect(request.question).not.toContain("This chat is about passage");
    expect(out.answer).not.toMatch(HIDDEN);
    expect(out.progressDraft).toBe(true);
  });

  it("S3: firm staff draft other things as before; only a client person's other drafts are refused", async () => {
    reply = (ps) => ({ answer: "Dear team, the charter is in progress.", cited_ids: [ps[0]!.id], grounded: true });
    const out = await svc(U.lead, (tx, p) => A.ask(tx, p, { projectId: P, question: "Draft an e-mail to the client's CEO about the charter", language: "en" }));
    expect(sent).toHaveLength(1);
    expect(out.answer).toBe("Dear team, the charter is in progress.");
    expect(out.progressDraft).toBe(false);
  });

  it("an ordinary question is not a draft", async () => {
    reply = (ps) => ({ answer: "The charter is in progress.", cited_ids: [ps[0]!.id], grounded: true });
    const out = await svc(U.lead, (tx, p) => A.ask(tx, p, { projectId: P, question: "What is open on this project?", language: "en" }));
    expect(out.progressDraft).toBe(false);
    expect(out.answer.startsWith(DRAFT_MARK.en)).toBe(false);
  });
});

describe("Use as draft: the report page pre-filled, nothing saved until saved", () => {
  it("reads the person's own draft without its mark and saves nothing", async () => {
    const out = await staffDraft(U.cons);
    const before = {
      reports: await count(`SELECT count(*)::int AS n FROM reports`),
      messages: await count(`SELECT count(*)::int AS n FROM ai_messages`),
      audit: await count(`SELECT count(*)::int AS n FROM audit_log`),
    };
    const d = await svc(U.cons, (tx, p) => S.draftForReport(tx, p, out.messageId));
    expect(d).toMatchObject({ messageId: out.messageId, projectId: P, note: "One action is verified.", packId: null });
    // Opening the pre-filled page twice changes nothing anywhere.
    await svc(U.cons, (tx, p) => S.draftForReport(tx, p, out.messageId));
    expect({
      reports: await count(`SELECT count(*)::int AS n FROM reports`),
      messages: await count(`SELECT count(*)::int AS n FROM ai_messages`),
      audit: await count(`SELECT count(*)::int AS n FROM audit_log`),
    }).toEqual(before);
  });

  it("is nothing for someone else's answer, an answer that is not a draft, or a client person", async () => {
    const out = await staffDraft(U.cons);
    expect(await svc(U.lead, (tx, p) => S.draftForReport(tx, p, out.messageId))).toBeNull();
    expect(await svc(U.cadmin, (tx, p) => S.draftForReport(tx, p, out.messageId))).toBeNull();
    reply = (ps) => ({ answer: "The charter is in progress.", cited_ids: [ps[0]!.id], grounded: true });
    const plain = await svc(U.cons, (tx, p) => A.ask(tx, p, { projectId: P, question: "What is open?", language: "en" }));
    expect(await svc(U.cons, (tx, p) => S.draftForReport(tx, p, plain.messageId))).toBeNull();
  });

  it("points at this month's status pack while it waits for its note", async () => {
    await owner.query(
      `INSERT INTO reports (project_id, org_id, kind, title, body_md, generated_by, period_start, period_end)
       VALUES ($1,$2,'status_pack','Status pack','',$3,'2026-10-01','2026-10-31')`,
      [P, ACME, U.lead],
    );
    const pack = (await owner.query(`SELECT id FROM reports WHERE kind = 'status_pack'`)).rows[0].id;
    const out = await staffDraft(U.cons);
    expect((await svc(U.cons, (tx, p) => S.draftForReport(tx, p, out.messageId)))?.packId).toBe(pack);
  });

  it("a saved report remembers only its writer's own draft", async () => {
    const out = await staffDraft(U.cons);
    const { id: rid } = await newReport(U.cons, { draftMessageId: out.messageId });
    expect((await row(rid)).draft_message_id).toBe(out.messageId);
    expect(await refused(newReport(U.lead, { draftMessageId: out.messageId }))).toMatch(/your own progress draft/);
    // And the assistant's Send dialog finds that report.
    const found = await svc(U.cons, (tx, p) => S.reportFromMessage(tx, p, out.messageId));
    expect(found.report?.id).toBe(rid);
  });
});

describe("approval before a report goes to the client", () => {
  it("is required: a report is not sent unapproved, by the service or straight in the table", async () => {
    const { id: rid } = await newReport(U.cons);
    expect(await refused(svc(U.cons, (tx, p) => F.shareReport(tx, p, rid, { confirmed: true })))).toMatch(/needs the firm's approval/);
    expect(await refused(run(U.cons, `UPDATE reports SET visibility = 'shared', shared_at = now() WHERE id = $1`, [rid]))).toMatch(/only once approved/);
    // Not even the schema owner can make a shared report without an approval.
    expect(await refused(owner.query(`UPDATE reports SET visibility = 'shared' WHERE id = $1`, [rid]))).toMatch(/reports_shared_only_approved/);
    expect(
      await refused(run(U.cons, `INSERT INTO reports (project_id, org_id, title, body_md, generated_by, visibility, metrics) VALUES ($1,$2,'x','',$3,'shared','{}')`, [P, ACME, U.cons])),
    ).toMatch(/only once approved/);
    expect((await row(rid)).visibility).toBe("firm_private");
  });

  it("the writer cannot approve their own report; the lead, the deputy or the firm admin can, once", async () => {
    const { id: rid } = await newReport(U.lead);
    expect((await svc(U.lead, (tx, p) => F.getReport(tx, p, rid))).can.approve).toBe(false);
    expect(await refused(svc(U.lead, (tx, p) => S.approveReport(tx, p, rid)))).toMatch(/other than the writer/);
    expect(await refused(run(U.lead, `UPDATE reports SET approved_by = $2 WHERE id = $1`, [rid, U.lead]))).toMatch(/other than the writer/);
    // A staffed consultant who is not the lead or deputy, and a consultant on nothing of the client, cannot.
    expect(await refused(svc(U.cons, (tx, p) => S.approveReport(tx, p, rid)))).toMatch(/not allowed|forbidden|denied|other than the writer/i);
    expect(await refused(run(U.cons, `UPDATE reports SET approved_by = $2 WHERE id = $1`, [rid, U.cons]))).toMatch(/approves a report/);
    expect(await refused(svc(U.outsider, (tx, p) => S.approveReport(tx, p, rid)))).toMatch(/not found/i);
    // Nobody approves in someone else's name, nor stamps the time themselves.
    expect(await refused(run(U.deputy, `UPDATE reports SET approved_by = $2 WHERE id = $1`, [rid, U.admin]))).toMatch(/own name/);
    expect((await svc(U.deputy, (tx, p) => F.getReport(tx, p, rid))).can.approve).toBe(true);
    await svc(U.deputy, (tx, p) => S.approveReport(tx, p, rid));
    const r = await row(rid);
    expect(r.approved_by).toBe(U.deputy);
    expect(r.approved_at).not.toBeNull();
    expect(r.drafted_by).toBe(U.lead);
    expect(await refused(svc(U.admin, (tx, p) => S.approveReport(tx, p, rid)))).toMatch(/already approved/);
    expect(await count(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'report.approve' AND resource_id = $1 AND actor_id = $2`, [rid, U.deputy])).toBe(1);
    // The firm admin approves another of the lead's reports.
    const { id: rid2 } = await newReport(U.lead);
    await svc(U.admin, (tx, p) => S.approveReport(tx, p, rid2));
    expect((await row(rid2)).approved_by).toBe(U.admin);
  });

  it("S1: a report is written only in the caller's own name, its numbers frozen as it is made", async () => {
    // The lead cannot make a report in the deputy's name and then approve it as its non-writer.
    expect(
      await refused(run(U.lead, `INSERT INTO reports (project_id, org_id, title, body_md, generated_by, metrics) VALUES ($1,$2,'x','',$3,'{}')`, [P, ACME, U.deputy])),
    ).toMatch(/own name/);
    // Nor make one without numbers for a colleague to freeze.
    expect(await refused(run(U.cons, `INSERT INTO reports (project_id, org_id, title, body_md, generated_by) VALUES ($1,$2,'x','',$3)`, [P, ACME, U.cons]))).toMatch(
      /freezes its numbers/,
    );
    // The writer is the caller, whatever the row says.
    await run(U.cons, `INSERT INTO reports (project_id, org_id, title, body_md, generated_by, drafted_by, metrics) VALUES ($1,$2,'mine','',$3,$4,'{}')`, [
      P,
      ACME,
      U.cons,
      U.lead,
    ]);
    const rid = (await owner.query(`SELECT id FROM reports WHERE title = 'mine'`)).rows[0].id as string;
    expect((await row(rid)).drafted_by).toBe(U.cons);
  });

  it("S1: a status pack's note is written as it is issued, so whoever freezes it is its writer", async () => {
    await owner.query(
      `INSERT INTO reports (project_id, org_id, kind, title, body_md, generated_by, period_start, period_end)
       VALUES ($1,$2,'status_pack','Status pack','',$3,'2026-10-01','2026-10-31')`,
      [P, ACME, U.lead],
    );
    const rid = (await owner.query(`SELECT id FROM reports WHERE kind = 'status_pack'`)).rows[0].id as string;
    // The deputy cannot write the note and leave the lead to freeze it (then approve her own text).
    expect(await refused(run(U.deputy, `UPDATE reports SET body_md = 'my text' WHERE id = $1`, [rid]))).toMatch(/written as it is issued/);
    await svc(U.deputy, (tx, p) => SP.issueStatusPack(tx, p, rid, { bodyMd: "my text" }));
    expect((await row(rid)).drafted_by).toBe(U.deputy);
    expect(await refused(svc(U.deputy, (tx, p) => S.approveReport(tx, p, rid)))).toMatch(/other than the writer/);
  });

  it("N1: the draft a report starts from is the caller's own assistant answer, in a chat on this project", async () => {
    const out = await staffDraft(U.cons);
    const question = (await owner.query(`SELECT id FROM ai_messages WHERE conversation_id = $1 AND role = 'user'`, [out.conversationId])).rows[0].id as string;
    // The question, flagged by hand, is not an answer.
    await owner.query(`UPDATE ai_messages SET progress_draft = true WHERE id = $1`, [question]);
    expect(await refused(newReport(U.cons, { draftMessageId: question }))).toMatch(/your own progress draft/);
    // An answer from a chat on another project does not start a report here.
    await owner.query(`UPDATE ai_conversations SET project_id = $2 WHERE id = $1`, [out.conversationId, BETA_P]);
    expect(await refused(newReport(U.cons, { draftMessageId: out.messageId }))).toMatch(/your own progress draft/);
  });

  it("a status pack is written by whoever issued it, and approved only once issued, by someone else", async () => {
    await owner.query(
      `INSERT INTO reports (project_id, org_id, kind, title, body_md, generated_by, period_start, period_end)
       VALUES ($1,$2,'status_pack','Status pack','',$3,'2026-10-01','2026-10-31')`,
      [P, ACME, U.lead],
    );
    const rid = (await owner.query(`SELECT id FROM reports WHERE kind = 'status_pack'`)).rows[0].id as string;
    expect(await refused(svc(U.admin, (tx, p) => S.approveReport(tx, p, rid)))).toMatch(/issue the report/);
    // The deputy issues it (the job drafted it in the lead's name): so the lead may approve it, the deputy not.
    const out = await staffDraft(U.deputy);
    await svc(U.deputy, (tx, p) => SP.issueStatusPack(tx, p, rid, { bodyMd: "From the draft", draftMessageId: out.messageId }));
    expect(await row(rid)).toMatchObject({ drafted_by: U.deputy, draft_message_id: out.messageId });
    expect(await refused(svc(U.deputy, (tx, p) => S.approveReport(tx, p, rid)))).toMatch(/other than the writer/);
    await svc(U.lead, (tx, p) => S.approveReport(tx, p, rid));
    await svc(U.deputy, (tx, p) => F.shareReport(tx, p, rid, { confirmed: true }));
    expect((await row(rid)).visibility).toBe("shared");
  });

  it("a client person never sees a report before it is approved and sent", async () => {
    const { id: rid } = await newReport(U.cons);
    for (const who of [U.cadmin, U.cman]) {
      expect(await clientSees(who, rid)).toBe(false);
      expect(await refused(svc(who, (tx, p) => F.getReport(tx, p, rid)))).toMatch(/not found/i);
    }
    await svc(U.lead, (tx, p) => S.approveReport(tx, p, rid));
    // Approved is not sent: still the firm's.
    for (const who of [U.cadmin, U.cman]) expect(await clientSees(who, rid)).toBe(false);
    expect((await as(U.cadmin, (c) => c.query(`SELECT id FROM reports WHERE id = $1`, [rid]))).rows).toEqual([]);
    await svc(U.cons, (tx, p) => F.shareReport(tx, p, rid, { confirmed: true }));
    for (const who of [U.cadmin, U.cman]) expect(await clientSees(who, rid)).toBe(true);
    // A client reader reads that it was shared, never who approved it.
    expect((await svc(U.cadmin, (tx, p) => F.getReport(tx, p, rid))).report.approval).toBeNull();
    // Another client never sees it.
    expect(await refused(svc(U.bAdmin, (tx, p) => F.getReport(tx, p, rid)))).toMatch(/not found/i);
  });
});

describe("the Send dialog only opens; sending needs the confirm", () => {
  it("is refused without the confirmation, even once approved", async () => {
    const { id: rid } = await newReport(U.cons);
    await svc(U.lead, (tx, p) => S.approveReport(tx, p, rid));
    expect(await refused(svc(U.cons, (tx, p) => F.shareReport(tx, p, rid, { confirmed: false })))).toMatch(/confirm/);
    expect(await refused(svc(U.cons, (tx, p) => F.shareReport(tx, p, rid, undefined as unknown as { confirmed: boolean })))).toMatch(/confirm/);
    expect((await row(rid)).visibility).toBe("firm_private");
  });

  it("opening it, from the report page or from the assistant, reads and changes nothing", async () => {
    const out = await staffDraft(U.cons);
    // No report from this draft yet: the dialog says so.
    expect((await svc(U.cons, (tx, p) => S.reportFromMessage(tx, p, out.messageId))).report).toBeNull();
    const { id: rid } = await newReport(U.cons, { draftMessageId: out.messageId });
    const waiting = await svc(U.cons, (tx, p) => S.sendPreview(tx, p, rid));
    expect(waiting).toMatchObject({ id: rid, issued: true, sentAt: null, approver: "lead_or_deputy", can: { send: false, approve: false } });
    expect(waiting.approval?.at).toBeNull();
    await svc(U.lead, (tx, p) => S.approveReport(tx, p, rid));
    const audits = await count(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'report.share'`);
    for (let i = 0; i < 2; i++) {
      const ready = (await svc(U.cons, (tx, p) => S.reportFromMessage(tx, p, out.messageId))).report!;
      expect(ready).toMatchObject({ id: rid, can: { send: true }, approval: { by: "Person lead" } });
      await svc(U.cons, (tx, p) => S.sendPreview(tx, p, rid));
    }
    expect((await row(rid)).visibility).toBe("firm_private");
    expect(await count(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'report.share'`)).toBe(audits);
    // Only the confirm call sends.
    await svc(U.cons, (tx, p) => F.shareReport(tx, p, rid, { confirmed: true }));
    expect((await svc(U.cons, (tx, p) => S.sendPreview(tx, p, rid))).sentAt).not.toBeNull();
  });

  it("is closed to client people and to anyone else's draft", async () => {
    const out = await staffDraft(U.cons);
    const { id: rid } = await newReport(U.cons, { draftMessageId: out.messageId });
    expect(await refused(svc(U.cadmin, (tx, p) => S.sendPreview(tx, p, rid)))).toMatch(/not found/i);
    expect(await refused(svc(U.lead, (tx, p) => S.reportFromMessage(tx, p, out.messageId)))).toMatch(/not found/i);
  });
});
