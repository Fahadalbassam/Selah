// The client assistant (wave 3, F39; migration: the client assistant)
// against a real Postgres: it is off until the firm admin switches it on and
// the client's admin consents; it answers each client role only from what
// that person can already open; the database locks the index and the chats
// when it is off; a daily limit holds; and every answer passes the client
// filter. Canary passages sit next to the real ones with the very same
// vector, so only the permission filter decides what comes back.
// Vectors and the model are faked; no AI is called.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authorize, retrievalScope, type Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { indexDocument, indexRecords, pagesFromText, type Embed } from "@/jobs/index-documents";
import { CLIENT_AI_VERSION, CLIENT_REFUSAL, clientAnswerProblem } from "@/lib/client-ai";
import { firmToday } from "@/lib/dates";
import { loadPrincipal } from "@/services/principal";

const ONE = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
const sent: { passages: { id: string; text: string }[]; audience: string }[] = [];
let reply = (passages: { id: string }[]) => ({ answer: "The charter is due in December.", cited_ids: [passages[0]!.id], grounded: true });
vi.mock("@/services/ai-client", () => ({
  embed: async (texts: string[]) => texts.map(() => ONE),
  answer: async (_q: string, passages: { id: string; text: string; source: string }[], _l: string, _h: unknown[], audience: string) => {
    sent.push({ passages, audience });
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
const S = await import("@/services/document-summaries");

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-f950-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const MANAGED = id(4);
const P1 = id(5);
const BETA_P = id(6);
const MANAGED_P = id(7);
const U = {
  admin: id(11),
  lead: id(12), // Acme's lead consultant
  cons: id(13), // on Acme's team
  cadmin: id(14),
  cmgr: id(15), // client manager, not in Finance
  fin: id(16), // client manager in Finance
  owner1: id(17),
  owner2: id(18),
  bAdmin: id(19),
  bmgr: id(20),
};
const DEPT_FIN = id(31);

// What each Acme person may find, and canaries nobody at Acme may ever get.
const D = {
  shared: id(101),
  clientPrivate: id(102),
  finance: id(103), // filed under Finance
  firmPrivate: id(104), // CANARY: the firm's own file on the client's project
  cmgrPrivate: id(105), // CANARY for everyone but cmgr: a private file
  archived: id(106), // CANARY: archived
  aiOff: id(107), // CANARY: not open to the assistant
  beta: id(108), // CANARY: another client
  sharedWithOwner1: id(109), // an evidence file owner1 sent
};
const R = { shared: id(201), firm: id(202) };
const ACT = { owner1: id(211), owner2: id(212), firm: id(213) };
const NOTE = id(221); // CANARY: a stray meeting-note passage, firm-only
const REVIEW = id(222); // CANARY: a stray review passage labelled shared

const embed: Embed = async (texts) => texts.map(() => ONE);

async function as<T>(userId: string, fn: (c: PoolClient) => Promise<T>, commit = true): Promise<T> {
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
const sqlAs = (userId: string, text: string, params: unknown[] = []) => as(userId, (c) => c.query(text, params));
const svc = <R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>) =>
  as(userId, async (c) => {
    const tx = drizzle(c, { schema }) as unknown as Tx;
    return fn(tx, (await loadPrincipal(tx, userId))!).catch((e: Error & { cause?: Error & { code?: string } }) => {
      throw Object.assign(new Error(e.cause ? `${e.message} | ${e.cause.message}` : e.message), { code: e.cause?.code });
    });
  });

const project = (pid: string, org: string) => ({ type: "project" as const, id: pid, orgId: org, firmOrgId: FIRM, projectId: pid });
const on = (uid: string) => svc(uid, async (_tx, p) => p.clientAssistant === true);
const setAi = (enabled: boolean, roles: ("client_admin" | "client_manager")[], dailyLimit = 20, org = ACME, by = U.admin) =>
  svc(by, (tx, p) => C.setClientAi(tx, p, org, { enabled, roles, dailyLimit }));
const consent = (by = U.cadmin, version = CLIENT_AI_VERSION) => svc(by, (tx, p) => C.consentClientAi(tx, p, { version, locale: "ar" }));
const notified = async (kind: string) =>
  (await owner.query(`SELECT user_id FROM notifications WHERE kind = $1 ORDER BY user_id`, [kind])).rows.map((r) => r.user_id as string);

async function reset() {
  await owner.query(`DELETE FROM client_ai_consents`);
  await owner.query(`DELETE FROM client_ai_settings`);
  await owner.query(`DELETE FROM ai_usage`);
  await owner.query(`DELETE FROM ai_conversations`);
  await owner.query(`DELETE FROM notifications`);
}

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(
    `INSERT INTO organizations (id, kind, name, name_ar, short_names, engagement_mode) VALUES
      ($1,'firm','Mizan Advisory',NULL,'{}',NULL), ($2,'client','Acme Holding','شركة أكمي','{Acme}','full'),
      ($3,'client','Beta Trading','شركة بيتا للتجارة','{Beta}','full'), ($4,'client','Gamma Foods',NULL,'{}','consultant_managed')`,
    [FIRM, ACME, BETA, MANAGED],
  );
  await q(`UPDATE organizations SET departments_enabled = true WHERE id = $1`, [ACME]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$11,'firm_admin'), ($2,$11,'consultant'), ($3,$11,'consultant'),
      ($4,$12,'client_admin'), ($5,$12,'client_manager'), ($6,$12,'client_manager'), ($7,$12,'action_owner'), ($8,$12,'action_owner'),
      ($9,$13,'client_admin'), ($10,$13,'client_manager')`,
    [U.admin, U.lead, U.cons, U.cadmin, U.cmgr, U.fin, U.owner1, U.owner2, U.bAdmin, U.bmgr, FIRM, ACME, BETA],
  );
  await q(`INSERT INTO departments (id, org_id, name_ar, name_en) VALUES ($1,$2,'المالية','Finance')`, [DEPT_FIN, ACME]);
  await q(`INSERT INTO department_members (department_id, user_id) VALUES ($1,$2)`, [DEPT_FIN, U.fin]);
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$4,$7,'Acme governance','active',$8), ($2,'client',$5,$7,'Beta strategy','active',$8), ($3,'client',$6,$7,'Gamma plan','active',$8)`,
    [P1, BETA_P, MANAGED_P, ACME, BETA, MANAGED, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id, is_lead) VALUES ($1,$2,true), ($1,$3,false), ($4,$2,true)`, [ACME, U.lead, U.cons, BETA]);
  await q(
    `INSERT INTO project_members (project_id, user_id) VALUES ($1,$3), ($1,$4), ($1,$5), ($1,$6), ($1,$7), ($1,$8), ($2,$9)`,
    [P1, BETA_P, U.cons, U.cmgr, U.fin, U.owner1, U.owner2, U.lead, U.bmgr],
  );

  type Doc = [pid: string, org: string, ownerOrg: string, by: string, purpose: string, vis: string, dept: string | null];
  const DOCS: Record<string, Doc> = {
    [D.shared]: [P1, ACME, FIRM, U.cons, "deliverable", "shared", null],
    [D.clientPrivate]: [P1, ACME, ACME, U.cmgr, "client_document", "client_private", null],
    [D.finance]: [P1, ACME, FIRM, U.cons, "deliverable", "shared", DEPT_FIN],
    [D.firmPrivate]: [P1, ACME, FIRM, U.cons, "deliverable", "firm_private", null],
    [D.cmgrPrivate]: [P1, ACME, ACME, U.cmgr, "client_document", "user_private", null],
    [D.archived]: [P1, ACME, FIRM, U.cons, "deliverable", "shared", null],
    [D.aiOff]: [P1, ACME, FIRM, U.cons, "deliverable", "shared", null],
    [D.beta]: [BETA_P, BETA, FIRM, U.lead, "deliverable", "shared", null],
    [D.sharedWithOwner1]: [P1, ACME, ACME, U.owner1, "client_document", "shared", null],
  };
  for (const [docId, [pid, org, ownerOrg, by, purpose, vis, dept]] of Object.entries(DOCS)) {
    await q(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility,
         ai_indexable, storage_key, content_type, size_bytes, sha256, scan_status, department_id)
       VALUES ($1,$2,$3,$4,$5,$6,'submitted','doc',$7,true,$8,'text/plain',1,$9,'clean',$10)`,
      [docId, pid, org, ownerOrg, by, purpose, vis, `key-${docId}`, `sha-${docId}`, dept],
    );
    await indexDocument(owner, docId, pagesFromText(`The board charter and its schedule. ${docId}`), embed);
  }
  await q(`UPDATE documents SET state = 'archived' WHERE id = $1`, [D.archived]);
  await q(`UPDATE documents SET ai_indexable = false WHERE id = $1`, [D.aiOff]);

  await q(
    `INSERT INTO recommendations (id, project_id, org_id, title, rationale, visibility, created_by) VALUES
      ($1,$3,$4,'Approve the board charter','No written charter','shared',$5), ($2,$3,$4,'Replace the CFO','Firm view only','firm_private',$5)`,
    [R.shared, R.firm, P1, ACME, U.cons],
  );
  await q(
    `INSERT INTO actions (id, project_id, org_id, recommendation_id, title, owner_user_id, status, due_date, created_by) VALUES
      ($1,$4,$5,$6,'Present the charter',$8,'assigned','2026-12-01',$10), ($2,$4,$5,$6,'Publish the charter',$9,'assigned','2026-12-01',$10),
      ($3,$4,$5,$7,'Interview CFO candidates',NULL,'assigned','2026-12-01',$10)`,
    [ACT.owner1, ACT.owner2, ACT.firm, P1, ACME, R.shared, R.firm, U.owner1, U.owner2, U.cons],
  );
  await indexRecords(owner, embed);
  // Stray passages of kinds the client assistant never searches.
  const vec = `[${ONE.join(",")}]`;
  await q(
    `INSERT INTO ai_chunks (project_id, org_id, source_type, source_id, visibility, chunk_index, content, embedding) VALUES
      ($1,$2,'meeting_note',$3,'firm_private',0,'CANARY firm note: the client is a difficult payer',$5),
      ($1,$2,'review',$4,'shared',0,'CANARY review passage',$5)`,
    [P1, ACME, NOTE, REVIEW, vec],
  );
});

