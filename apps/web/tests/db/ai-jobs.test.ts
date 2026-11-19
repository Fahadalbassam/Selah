// Slow AI calls as jobs (docs/assistant.md, "Slow calls as jobs") against a
// real Postgres: a translation or a file summary asked for on a page is
// filed as a job and done by the runner one at a time, as the person who
// asked, refused if they lost access meanwhile, masked as decided before any
// transaction, kept where it always was; each person sees only their own
// jobs, may have only so many at once, and may cancel them; stale jobs end.
// The model is faked; no AI is called.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/authz";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";
import { endJob, endOrphanedAiJobs, runNextAiJob, UnfinishedJob, type AiJobDeps, type AiModel } from "@/jobs/ai-jobs";
import { indexDocument } from "@/jobs/index-documents";
import { loadPrincipal } from "@/services/principal";

vi.mock("@/services/ai-client", () => ({
  modelIsLocal: async () => true,
  translateText: async () => {
    throw new Error("the runner is given its model");
  },
  summarizePages: async () => {
    throw new Error("the runner is given its model");
  },
  draftOrgChart: async () => {
    throw new Error("the runner is given its model");
  },
}));
const J = await import("@/services/ai-jobs");
const T = await import("@/services/translations");
const S = await import("@/services/document-summaries");

// As route() does for every request, the runner refuses a person who must set up two-factor sign-in: off here, but where a test turns it on.
process.env.TWO_FACTOR_REQUIRED = "false";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 3 });
const app = new Pool({ connectionString: appUrl, max: 3 });

const id = (n: number) => `00000000-0000-4000-fa00-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const PROJ = id(4);
const REC = id(6);
const REC2 = id(7);
const REC3 = id(8);
const DOC = id(9);
const U = { admin: id(11), cons: id(12), other: id(13), cmgr: id(14) };
const RATIONALE = "يحتاج مجلس Acme Holding إلى ميثاق عائلي مكتوب.";

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
const txOf = (c: PoolClient) => drizzle(c, { schema }) as unknown as Tx;
async function svc<R>(userId: string, fn: (tx: Tx, p: Principal) => Promise<R>): Promise<R> {
  return as(userId, async (c) => {
    const tx = txOf(c);
    const p = await loadPrincipal(tx, userId);
    return fn(tx, p!).catch((e: Error & { cause?: Error }) => {
      throw new Error(e.cause ? `${e.message} | ${e.cause.message}` : e.message);
    });
  });
}

// The model, faked: it records what reached it; a test may make it slow, fail, or act while it "runs".
const calls: { kind: string; text: string }[] = [];
let during: (() => Promise<void>) | null = null;
let slowUntilStopped = false;
const model: AiModel = {
  async translate(text, source, target, stop) {
    calls.push({ kind: "translation", text });
    await during?.();
    if (slowUntilStopped) await new Promise((_, reject) => stop.addEventListener("abort", () => reject(new Error("stopped"))));
    return { text: `[${source}->${target}] ${text}`, model: "fake" };
  },
  async summarize(pages, _lang, stop) {
    calls.push({ kind: "summary", text: pages.map((p) => p.text).join(" ") });
    await during?.();
    if (slowUntilStopped) await new Promise((_, reject) => stop.addEventListener("abort", () => reject(new Error("stopped"))));
    return { points: pages.map((p) => ({ text: `About page ${p.n}`, pages: [p.n] })), model: "fake" };
  },
  async draftOrgChart() {
    throw new Error("not here");
  },
};
const order: string[] = [];
function deps(over: Partial<AiJobDeps> = {}): AiJobDeps {
  return {
    owner,
    asUser: (userId, fn) => {
      order.push("transaction");
      return as(userId, (c) => fn(txOf(c)));
    },
    maskingOn: async () => {
      order.push("masking");
      return false;
    },
    model,
    checkEveryMs: 20,
    ...over,
  };
}

/** Everyone has accepted the current terms (the runner refuses, as route() does, someone who has not). */
const accepted = (users: string[]) =>
  owner.query(
    `INSERT INTO consent_records (user_id, doc, version, locale)
     SELECT u, d, app_legal_version(d), 'en' FROM unnest($1::uuid[]) u, unnest(enum_range(NULL::legal_doc)) d`,
    [users],
  );
const translation = (entityId = REC) => ({ entityType: "recommendation", entityId, field: "rationale", to: "en" as const });
const fileTranslation = (userId: string, entityId = REC) =>
  svc(userId, async (tx, p) => {
    const r = translation(entityId);
    expect(await T.requestTranslation(tx, r)).toBeNull();
    return J.fileJob(tx, p, "translation", `translation:recommendation:${entityId}:rationale:en`, r);
  });
const jobRow = async (jid: string) => (await owner.query(`SELECT status, error, input, result, finished_at FROM ai_jobs WHERE id = $1`, [jid])).rows[0];
const kept = async () => (await owner.query(`SELECT entity_id, text, created_by FROM content_translations ORDER BY created_at`)).rows;

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme Holding')`, [FIRM, ACME]);
  for (const [name, uid] of Object.entries(U)) await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES ($1,$5,'firm_admin'), ($2,$5,'consultant'), ($3,$5,'consultant'), ($4,$6,'client_manager')`,
    [U.admin, U.cons, U.other, U.cmgr, FIRM, ACME],
  );
  await q(`INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES ($1,'client',$2,$3,'Acme governance','active',$4)`, [
    PROJ,
    ACME,
    FIRM,
    U.admin,
  ]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2), ($1,$3)`, [PROJ, U.cons, U.cmgr]);
  for (const [rec, text] of [
    [REC, RATIONALE],
    [REC2, "ميثاق ثانٍ للمجلس."],
    [REC3, "ميثاق ثالث للمجلس."],
  ])
    await q(`INSERT INTO recommendations (id, project_id, org_id, title, rationale, created_by) VALUES ($1,$2,$3,'Charter',$4,$5)`, [rec, PROJ, ACME, text, U.cons]);
  await q(
    `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility,
       ai_indexable, storage_key, content_type, size_bytes, sha256, scan_status)
     VALUES ($1,$2,$3,$4,$5,'deliverable','submitted','doc','shared',true,'key-doc','text/plain',1,'sha-1','clean')`,
    [DOC, PROJ, ACME, FIRM, U.cons],
  );
  await accepted(Object.values(U));
  const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
  await indexDocument(owner, DOC, [{ n: 1, text: "The board of Acme Holding meets monthly." }, { n: 2, text: "Exits need a family vote." }], async (t) => t.map(() => vector));
});

