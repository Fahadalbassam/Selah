// The assistant's sources (migrations 0040-0041) against a real Postgres:
// the search index never returns a passage the person can't open, file
// summaries are kept once and read with the file's rights, meeting summary
// lines point at their sources, and answers translate through the cache.
// Vectors and the model are faked; no AI is called.
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

vi.mock("@/services/ai-client", () => ({
  translateText: async (text: string, source: string, target: string) => ({
    text: `[${source}->${target}] ${text}`,
    model: "fake",
  }),
  summarizePages: async () => {
    throw new Error("not in tests");
  },
}));
const { retrieve } = await import("@/services/assistant");
const { summarizeDocument } = await import("@/services/document-summaries");
const T = await import("@/services/translations");

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const appUrl = process.env.TEST_DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("set TEST_DATABASE_OWNER_URL and TEST_DATABASE_APP_URL");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

const id = (n: number) => `00000000-0000-4000-f700-${String(n).padStart(12, "0")}`;
const FIRM = id(1);
const ACME = id(2);
const BETA = id(3);
const P1 = id(4);
const P2 = id(5);
const BETA_P = id(6);
const INTERNAL = id(7);
const MEETING = id(8);
const U = {
  admin: id(11),
  cons: id(12),
  other: id(13),
  cadmin: id(14),
  cmgr: id(15),
  actionOwner: id(16),
  bmgr: id(17),
};
const PROJECT_ORG: Record<string, string> = { [P1]: ACME, [P2]: ACME, [BETA_P]: BETA, [INTERNAL]: FIRM };

// Every kind of file the index can hold, and some it must never answer from.
const D = {
  shared: id(101),
  firmPrivate: id(102),
  clientPrivate: id(103),
  consPrivate: id(104),
  cmgrPrivate: id(105),
  draftEvidence: id(106),
  archived: id(107),
  aiOff: id(108),
  p2Shared: id(109),
  betaShared: id(110),
  betaPrivate: id(111),
  internal: id(112),
};
type Doc = [project: string, ownerOrg: string, by: string, purpose: string, state: string, vis: string];
const DOCS: Record<string, Doc> = {
  [D.shared]: [P1, FIRM, U.cons, "deliverable", "submitted", "shared"],
  [D.firmPrivate]: [P1, FIRM, U.cons, "deliverable", "submitted", "firm_private"],
  [D.clientPrivate]: [P1, ACME, U.cmgr, "client_document", "submitted", "client_private"],
  [D.consPrivate]: [P1, FIRM, U.cons, "deliverable", "submitted", "user_private"],
  [D.cmgrPrivate]: [P1, ACME, U.cmgr, "client_document", "submitted", "user_private"],
  [D.draftEvidence]: [P1, ACME, U.actionOwner, "evidence", "draft", "shared"],
  [D.archived]: [P1, FIRM, U.cons, "deliverable", "submitted", "shared"],
  [D.aiOff]: [P1, FIRM, U.cons, "deliverable", "submitted", "shared"],
  [D.p2Shared]: [P2, FIRM, U.admin, "deliverable", "submitted", "shared"],
  [D.betaShared]: [BETA_P, FIRM, U.other, "deliverable", "submitted", "shared"],
  [D.betaPrivate]: [BETA_P, BETA, U.bmgr, "client_document", "submitted", "client_private"],
  [D.internal]: [INTERNAL, FIRM, U.admin, "deliverable", "submitted", "shared"],
};
const TEXT = "First page about the board.\fSecond page about the family council.\f\fFourth page about exits.";
// Every passage is the same distance from the question: only the filter decides.
const embed: Embed = async (texts) => texts.map(() => Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)));
const QUERY = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));

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