beforeEach(reset);

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("switching it on", () => {
  it("is off by default: no client person gets it, and the database hides the index and chats from them", async () => {
    for (const uid of [U.cadmin, U.cmgr, U.owner1]) {
      expect(await on(uid), uid).toBe(false);
      const scope = await svc(uid, async (_tx, p) => retrievalScope(p, project(P1, ACME)));
      expect(scope, uid).toBeNull();
      expect((await sqlAs(uid, `SELECT 1 FROM ai_chunks`)).rowCount, uid).toBe(0);
    }
    await expect(svc(U.cmgr, (tx, p) => A.ask(tx, p, { projectId: P1, question: "When is the charter due?", language: "en" }))).rejects.toThrow();
    // Firm staff keep theirs.
    expect((await sqlAs(U.cons, `SELECT 1 FROM ai_chunks WHERE project_id = $1`, [P1])).rowCount).toBeGreaterThan(0);
  });

  it("only the firm admin switches it on; then only the client's admin consents, to the current notice", async () => {
    for (const who of [U.lead, U.cons, U.cadmin, U.cmgr]) {
      await expect(setAi(true, ["client_manager"], 20, ACME, who), who).rejects.toThrow();
      await expect(sqlAs(who, `SELECT app_set_client_ai($1, true, '{client_manager}', 20)`, [ACME]), who).rejects.toThrow(/firm admin/);
    }
    await expect(consent()).rejects.toThrow(/not offered/);
    const view = await setAi(true, ["client_manager"]);
    expect(view).toMatchObject({ enabled: true, roles: ["client_manager"], consent: null, canManage: true });
    expect(await notified("client_ai.offered")).toEqual([U.cadmin]);
    // Switched on is not on: the client has not agreed yet.
    expect(await on(U.cmgr)).toBe(false);
    await expect(consent(U.cmgr)).rejects.toThrow();
    await expect(sqlAs(U.cmgr, `SELECT app_consent_client_ai($1, 'ar')`, [CLIENT_AI_VERSION])).rejects.toThrow(/client.s admin/);
    await expect(consent(U.cadmin, "2020-01-01")).rejects.toThrow(/current notice/);
    // Another client's admin consents for their own organisation only, and it was not offered to them.
    await expect(consent(U.bAdmin)).rejects.toThrow(/not offered/);
    await consent();
    await expect(consent()).rejects.toThrow(/already consented/);
    expect((await notified("client_ai.consented")).sort()).toEqual([U.admin, U.lead].sort());
    // On for the roles named, and nobody else.
    expect(await on(U.cmgr)).toBe(true);
    expect(await on(U.fin)).toBe(true);
    expect(await on(U.cadmin)).toBe(false);
    expect(await on(U.owner1)).toBe(false);
    expect(await on(U.bmgr)).toBe(false);
    const mine = await svc(U.cadmin, (tx, p) => C.myClientAi(tx, p));
    expect(mine).toMatchObject({ offered: true, on: false, canConsent: false, canWithdraw: true, consent: { givenBy: "cadmin" } });
  });

  it("giving it to a role the client did not agree to, or switching it off, ends the consent", async () => {
    await setAi(true, ["client_manager"]);
    await consent();
    // Narrowing keeps it.
    await setAi(true, ["client_manager"], 10);
    expect(await on(U.cmgr)).toBe(true);
    await setAi(true, ["client_manager", "client_admin"]);
    expect(await on(U.cmgr)).toBe(false);
    expect(await on(U.cadmin)).toBe(false);
    await consent();
    expect(await on(U.cadmin)).toBe(true);
    await setAi(false, []);
    expect(await on(U.cmgr)).toBe(false);
    await setAi(true, ["client_manager", "client_admin"]);
    expect(await on(U.cmgr)).toBe(false);
    const history = await svc(U.admin, (tx, p) => C.getClientAi(tx, p, ACME));
    expect(history.history.filter((h) => h.endedAt !== null)).toHaveLength(2);
    expect(history.history[0]).toMatchObject({ endedBy: "admin" });
  });

  it("the client's admin withdraws at any time, and the firm hears", async () => {
    await setAi(true, ["client_manager"]);
    await consent();
    await expect(sqlAs(U.cmgr, `SELECT app_withdraw_client_ai()`)).rejects.toThrow(/client.s admin/);
    await svc(U.cadmin, (tx, p) => C.withdrawClientAi(tx, p));
    expect(await on(U.cmgr)).toBe(false);
    expect((await notified("client_ai.withdrawn")).sort()).toEqual([U.admin, U.lead].sort());
    await expect(svc(U.cadmin, (tx, p) => C.withdrawClientAi(tx, p))).rejects.toThrow(/no consent/);
  });

  it("can't be switched on for a consultant-managed client, with no role, or for action owners", async () => {
    await expect(sqlAs(U.admin, `SELECT app_set_client_ai($1, true, '{client_manager,action_owner}', 20)`, [ACME])).rejects.toThrow(/action owners/);
    await expect(setAi(true, ["client_manager"], 20, MANAGED)).rejects.toThrow(/can.t have the assistant/);
    await expect(setAi(true, [])).rejects.toThrow(/at least one/);
    expect((await svc(U.admin, (tx, p) => C.getClientAi(tx, p, MANAGED))).eligible).toBe(false);
  });

  it("hides a client person's chats from them while it is off", async () => {
    await setAi(true, ["client_manager"]);
    await consent();
    await svc(U.cmgr, (tx, p) => A.ask(tx, p, { projectId: P1, question: "When is the charter due?", language: "en" }));
    expect((await sqlAs(U.cmgr, `SELECT 1 FROM ai_conversations`)).rowCount).toBe(1);
    await svc(U.cadmin, (tx, p) => C.withdrawClientAi(tx, p));
    expect((await sqlAs(U.cmgr, `SELECT 1 FROM ai_conversations`)).rowCount).toBe(0);
    expect((await sqlAs(U.cmgr, `SELECT 1 FROM ai_messages`)).rowCount).toBe(0);
    await expect(sqlAs(U.cmgr, `INSERT INTO ai_conversations (user_id, project_id) VALUES ($1, $2)`, [U.cmgr, P1])).rejects.toThrow(/row-level security/);
  });
});