beforeEach(async () => {
  await owner.query(`DELETE FROM ai_jobs`);
  await owner.query(`TRUNCATE content_translations, document_summaries`);
  calls.length = 0;
  order.length = 0;
  during = null;
  slowUntilStopped = false;
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("a translation as a job", () => {
  it("is filed at once and done by the runner as the person who asked, kept where translations are kept", async () => {
    const job = await fileTranslation(U.cons);
    expect(job).toMatchObject({ kind: "translation", status: "queued", error: null, next: true });
    expect(calls).toEqual([]);

    expect(await runNextAiJob(deps())).toMatchObject({ id: job.id, status: "done", error: null });
    expect(calls).toEqual([{ kind: "translation", text: RATIONALE }]);
    expect(await kept()).toEqual([{ entity_id: REC, text: `[ar->en] ${RATIONALE}`, created_by: U.cons }]);
    // The request's text is gone once the job ends; the page then reads the kept translation.
    expect(await jobRow(job.id)).toMatchObject({ status: "done", input: null, result: null });
    expect(await svc(U.cons, (tx, p) => J.getJob(tx, p, job.id))).toMatchObject({ status: "done", next: null });
    expect(await svc(U.cons, (tx) => T.requestTranslation(tx, translation()))).toMatchObject({ text: `[ar->en] ${RATIONALE}`, original: false });
    // Nothing more to do.
    expect(await runNextAiJob(deps())).toBeNull();
    // Requested and audited as the person.
    const audited = await owner.query(`SELECT actor_id, outcome, meta FROM audit_log WHERE action = 'ai_job.request' AND resource_id = $1`, [job.id]);
    expect(audited.rows).toEqual([{ actor_id: U.cons, outcome: "allow", meta: { kind: "translation" } }]);
  });

  it("decides masking before any transaction, and masks the names it knows when told to", async () => {
    const job = await fileTranslation(U.cons);
    await runNextAiJob(deps({ maskingOn: async () => (order.push("masking"), true) }));
    expect(order[0]).toBe("masking");
    expect(order.filter((o) => o === "masking")).toHaveLength(1);
    // The decision is on the job's record.
    expect((await owner.query(`SELECT masked FROM ai_jobs WHERE id = $1`, [job.id])).rows[0].masked).toBe(true);
    expect(calls[0]!.text).not.toContain("Acme");
    expect(calls[0]!.text).toMatch(/\[[A-Z]+_\d+\]/);
    // The answer comes back with the names put back.
    expect((await kept())[0]!.text).toContain("Acme Holding");
    expect((await jobRow(job.id)).status).toBe("done");
  });

  it("sends personal numbers to the model as tags with the local model, and keeps the translation with the numbers (section 7 item 6)", async () => {
    const withNumbers = "تحويل إلى الآيبان SA0380000000608010167519 للهوية ١٠١٢٣٤٥٦٧٢، جوال 0551234567.";
    await owner.query(`UPDATE recommendations SET rationale = $2 WHERE id = $1`, [REC3, withNumbers]);
    try {
      const job = await fileTranslation(U.cons, REC3);
      expect(await runNextAiJob(deps())).toMatchObject({ id: job.id, status: "done" });
      expect(calls).toHaveLength(1);
      for (const raw of ["SA0380000000608010167519", "١٠١٢٣٤٥٦٧٢", "0551234567"]) expect(calls[0]!.text).not.toContain(raw);
      expect(calls[0]!.text).toContain("[IBAN_1]");
      expect(calls[0]!.text).toContain("[ID_1]");
      expect(calls[0]!.text).toContain("[PHONE_1]");
      // The person reads the original anyway: the kept translation has the numbers as written.
      expect((await kept())[0]!.text).toBe(`[ar->en] ${withNumbers}`);
    } finally {
      await owner.query(`UPDATE recommendations SET rationale = 'ميثاق ثالث للمجلس.' WHERE id = $1`, [REC3]);
    }
  });

  it("sends a file's pages to the summary model with the tags they were indexed with", async () => {
    await indexDocument(owner, DOC, [{ n: 1, text: "Pay the board's fees to IBAN SA0380000000608010167519." }, { n: 2, text: "Exits need a family vote." }], async (t) =>
      t.map(() => Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0))),
    );
    try {
      const job = await svc(U.cons, (tx, p) => J.fileJob(tx, p, "summary", `summary:${DOC}:en`, { documentId: DOC, lang: "en" }));
      expect(await runNextAiJob(deps())).toMatchObject({ id: job.id, status: "done" });
      expect(calls[0]!.text).toContain("[IBAN_1]");
      expect(calls[0]!.text).not.toContain("SA0380000000608010167519");
    } finally {
      await indexDocument(owner, DOC, [{ n: 1, text: "The board of Acme Holding meets monthly." }, { n: 2, text: "Exits need a family vote." }], async (t) =>
        t.map(() => Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0))),
      );
    }
  });

  it("is refused, and audited, when the person lost access between asking and the runner taking it", async () => {
    const job = await fileTranslation(U.cons);
    await owner.query(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [PROJ, U.cons]);
    try {
      expect(await runNextAiJob(deps())).toMatchObject({ status: "refused", error: "access" });
    } finally {
      await owner.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [PROJ, U.cons]);
    }
    expect(calls).toEqual([]);
    expect(await kept()).toEqual([]);
    expect(await jobRow(job.id)).toMatchObject({ status: "refused", error: "access", input: null });
    const audited = await owner.query(`SELECT actor_id, org_id, outcome, reason FROM audit_log WHERE action = 'ai_job.refused' AND resource_id = $1`, [job.id]);
    expect(audited.rows).toEqual([{ actor_id: U.cons, org_id: FIRM, outcome: "deny", reason: "access" }]);
  });

  it("keeps nothing when the person lost access while the model ran, or the text changed", async () => {
    const lost = await fileTranslation(U.cons);
    during = () => owner.query(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [PROJ, U.cons]).then(() => undefined);
    try {
      expect(await runNextAiJob(deps())).toMatchObject({ id: lost.id, status: "refused", error: "access" });
    } finally {
      await owner.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)`, [PROJ, U.cons]);
    }
    expect(await kept()).toEqual([]);

    const changed = await fileTranslation(U.cons, REC2);
    during = () => owner.query(`UPDATE recommendations SET rationale = 'نص آخر.' WHERE id = $1`, [REC2]).then(() => undefined);
    try {
      expect(await runNextAiJob(deps())).toMatchObject({ id: changed.id, status: "refused", error: "changed" });
    } finally {
      await owner.query(`UPDATE recommendations SET rationale = 'ميثاق ثانٍ للمجلس.' WHERE id = $1`, [REC2]);
    }
    expect(await kept()).toEqual([]);
  });

  it("ends 'failed' when the model fails, and the page may ask again", async () => {
    const job = await fileTranslation(U.cons);
    during = async () => {
      throw new Error("ai service /v1/translate failed: 500");
    };
    expect(await runNextAiJob(deps())).toMatchObject({ status: "failed", error: "unavailable" });
    expect(await jobRow(job.id)).toMatchObject({ status: "failed", error: "unavailable", input: null });
    const audited = await owner.query(`SELECT org_id, outcome, reason FROM audit_log WHERE action = 'ai_job.failed' AND resource_id = $1`, [job.id]);
    expect(audited.rows).toEqual([{ org_id: FIRM, outcome: "error", reason: "unavailable" }]);
    during = null;
    const again = await fileTranslation(U.cons);
    expect(again.id).not.toBe(job.id);
  });
});

describe("a file summary as a job", () => {
  it("is made from the file's pages as the person who asked, then read with the file's rights", async () => {
    expect(await svc(U.cons, (tx, p) => S.requestSummary(tx, p, DOC, "en"))).toBeNull();
    const job = await svc(U.cons, (tx, p) => J.fileJob(tx, p, "summary", `summary:${DOC}:en`, { documentId: DOC, lang: "en" }));
    expect(await runNextAiJob(deps({ maskingOn: async () => true }))).toMatchObject({ id: job.id, status: "done" });
    // Masked as decided: the client's name never reached the model.
    expect(calls[0]!.text).not.toContain("Acme");
    const made = await svc(U.cons, (tx, p) => S.requestSummary(tx, p, DOC, "en"));
    expect(made?.points).toEqual([
      { text: "About page 1", pages: [1] },
      { text: "About page 2", pages: [2] },
    ]);
    expect((await owner.query(`SELECT created_by FROM document_summaries`)).rows).toEqual([{ created_by: U.cons }]);
    // Someone who can't open the file can't ask for one.
    await expect(svc(U.other, (tx, p) => S.requestSummary(tx, p, DOC, "en"))).rejects.toThrow(/not found/);
  });

  it("keeps nothing when the file was taken off the assistant while the model read it", async () => {
    await svc(U.cons, (tx, p) => J.fileJob(tx, p, "summary", `summary:${DOC}:ar`, { documentId: DOC, lang: "ar" }));
    during = () => owner.query(`UPDATE documents SET ai_indexable = false WHERE id = $1`, [DOC]).then(() => undefined);
    try {
      expect(await runNextAiJob(deps())).toMatchObject({ status: "refused", error: "access" });
    } finally {
      await owner.query(`UPDATE documents SET ai_indexable = true WHERE id = $1`, [DOC]);
    }
    expect((await owner.query(`SELECT count(*)::int AS n FROM document_summaries`)).rows[0].n).toBe(0);
  });
});

describe("the queue", () => {
  it("runs one job at a time, whoever asked: none is taken while one runs, even by a second runner", async () => {
    const a = await fileTranslation(U.cons, REC);
    const b = await fileTranslation(U.admin, REC2);
    // Two runners asking at once take one job between them.
    const taken = await Promise.all([owner.query(`SELECT id FROM app_claim_ai_job()`), owner.query(`SELECT id FROM app_claim_ai_job()`)]);
    expect(taken.flatMap((t) => t.rows.map((r) => r.id))).toEqual([a.id]);
    expect((await owner.query(`SELECT id FROM app_claim_ai_job()`)).rows).toEqual([]);
    // b waits behind the running one, and is next; a third, filed after it, is not.
    expect(await svc(U.admin, (tx, p) => J.getJob(tx, p, b.id))).toMatchObject({ status: "queued", next: true });
    const c = await fileTranslation(U.cmgr, REC3);
    expect(await svc(U.cmgr, (tx, p) => J.getJob(tx, p, c.id))).toMatchObject({ status: "queued", next: false });
    await owner.query(`DELETE FROM ai_jobs WHERE id = $1`, [c.id]);
    // The runner that starts again ends what was left running, and the line moves on.
    expect(await endOrphanedAiJobs(owner)).toBe(1);
    expect(await jobRow(a.id)).toMatchObject({ status: "failed", error: "stopped" });
    expect(await runNextAiJob(deps())).toMatchObject({ id: b.id, status: "done" });
  });

  it("gives back the same job when asked again, and allows firm staff two at once, a client person one", async () => {
    const a = await fileTranslation(U.cons, REC);
    expect((await fileTranslation(U.cons, REC)).id).toBe(a.id);
    await fileTranslation(U.cons, REC2);
    await expect(fileTranslation(U.cons, REC3)).rejects.toThrow(/already have requests/);
    await fileTranslation(U.cmgr, REC);
    await expect(fileTranslation(U.cmgr, REC2)).rejects.toThrow(/already have requests/);
    // The database holds the line too, whatever the app does.
    await expect(
      sqlAs(U.cmgr, `INSERT INTO ai_jobs (kind, key, input, created_by, org_id) VALUES ('translation', 'x', '{}', $1, $2)`, [U.cmgr, ACME]),
    ).rejects.toThrow(/already have requests/);
    // A new job always starts queued and empty, whatever is written in.
    await owner.query(`DELETE FROM ai_jobs WHERE created_by = $1`, [U.cmgr]);
    await sqlAs(U.cmgr, `INSERT INTO ai_jobs (kind, key, status, result, masked, created_by, org_id) VALUES ('translation', 'y', 'done', '{"x":1}', false, $1, $2)`, [
      U.cmgr,
      FIRM,
    ]);
    expect((await owner.query(`SELECT status, result, masked, org_id FROM ai_jobs WHERE created_by = $1`, [U.cmgr])).rows).toEqual([
      { status: "queued", result: null, masked: null, org_id: ACME },
    ]);
  });

  it("shows each person only their own jobs, and nobody else may read, cancel or change them", async () => {
    const job = await fileTranslation(U.cons);
    expect((await sqlAs(U.cons, `SELECT id FROM ai_jobs`)).rows).toEqual([{ id: job.id }]);
    for (const who of [U.admin, U.other, U.cmgr]) {
      expect((await sqlAs(who, `SELECT id FROM ai_jobs`)).rows, who).toEqual([]);
      await expect(svc(who, (tx, p) => J.getJob(tx, p, job.id)), who).rejects.toThrow(/not found/);
      await expect(svc(who, (tx, p) => J.cancelJob(tx, p, job.id)), who).rejects.toThrow(/not found/);
      expect((await sqlAs(who, `SELECT app_ai_job_next($1) AS n`, [job.id])).rows[0].n, who).toBeNull();
      expect((await sqlAs(who, `SELECT app_ai_job_hold($1) AS s`, [job.id])).rows[0].s, who).toBeNull();
      expect((await sqlAs(who, `SELECT app_cancel_ai_job($1) AS ok`, [job.id])).rows[0].ok, who).toBe(false);
      await expect(sqlAs(who, `INSERT INTO ai_jobs (kind, key, created_by, org_id) VALUES ('translation', 'z', $1, $2)`, [U.cons, FIRM]), who).rejects.toThrow(
        /row-level security/,
      );
    }
    await expect(sqlAs(U.cons, `UPDATE ai_jobs SET status = 'done' WHERE id = $1`, [job.id])).rejects.toThrow(/permission denied/);
    await expect(sqlAs(U.cons, `DELETE FROM ai_jobs WHERE id = $1`, [job.id])).rejects.toThrow(/permission denied/);
    await expect(sqlAs(U.cons, `SELECT * FROM app_claim_ai_job()`)).rejects.toThrow(/permission denied/);
    expect((await jobRow(job.id)).status).toBe("queued");
  });

  it("lets the person cancel a waiting job (never run) or a running one (the runner hangs up, nothing kept)", async () => {
    const waiting = await fileTranslation(U.cons);
    expect(await svc(U.cons, (tx, p) => J.cancelJob(tx, p, waiting.id))).toMatchObject({ status: "cancelled", error: "cancelled" });
    expect(await jobRow(waiting.id)).toMatchObject({ status: "cancelled", input: null });
    expect(await runNextAiJob(deps())).toBeNull();
    expect(calls).toEqual([]);

    const running = await fileTranslation(U.cons);
    slowUntilStopped = true;
    during = async () => {
      await svc(U.cons, (tx, p) => J.cancelJob(tx, p, running.id));
    };
    expect(await runNextAiJob(deps())).toMatchObject({ id: running.id, status: "cancelled" });
    expect(await jobRow(running.id)).toMatchObject({ status: "cancelled", error: "cancelled" });
    expect(await kept()).toEqual([]);
    // Cancelling a finished job changes nothing.
    expect(await svc(U.cons, (tx, p) => J.cancelJob(tx, p, running.id))).toMatchObject({ status: "cancelled" });
  });

  it("gives back the same job for two identical requests at once, and spends only for a new job", async () => {
    let spent = 0;
    const spend = () => void spent++;
    const file = () => svc(U.cons, (tx, p) => J.fileJob(tx, p, "translation", `translation:recommendation:${REC}:rationale:en`, translation(REC), spend));
    const [a, b] = await Promise.all([file(), file()]);
    expect(b.id).toBe(a.id);
    expect((await file()).id).toBe(a.id);
    expect(spent).toBe(1);
    expect((await owner.query(`SELECT count(*)::int AS n FROM ai_jobs`)).rows[0].n).toBe(1);
  });

  it("checks the hourly limit when asked and again before the model runs, and tells it apart from busy", async () => {
    const fill = (n: number) =>
      owner.query(
        `INSERT INTO content_translations (project_id, org_id, entity_type, entity_id, field, source_lang, target_lang, source_sha256, text, model, created_by)
         SELECT $1, $2, 'action', gen_random_uuid(), 'title', 'en', 'ar', repeat('a', 64), 't', 'm', $3 FROM generate_series(1, $4)`,
        [PROJ, ACME, U.cons, n],
      );
    // Used up meanwhile: refused before the model, nothing spent.
    const job = await fileTranslation(U.cons);
    await fill(200);
    expect(await runNextAiJob(deps())).toMatchObject({ id: job.id, status: "refused", error: "limit" });
    expect(calls).toEqual([]);
    // Used up already: refused when asked, as the hourly limit (429), not busy (409).
    const refused = await fileTranslation(U.cons, REC2).catch((e: Error) => e.message);
    expect(refused).toMatch(/too many translations/);
    expect(refused).not.toMatch(/already have requests/);
  });

  it("keeps nothing when the person cancels after the model answered but before the answer is kept", async () => {
    const job = await fileTranslation(U.cons);
    // The cancel commits while the runner is between the model and keeping the answer (no watch tick in between).
    during = async () => {
      await svc(U.cons, (tx, p) => J.cancelJob(tx, p, job.id));
    };
    expect(await runNextAiJob(deps({ checkEveryMs: 60_000 }))).toMatchObject({ id: job.id, status: "cancelled" });
    expect(await kept()).toEqual([]);
  });

  it("is refused for a person who must set up two-factor sign-in first or accept new terms, as route() refuses them", async () => {
    const job = await fileTranslation(U.cons);
    process.env.TWO_FACTOR_REQUIRED = "true";
    try {
      expect(await runNextAiJob(deps())).toMatchObject({ id: job.id, status: "refused", error: "access" });
    } finally {
      process.env.TWO_FACTOR_REQUIRED = "false";
    }
    expect(calls).toEqual([]);
    // New terms the person has not accepted yet: refused the same way.
    const terms = await fileTranslation(U.cons);
    await owner.query(`BEGIN; ALTER TABLE consent_records DISABLE TRIGGER append_only; DELETE FROM consent_records WHERE user_id = '${U.cons}';
      ALTER TABLE consent_records ENABLE TRIGGER append_only; COMMIT`);
    try {
      expect(await runNextAiJob(deps())).toMatchObject({ id: terms.id, status: "refused", error: "access" });
    } finally {
      await accepted([U.cons]);
    }
    expect(calls).toEqual([]);
    // With two-factor on, the job runs.
    await owner.query(`UPDATE "user" SET two_factor_enabled = true WHERE id = $1`, [U.cons]);
    process.env.TWO_FACTOR_REQUIRED = "true";
    try {
      await fileTranslation(U.cons);
      expect(await runNextAiJob(deps())).toMatchObject({ status: "done" });
    } finally {
      process.env.TWO_FACTOR_REQUIRED = "false";
      await owner.query(`UPDATE "user" SET two_factor_enabled = false WHERE id = $1`, [U.cons]);
    }
  });

  it("ends a job whose ending could not be written: tried again as it ended, or ended as stopped", async () => {
    const job = await fileTranslation(U.cons);
    // The database refuses the final write each time.
    const failing = {
      query: (text: string, params?: unknown[]) =>
        text.startsWith("UPDATE ai_jobs SET status") ? Promise.reject(new Error("connection lost")) : owner.query(text, params),
    } as unknown as AiJobDeps["owner"];
    const err = await runNextAiJob(deps({ owner: failing }), 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnfinishedJob);
    expect((await jobRow(job.id)).status).toBe("running");
    // The answer was kept: tried again, it ends done.
    expect(await kept()).toHaveLength(1);
    await endJob(owner, (err as UnfinishedJob).id, (err as UnfinishedJob).outcome);
    expect((await jobRow(job.id)).status).toBe("done");
    // And anything still running after a failed round is ended, so the line moves on.
    const stuck = await fileTranslation(U.admin, REC2);
    await owner.query(`UPDATE ai_jobs SET status = 'running', started_at = now() WHERE id = $1`, [stuck.id]);
    expect(await endOrphanedAiJobs(owner)).toBe(1);
    expect(await jobRow(stuck.id)).toMatchObject({ status: "failed", error: "stopped" });
  });

  it("ends a stale job as soon as anyone looks, freeing the person's place, without the runner", async () => {
    const a = await fileTranslation(U.cmgr, REC);
    await expect(fileTranslation(U.cmgr, REC2)).rejects.toThrow(/already have requests/);
    await owner.query(`UPDATE ai_jobs SET created_at = now() - interval '31 minutes' WHERE id = $1`, [a.id]);
    // The page asking after it, with no runner about, sees it ended.
    expect(await svc(U.cmgr, (tx, p) => J.getJob(tx, p, a.id))).toMatchObject({ status: "expired", error: "expired" });
    // Its place is free again.
    await fileTranslation(U.cmgr, REC2);
    const audited = await owner.query(`SELECT actor_id, org_id, outcome FROM audit_log WHERE action = 'ai_job.expired' AND resource_id = $1`, [a.id]);
    expect(audited.rows).toEqual([{ actor_id: U.cmgr, org_id: ACME, outcome: "error" }]);
  });

  it("ends stale jobs: waiting 30 minutes, running 15, and removes ended ones after an hour", async () => {
    const old = await fileTranslation(U.cons, REC);
    const stuck = await fileTranslation(U.admin, REC2);
    await owner.query(`UPDATE ai_jobs SET created_at = now() - interval '31 minutes' WHERE id = $1`, [old.id]);
    await owner.query(`UPDATE ai_jobs SET status = 'running', started_at = now() - interval '16 minutes' WHERE id = $1`, [stuck.id]);
    expect((await owner.query(`SELECT id FROM app_claim_ai_job()`)).rows).toEqual([]);
    expect(await jobRow(old.id)).toMatchObject({ status: "expired", error: "expired", input: null });
    expect(await jobRow(stuck.id)).toMatchObject({ status: "failed", error: "stopped", input: null });
    await owner.query(`UPDATE ai_jobs SET finished_at = now() - interval '61 minutes'`);
    await owner.query(`SELECT id FROM app_claim_ai_job()`);
    expect((await owner.query(`SELECT count(*)::int AS n FROM ai_jobs`)).rows[0].n).toBe(0);
  });
});