beforeAll(async () => {
  const q = (sql: string, params: unknown[] = []) => owner.query(sql, params);
  await q(`TRUNCATE "user", organizations CASCADE`);
  await q(`INSERT INTO organizations (id, kind, name) VALUES ($1,'firm','firm'), ($2,'client','Acme'), ($3,'client','Beta')`, [
    FIRM,
    ACME,
    BETA,
  ]);
  for (const [name, uid] of Object.entries(U)) {
    await q(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [uid, name, `${name}@example.test`]);
  }
  await q(
    `INSERT INTO org_memberships (user_id, org_id, role) VALUES
      ($1,$8,'firm_admin'), ($2,$8,'consultant'), ($3,$8,'consultant'), ($4,$9,'client_admin'),
      ($5,$9,'client_manager'), ($6,$9,'action_owner'), ($7,$10,'client_manager')`,
    [U.admin, U.cons, U.other, U.cadmin, U.cmgr, U.actionOwner, U.bmgr, FIRM, ACME, BETA],
  );
  await q(
    `INSERT INTO projects (id, kind, org_id, firm_org_id, title, state, created_by) VALUES
      ($1,'client',$5,$7,'Acme governance','active',$8), ($2,'client',$5,$7,'Acme HR policy','active',$8),
      ($3,'client',$6,$7,'Beta strategy','active',$8), ($4,'internal',$7,$7,'Firm methodology','active',$8)`,
    [P1, P2, BETA_P, INTERNAL, ACME, BETA, FIRM, U.admin],
  );
  await q(`INSERT INTO client_assignments (client_org_id, user_id) VALUES ($1,$3), ($2,$4)`, [ACME, BETA, U.cons, U.other]);
  await q(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$4), ($1,$5), ($1,$6), ($2,$7), ($3,$8)`, [
    P1,
    BETA_P,
    INTERNAL,
    U.cons,
    U.cmgr,
    U.actionOwner,
    U.other,
    U.bmgr,
  ]);
  for (const [docId, [project, ownerOrg, by, purpose, state, vis]] of Object.entries(DOCS)) {
    await q(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility,
         ai_indexable, storage_key, content_type, size_bytes, sha256, scan_status)
       VALUES ($1,$2,$3,$4,$5,$6::document_purpose,$7,'doc',$8,$6::document_purpose <> 'evidence',$9,'text/plain',1,$10,'clean')`,
      [docId, project, PROJECT_ORG[project], ownerOrg, by, purpose, state, vis, `key-${docId}`, `sha-${docId}`],
    );
    await indexDocument(owner, docId, pagesFromText(`${TEXT}\n\n${docId}`), embed);
  }
  // Unverified evidence is never indexed; a stray passage of it must still not come back.
  await q(
    `INSERT INTO ai_chunks (project_id, org_id, source_type, source_id, visibility, chunk_index, content, embedding)
     VALUES ($1,$2,'document',$3,'shared',0,'unverified evidence',$4)`,
    [P1, ACME, D.draftEvidence, `[${QUERY.join(",")}]`],
  );
  await q(`UPDATE documents SET state = 'archived' WHERE id = $1`, [D.archived]);
  await q(`UPDATE documents SET ai_indexable = false WHERE id = $1`, [D.aiOff]);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe("search index", () => {
  it("keeps each passage's page, and marks a file with no text not searchable", async () => {
    const pages = (await owner.query(`SELECT page FROM ai_chunks WHERE source_id = $1 ORDER BY chunk_index`, [D.shared])).rows;
    expect(pages.map((r) => r.page)).toEqual([1, 2, 4]);
    const empty = id(199);
    await owner.query(
      `INSERT INTO documents (id, project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility,
         ai_indexable, storage_key, content_type, size_bytes, sha256, scan_status)
       VALUES ($1,$2,$3,$4,$5,'deliverable','submitted','scan','shared',true,'k-empty','image/png',1,'x','clean')`,
      [empty, P2, ACME, FIRM, U.admin],
    );
    expect(await indexDocument(owner, empty, [], embed)).toBe(0);
    expect((await owner.query(`SELECT text_status FROM documents WHERE id = $1`, [empty])).rows[0].text_status).toBe(
      "not_searchable",
    );
    await owner.query(`DELETE FROM documents WHERE id = $1`, [empty]);
  });

  it("only the indexing job sets a file's text status", async () => {
    await expect(sqlAs(U.cons, `UPDATE documents SET text_status = 'pending' WHERE id = $1`, [D.shared])).rejects.toThrow(
      /indexing job/,
    );
  });

  // The leak test: every person, every project, with their real scope and with
  // a forged one asking for every label. Whatever comes back must be a file
  // the person can open themselves, still indexable and live.
  it("never returns a passage from a file the person can't open, for anyone, in any project", async () => {
    const ALL = ["shared", "firm_private", "client_private", "user_private"] as const;
    let checked = 0;
    for (const uid of Object.values(U)) {
      for (const project of Object.keys(PROJECT_ORG)) {
        await as(uid, async (c) => {
          const tx = drizzle(c, { schema }) as unknown as Tx;
          const p = (await loadPrincipal(tx, uid))!;
          const opens = async (docId: string) =>
            (
              await c.query(
                `SELECT 1 FROM documents WHERE id = $1 AND ai_indexable AND state <> 'archived' AND project_id = $2`,
                [docId, project],
              )
            ).rowCount === 1;

          const forged = await retrieve(
            tx,
            { projectId: project, orgId: PROJECT_ORG[project]!, labels: ALL, userId: uid },
            QUERY,
          );
          for (const r of forged) {
            checked++;
            expect(await opens(r.sourceId), `${uid} got ${r.sourceId} in ${project}`).toBe(true);
          }
          // Row-level security on the index itself, without the search.
          const raw = (await c.query(`SELECT DISTINCT source_id FROM ai_chunks WHERE project_id = $1`, [project])).rows;
          for (const r of raw) expect(await opens(r.source_id), `${uid} sees chunk of ${r.source_id}`).toBe(true);

          const scope = retrievalScope(p, {
            type: "project",
            id: project,
            orgId: PROJECT_ORG[project]!,
            firmOrgId: FIRM,
            projectId: project,
          });
          if (!scope) return;
          const real = await retrieve(tx, scope, QUERY);
          for (const r of real) expect(await opens(r.sourceId)).toBe(true);
        });
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("finds what the person may read: the consultant's project files and their own private one", async () => {
    const found = await as(U.cons, async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      const p = (await loadPrincipal(tx, U.cons))!;
      const scope = retrievalScope(p, { type: "project", id: P1, orgId: ACME, firmOrgId: FIRM, projectId: P1 })!;
      return new Set((await retrieve(tx, scope, QUERY)).map((r) => r.sourceId));
    });
    expect([...found].sort()).toEqual([D.shared, D.firmPrivate, D.consPrivate].sort());
    // Beta's consultant is not on Acme at all.
    const none = await as(U.other, async (c) => {
      const tx = drizzle(c, { schema }) as unknown as Tx;
      return retrieve(tx, { projectId: P1, orgId: ACME, labels: ["shared", "firm_private"], userId: U.other }, QUERY);
    });
    expect(none).toEqual([]);
  });
});

describe("file summaries", () => {
  const points = (pages: number[][]) => ({ points: pages.map((p, i) => ({ text: `Point ${i + 1}`, pages: p })), model: "fake" });
  let calls = 0;
  const fake =
    (out = points([[1], [2, 99]])) =>
    async () => {
      calls++;
      return out;
    };
  beforeEach(async () => {
    calls = 0;
    await owner.query(`DELETE FROM document_summaries`);
  });

  it("are made once per file version and language, and cite only pages the file has", async () => {
    const first = await svc(U.cons, (tx, p) => summarizeDocument(tx, p, D.shared, "en", fake()));
    expect(first.points).toEqual([
      { text: "Point 1", pages: [1] },
      { text: "Point 2", pages: [2] },
    ]);
    const again = await svc(U.admin, (tx, p) => summarizeDocument(tx, p, D.shared, "en", fake()));
    expect(again.id).toBe(first.id);
    expect(calls).toBe(1);
    await svc(U.admin, (tx, p) => summarizeDocument(tx, p, D.shared, "ar", fake()));
    expect(calls).toBe(2);
    // A point that cites nothing real is dropped; none left is an error, not a summary.
    await expect(svc(U.cons, (tx, p) => summarizeDocument(tx, p, D.firmPrivate, "en", fake(points([[42]]))))).rejects.toThrow(
      /no summary that cites/,
    );
  });

  it("are read with the file's rights", async () => {
    await svc(U.cons, (tx, p) => summarizeDocument(tx, p, D.shared, "en", fake()));
    await svc(U.cons, (tx, p) => summarizeDocument(tx, p, D.firmPrivate, "en", fake()));
    const seen = async (uid: string) =>
      (await sqlAs(uid, `SELECT document_id FROM document_summaries ORDER BY document_id`)).rows.map((r) => r.document_id);
    expect(await seen(U.cons)).toEqual([D.shared, D.firmPrivate]);
    expect(await seen(U.cmgr)).toEqual([D.shared]);
    expect(await seen(U.bmgr)).toEqual([]);
    expect(await seen(U.other)).toEqual([]);
    await expect(svc(U.other, (tx, p) => summarizeDocument(tx, p, D.shared, "en", fake()))).rejects.toThrow(/not found/);
    await expect(svc(U.cons, (tx, p) => summarizeDocument(tx, p, D.cmgrPrivate, "en", fake()))).rejects.toThrow(/not found/);
    // The assistant is for firm staff.
    await expect(svc(U.cmgr, (tx, p) => summarizeDocument(tx, p, D.shared, "en", fake()))).rejects.toThrow();
  });

  it("go with the AI flag, a change of visibility, and a new version", async () => {
    const make = (docId: string) => svc(U.cons, (tx, p) => summarizeDocument(tx, p, docId, "en", fake()));
    const left = async () => Number((await owner.query(`SELECT count(*) FROM document_summaries`)).rows[0].count);
    await make(D.shared);
    await sqlAs(U.cons, `UPDATE documents SET ai_indexable = false WHERE id = $1`, [D.shared]);
    expect(await left()).toBe(0);
    await owner.query(`UPDATE documents SET ai_indexable = true WHERE id = $1`, [D.shared]);
    await indexDocument(owner, D.shared, pagesFromText(TEXT), embed);

    await make(D.shared);
    await owner.query(`UPDATE documents SET visibility = 'firm_private' WHERE id = $1`, [D.shared]);
    expect(await left()).toBe(0);
    await owner.query(`UPDATE documents SET visibility = 'shared' WHERE id = $1`, [D.shared]);
    // Its passages went with the old visibility: the job indexes it again.
    expect((await owner.query(`SELECT text_status FROM documents WHERE id = $1`, [D.shared])).rows[0].text_status).toBe(
      "pending",
    );
    await indexDocument(owner, D.shared, pagesFromText(TEXT), embed);

    await make(D.shared);
    await owner.query(
      `INSERT INTO documents (project_id, org_id, owner_org_id, uploaded_by, purpose, state, title, visibility, version, supersedes_id,
         storage_key, content_type, size_bytes, sha256)
       VALUES ($1,$2,$3,$4,'deliverable','draft','doc v2','shared',2,$5,'k-v2','text/plain',1,'sha-v2')`,
      [P1, ACME, FIRM, U.cons, D.shared],
    );
    expect(await left()).toBe(0);
    await owner.query(`DELETE FROM documents WHERE storage_key = 'k-v2'`);
  });

  it("refuse files that are not indexed or have no readable text", async () => {
    await owner.query(`UPDATE documents SET text_status = 'not_searchable' WHERE id = $1`, [D.firmPrivate]);
    await expect(svc(U.cons, (tx, p) => summarizeDocument(tx, p, D.firmPrivate, "en", fake()))).rejects.toThrow(
      /could not be read/,
    );
    await owner.query(`UPDATE documents SET text_status = 'pending' WHERE id = $1`, [D.firmPrivate]);
    await expect(svc(U.cons, (tx, p) => summarizeDocument(tx, p, D.firmPrivate, "en", fake()))).rejects.toThrow(
      /not been indexed/,
    );
    await owner.query(`UPDATE documents SET text_status = 'searchable' WHERE id = $1`, [D.firmPrivate]);
    expect(calls).toBe(0);
  });

  it("must cite pages for every line, and only for the file's current text", async () => {
    const put = (summary: string, citations: unknown, sha = `sha-${D.shared}`) =>
      sqlAs(
        U.cons,
        `INSERT INTO document_summaries (document_id, project_id, org_id, sha256, lang, summary, citations, model, created_by)
         VALUES ($1,$2,$3,$4,'en',$5,$6,'m',$7)`,
        [D.shared, P1, ACME, sha, summary, JSON.stringify(citations), U.cons],
      );
    await expect(put("a\nb", [{ line: 1, pages: [1] }])).rejects.toThrow(/every line/);
    await expect(put("a", [{ line: 1, pages: [] }])).rejects.toThrow(/line and the pages/);
    await expect(put("a", [{ line: 1, pages: [1] }], "old-sha")).rejects.toThrow(/row-level security/);
    await put("a", [{ line: 1, pages: [1] }]);
  });

  it("are capped at 30 new ones per person an hour", async () => {
    for (let i = 0; i < 30; i++) {
      await owner.query(
        `INSERT INTO document_summaries (document_id, project_id, org_id, sha256, lang, summary, citations, model, created_by)
         VALUES ($1,$2,$3,$4,'en','a','[{"line":1,"pages":[1]}]','m',$5)`,
        [D.firmPrivate, P1, ACME, `old-${i}`, U.cons],
      );
    }
    await expect(svc(U.cons, (tx, p) => summarizeDocument(tx, p, D.shared, "en", fake()))).rejects.toThrow(/too many summaries/);
  });
});

describe("meeting summary sources", () => {
  const TRANSCRIPT = "Sara: The board meets quarterly.\nKhalid: Agreed.";
  const point = (uid: string, values: Record<string, unknown>) =>
    sqlAs(
      uid,
      `INSERT INTO meeting_summary_sources (meeting_id, project_id, org_id, line, kind, transcript_start, transcript_end, document_id, page)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING document_version`,
      [
        MEETING,
        P1,
        ACME,
        values.line ?? 1,
        values.kind,
        values.start ?? null,
        values.end ?? null,
        values.doc ?? null,
        values.page ?? null,
      ],
    );
  beforeEach(async () => {
    await owner.query(`TRUNCATE meetings CASCADE`);
    await owner.query(
      `INSERT INTO meetings (id, project_id, org_id, kind, title, starts_at, ends_at, location, join_url, organizer_id, ics_uid, status, transcript_consent)
       VALUES ($1,$2,$3,'status','Monthly status', now() - interval '2 hours', now() - interval '1 hour','online',
               'https://meet.google.com/abc-defg-hij',$4,'x','scheduled',true)`,
      [MEETING, P1, ACME, U.cons],
    );
    await owner.query(`UPDATE meetings SET status = 'held' WHERE id = $1`, [MEETING]);
    await owner.query(`INSERT INTO meeting_attendees (meeting_id, user_id) VALUES ($1,$2), ($1,$3)`, [MEETING, U.cons, U.cmgr]);
    await owner.query(
      `INSERT INTO meeting_transcripts (meeting_id, project_id, org_id, lang, format, body, imported_by, delete_after)
       VALUES ($1,$2,$3,'en','text',$4,$5,'2099-01-01')`,
      [MEETING, P1, ACME, TRANSCRIPT, U.cons],
    );
    await owner.query(
      `INSERT INTO meeting_summaries (meeting_id, project_id, org_id, lang, main_points_md, confirmed_by, visibility)
       VALUES ($1,$2,$3,'en',E'- The board meets quarterly\n- Exit terms are in the charter',$4,'shared')`,
      [MEETING, P1, ACME, U.cons],
    );
  });

  it("point at a transcript passage, seen by the firm only", async () => {
    await point(U.cons, { kind: "transcript", start: 0, end: 32 });
    await expect(point(U.cons, { kind: "transcript", start: 0, end: 999 })).rejects.toThrow(/passage of this meeting/);
    await expect(point(U.cons, { kind: "transcript", line: 3, start: 0, end: 5 })).rejects.toThrow(/no line 3/);
    await expect(point(U.cmgr, { kind: "transcript", start: 0, end: 5 })).rejects.toThrow(/row-level security/);
    expect((await sqlAs(U.cons, `SELECT * FROM meeting_summary_sources`)).rows).toHaveLength(1);
    expect((await sqlAs(U.cmgr, `SELECT * FROM meeting_summary_sources`)).rows).toHaveLength(0);
  });

  it("point at a page of a file in the same project, seen by whoever can open the file", async () => {
    const [row] = (await point(U.cons, { kind: "document", line: 2, doc: D.shared, page: 4 })).rows;
    expect(row.document_version).toBe(1);
    await point(U.cons, { kind: "document", line: 1, doc: D.firmPrivate, page: 1 });
    await expect(point(U.cons, { kind: "document", doc: D.p2Shared, page: 1 })).rejects.toThrow(/file in this project/);
    await expect(point(U.cons, { kind: "document", doc: D.shared, page: 0 })).rejects.toThrow(/file in this project/);
    const seen = async (uid: string) =>
      (await sqlAs(uid, `SELECT document_id FROM meeting_summary_sources`)).rows.map((r) => r.document_id);
    expect(await seen(U.cons)).toHaveLength(2);
    expect(await seen(U.cmgr)).toEqual([D.shared]);
  });

  it("are retired when the summary's text is rewritten", async () => {
    await point(U.cons, { kind: "transcript", start: 0, end: 32 });
    await owner.query(`UPDATE meeting_summaries SET confirmed_by = $2 WHERE meeting_id = $1`, [MEETING, U.admin]);
    expect((await owner.query(`SELECT count(*) FROM meeting_summary_sources`)).rows[0].count).toBe("1");
    await owner.query(`UPDATE meeting_summaries SET main_points_md = 'Rewritten' WHERE meeting_id = $1`, [MEETING]);
    expect((await owner.query(`SELECT count(*) FROM meeting_summary_sources`)).rows[0].count).toBe("0");
  });
});

describe("assistant answers in the other language", () => {
  it("are stored once with their language and translated for their owner only", async () => {
    const msg = await as(U.cons, async (c) => {
      const [conv] = (
        await c.query(`INSERT INTO ai_conversations (user_id, project_id) VALUES ($1,$2) RETURNING id`, [U.cons, P1])
      ).rows;
      return conv.id as string;
    }).then((conv) =>
      sqlAs(
        U.cons,
        `INSERT INTO ai_messages (conversation_id, user_id, role, content, lang) VALUES ($1,$2,'user','ما هو الميثاق؟','ar'),
           ($1,$2,'assistant','The charter sets out how the family council works.','en') RETURNING id, role`,
        [conv, U.cons],
      ),
    );
    await expect(
      owner.query(
        `INSERT INTO ai_messages (conversation_id, user_id, role, content, lang) SELECT conversation_id, user_id, 'user', 'hi', 'fr' FROM ai_messages LIMIT 1`,
      ),
    ).rejects.toThrow(/ai_message_lang/);
    const answerId = msg.rows.find((r) => r.role === "assistant").id;
    const questionId = msg.rows.find((r) => r.role === "user").id;
    const r = { entityType: "ai_message", entityId: answerId, field: "content", to: "ar" as const };
    const made = await svc(U.cons, (tx, p) => T.translate(tx, p, r));
    expect(made.text).toBe("[en->ar] The charter sets out how the family council works.");
    expect(made.original).toBe(false);
    await expect(svc(U.admin, (tx, p) => T.translate(tx, p, r))).rejects.toThrow(/not found/);
    expect((await sqlAs(U.admin, `SELECT * FROM content_translations WHERE entity_id = $1`, [answerId])).rows).toHaveLength(0);
    // Only answers: the person's own question is already in their language.
    await expect(svc(U.cons, (tx, p) => T.translate(tx, p, { ...r, entityId: questionId, to: "en" }))).rejects.toThrow(
      /not found/,
    );
  });
});