describe("what each client role can get (leak probes)", () => {
  const ALL = ["shared", "firm_private", "client_private", "user_private"] as const;
  // What each person can open on the screens, so may be found.
  const MAY: Record<string, string[]> = {
    [U.cadmin]: [D.shared, D.clientPrivate, D.finance, D.sharedWithOwner1, R.shared, ACT.owner1, ACT.owner2],
    [U.cmgr]: [D.shared, D.clientPrivate, D.cmgrPrivate, D.sharedWithOwner1, R.shared, ACT.owner1, ACT.owner2],
    [U.fin]: [D.shared, D.clientPrivate, D.finance, D.sharedWithOwner1, R.shared, ACT.owner1, ACT.owner2],
  };
  const CANARIES = [D.firmPrivate, D.archived, D.aiOff, D.beta, R.firm, ACT.firm, NOTE, REVIEW];

  it("returns only what the person can open, for every client role, with the real scope and a forged one", async () => {
    await setAi(true, ["client_admin", "client_manager"]);
    await consent();
    for (const uid of [U.cadmin, U.cmgr, U.fin]) {
      await as(uid, async (c) => {
        const tx = drizzle(c, { schema }) as unknown as Tx;
        const p = (await loadPrincipal(tx, uid))!;
        expect(p.clientAssistant, uid).toBe(true);
        const scope = retrievalScope(p, project(P1, ACME))!;
        expect(scope).toMatchObject({ client: true, labels: ["shared", "client_private", "user_private"] });
        const opens = async (sourceId: string) =>
          (
            await c.query(
              `SELECT 1 FROM documents WHERE id = $1 AND ai_indexable AND state <> 'archived'
               UNION ALL SELECT 1 FROM recommendations WHERE id = $1 UNION ALL SELECT 1 FROM actions WHERE id = $1`,
              [sourceId],
            )
          ).rowCount === 1;
        for (const sources of [undefined, "files", "records"] as const) {
          const real = await A.retrieve(tx, scope, ONE, { query: "board charter schedule CFO note", sources });
          const forged = await A.retrieve(tx, { ...scope, labels: ALL, client: false }, ONE, { query: "board charter CFO note", sources });
          for (const r of [...real, ...forged]) {
            expect(CANARIES, `${uid} got canary ${r.sourceId}`).not.toContain(r.sourceId);
            expect(await opens(r.sourceId), `${uid} got ${r.sourceId} it can't open`).toBe(true);
            expect(MAY[uid], `${uid} got ${r.sourceId}`).toContain(r.sourceId);
          }
        }
        // Another client's project gives nothing, even asked for directly.
        expect(retrievalScope(p, project(BETA_P, BETA))).toBeNull();
        expect(await A.retrieve(tx, { projectId: BETA_P, orgId: BETA, labels: ALL, userId: uid }, ONE)).toEqual([]);
        // Row-level security on the index itself, without the search.
        const raw = (await c.query(`SELECT DISTINCT source_id FROM ai_chunks`)).rows.map((r) => r.source_id as string);
        for (const s of raw) expect(CANARIES, `${uid} reads chunk ${s}`).not.toContain(s);
        for (const s of raw) expect(await opens(s), `${uid} reads chunk ${s}`).toBe(true);
      });
    }
  });

  it("finds a client manager's own material, and keeps a department's file in its department", async () => {
    await setAi(true, ["client_manager"]);
    await consent();
    const found = async (uid: string) =>
      svc(uid, async (tx, p) => new Set((await A.retrieve(tx, retrievalScope(p, project(P1, ACME))!, ONE, { sources: "files" })).map((r) => r.sourceId)));
    const cmgr = await found(U.cmgr);
    expect(cmgr.has(D.shared) || cmgr.has(D.clientPrivate) || cmgr.has(D.cmgrPrivate)).toBe(true);
    expect(cmgr.has(D.finance)).toBe(false);
    expect((await found(U.fin)).has(D.cmgrPrivate)).toBe(false);
  });

  it("never gives an action owner the assistant: they see only their own work, narrower than the index", async () => {
    await setAi(true, ["client_admin", "client_manager"]);
    await consent();
    for (const uid of [U.owner1, U.owner2]) {
      expect(await on(uid)).toBe(false);
      expect((await sqlAs(uid, `SELECT 1 FROM ai_chunks`)).rowCount).toBe(0);
      const p = await svc(uid, async (_tx, p) => p);
      expect(retrievalScope({ ...p, clientAssistant: true }, project(P1, ACME))).toBeNull();
    }
  });

  it("sends the model only permitted passages, tells it the person is a client, and logs which passages went", async () => {
    await setAi(true, ["client_manager"]);
    await consent();
    sent.length = 0;
    const out = await svc(U.cmgr, (tx, p) => A.ask(tx, p, { projectId: P1, question: "What is the status of the board charter?", language: "en" }));
    expect(out.grounded).toBe(true);
    expect(sent[0]!.audience).toBe("client");
    const text = sent[0]!.passages.map((x) => x.text).join("\n");
    for (const canary of ["CANARY", "Replace the CFO", "Interview CFO candidates", D.firmPrivate, D.beta, D.archived, D.aiOff]) expect(text).not.toContain(canary);
    const [row] = (await owner.query(`SELECT meta FROM audit_log WHERE action = 'assistant.query' AND actor_id = $1 ORDER BY created_at DESC LIMIT 1`, [U.cmgr])).rows;
    expect(row.meta.sent.split(",").length).toBeGreaterThan(0);
    // Staff get the staff prompt.
    sent.length = 0;
    await svc(U.cons, (tx, p) => A.ask(tx, p, { projectId: P1, question: "What is the status of the board charter?", language: "en" }));
    expect(sent[0]!.audience).toBe("staff");
  });

  it("never summarises files for a client, even with the assistant on", async () => {
    await setAi(true, ["client_admin"]);
    await consent();
    await expect(svc(U.cadmin, (tx, p) => S.summarizeDocument(tx, p, D.shared, "ar"))).rejects.toThrow();
    const p = await svc(U.cadmin, async (_tx, p) => p);
    expect(authorize(p, "document.summarize", { type: "document", orgId: ACME, firmOrgId: FIRM, projectId: P1 }).allowed).toBe(false);
  });
});

describe("limits and the answer filter", () => {
  it("holds the client's daily limit; firm staff are counted, not limited", async () => {
    await setAi(true, ["client_manager"], 2);
    await consent();
    const ask = (uid: string) => svc(uid, (tx, p) => A.ask(tx, p, { projectId: P1, question: "When is the charter due?", language: "en" }));
    await ask(U.cmgr);
    await ask(U.cmgr);
    await expect(ask(U.cmgr)).rejects.toThrow();
    await expect(sqlAs(U.cmgr, `SELECT app_count_ai_question($1::date)`, [firmToday()])).rejects.toMatchObject({ code: "SL429" });
    // A refused question isn't counted; another person has their own count.
    expect((await owner.query(`SELECT queries FROM ai_usage WHERE user_id = $1`, [U.cmgr])).rows[0].queries).toBe(2);
    await ask(U.fin);
    for (let i = 0; i < 3; i++) await ask(U.cons);
    expect((await svc(U.cmgr, (tx, p) => C.myClientAi(tx, p)))!.usedToday).toBe(2);
  });

  it("gives a failed streamed question back, only the caller's own and never below zero", async () => {
    await setAi(true, ["client_manager"], 2);
    await consent();
    const day = firmToday();
    const used = async (uid: string) => (await owner.query(`SELECT queries FROM ai_usage WHERE user_id = $1`, [uid])).rows[0]?.queries ?? 0;
    await sqlAs(U.cmgr, `SELECT app_count_ai_question($1::date)`, [day]);
    await sqlAs(U.cmgr, `SELECT app_count_ai_question($1::date)`, [day]);
    await sqlAs(U.cons, `SELECT app_count_ai_question($1::date)`, [day]);
    await sqlAs(U.cmgr, `SELECT app_uncount_ai_question($1::date)`, [day]);
    expect(await used(U.cmgr)).toBe(1);
    expect(await used(U.cons)).toBe(1);
    for (let i = 0; i < 3; i++) await sqlAs(U.cmgr, `SELECT app_uncount_ai_question($1::date)`, [day]);
    expect(await used(U.cmgr)).toBe(0);
    // With it given back, the limit allows another question.
    await sqlAs(U.cmgr, `SELECT app_count_ai_question($1::date)`, [day]);
    await sqlAs(U.cmgr, `SELECT app_count_ai_question($1::date)`, [day]);
    expect(await used(U.cmgr)).toBe(2);
  });

  it("refuses a legal ruling, a guess at the firm's intentions, and any other client's name", async () => {
    await setAi(true, ["client_manager"]);
    await consent();
    const ask = (question: string) => svc(U.cmgr, (tx, p) => A.ask(tx, p, { projectId: P1, question, language: "en" }));
    try {
      reply = (ps) => ({ answer: "Your company is not compliant with the Companies Law.", cited_ids: [ps[0]!.id], grounded: true });
      let out = await ask("Are we compliant?");
      expect(out).toMatchObject({ grounded: false, citations: [], answer: CLIENT_REFUSAL.legal_ruling.en });
      reply = (ps) => ({ answer: "The firm probably plans to extend the project.", cited_ids: [ps[0]!.id], grounded: true });
      out = await ask("What does the firm really want?");
      expect(out.answer).toBe(CLIENT_REFUSAL.firm_intent.en);
      // Another client's name, in any of its forms: the plain "can't confirm", the same as for any unknown company.
      for (const name of ["Beta Trading", "beta", "شركة بيتا للتجارة", "Gamma Foods"]) {
        reply = (ps) => ({ answer: `Like ${name}, you should approve the charter.`, cited_ids: [ps[0]!.id], grounded: true });
        out = await ask("How do others do it?");
        expect(out.answer, name).toBe(A.cannotConfirm("en", "q"));
      }
      // Their own name and the firm's are fine.
      reply = (ps) => ({ answer: "Acme Holding approves the charter with Mizan Advisory in December.", cited_ids: [ps[0]!.id], grounded: true });
      out = await ask("When is the charter due?");
      expect(out.grounded).toBe(true);
      // Staff are not filtered.
      reply = (ps) => ({ answer: "Unlike Beta Trading, Acme is not compliant yet.", cited_ids: [ps[0]!.id], grounded: true });
      expect((await svc(U.cons, (tx, p) => A.ask(tx, p, { projectId: P1, question: "q", language: "en" }))).grounded).toBe(true);
      const [row] = (await owner.query(`SELECT meta FROM audit_log WHERE action = 'assistant.query' AND actor_id = $1 AND meta ? 'filtered' ORDER BY created_at LIMIT 1`, [U.cmgr])).rows;
      expect(row.meta.filtered).toBe("legal_ruling");
    } finally {
      reply = (passages) => ({ answer: "The charter is due in December.", cited_ids: [passages[0]!.id], grounded: true });
    }
  });

  it("the other-client check is the database's, for client people only", async () => {
    const hit = async (uid: string, text: string) => (await sqlAs(uid, `SELECT app_names_other_client($1) AS h`, [text])).rows[0].h as boolean;
    expect(await hit(U.cmgr, "as Beta Trading did")).toBe(true);
    expect(await hit(U.cmgr, "the alphabeta method")).toBe(false); // whole words only for Latin names
    expect(await hit(U.cmgr, "مثل شركة بيتا للتجارة")).toBe(true);
    expect(await hit(U.cmgr, "Acme Holding")).toBe(false);
    expect(await hit(U.bmgr, "Acme Holding")).toBe(true);
    expect(await hit(U.cons, "Beta Trading")).toBe(false);
  });

  it("the filter's word lists, in both languages", () => {
    expect(clientAnswerProblem("The policy was approved in March.")).toBeNull();
    expect(clientAnswerProblem("The company is compliant with the regulations.")).toBe("legal_ruling");
    expect(clientAnswerProblem("هذا الإجراء مخالف للنظام")).toBe("legal_ruling");
    expect(clientAnswerProblem("الشركة متوافقة مع النظام")).toBe("legal_ruling");
    expect(clientAnswerProblem("المكتب ينوي تمديد المشروع")).toBe("firm_intent");
    expect(clientAnswerProblem("I think the firm is unhappy")).toBe("firm_intent");
    expect(clientAnswerProblem("Your assessment score was 2 of 5.")).toBe("firm_internal");
    expect(clientAnswerProblem("حسب ملاحظات داخلية للمكتب")).toBe("firm_internal");
  });

  it("the notice version in the app and in the database agree", async () => {
    expect((await owner.query(`SELECT app_client_ai_version() AS v`)).rows[0].v).toBe(CLIENT_AI_VERSION);
  });
});
