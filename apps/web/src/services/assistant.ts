import "server-only";
import { and, asc, cosineDistance, desc, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { aiChunks, aiConversations, aiMessages, documents, organizations, projects } from "@/db/schema";
import { ForbiddenError, retrievalScope, type Principal, type Resource, type RetrievalScope } from "@/authz";
import { chatTitle, fuse, keywordQuery, statusIntent, type StatusKind } from "@/lib/assistant-search";
import { detectLang } from "@/lib/translations";
import { NotFoundError } from "@/server/errors";
import { answer, embed, type HistoryTurn, type Passage } from "./ai-client";
import { audit } from "./audit";
import { projectMasker } from "./masking";

const TOP_K = 8;
// Recommendations and actions found by the search (baseline: Record passages), searched
// apart from files so they never take a file passage's place.
const RECORD_HITS = 3;
// Each list of the hybrid search; the merge keeps TOP_K.
const CANDIDATES = 20;
// Records given after the search: the case, the recommendations and actions
// the search found, then those behind the files found.
const MAX_RECORDS = 4;
// Actions listed for a status question ("what is overdue?").
const MAX_STATUS_ACTIONS = 8;
// Document passages kept beside them: status lives in records, not files.
const STATUS_TOP_K = 4;
// Earlier turns of the same chat given as context. Never as sources.
const HISTORY_MESSAGES = 8;
const CANNOT_CONFIRM = {
  ar: "لا أستطيع تأكيد ذلك من المصادر المتاحة لك.",
  en: "I can't confirm this from the sources available to you.",
};

export type CaseType = "recommendation" | "action" | "finding" | "meeting" | "document";
export interface CaseRef {
  type: CaseType;
  id: string;
}

export interface AskInput {
  projectId: string;
  question: string;
  conversationId?: string;
  /** Only when starting a chat: the record it is about. */
  case?: CaseRef;
  language: "ar" | "en" | "auto";
}

export interface Citation {
  /** The passage, for a file; null for a record. */
  chunkId: string | null;
  sourceType: string;
  sourceId: string;
  version: number;
  page?: number | null;
}

/**
 * Answer a question from the project's permitted material.
 *
 *   1. authorize() decides the retrieval scope (same check as the rest of the app).
 *   2. The scope goes INSIDE both search queries' WHERE clause, and they also
 *      run under RLS, so other tenants' chunks are never scored.
 *   3. Records (the chat's case, the recommendations and actions the search
 *      found, and those behind the files found) are read under the same RLS,
 *      as they stand now. A status question
 *      ("what is overdue?") also gets the project's matching actions first.
 *   4. Only surviving passages go to the AI service, each with a short id.
 *      Earlier turns of the chat go as context, never as sources.
 *   5. Cited ids are checked against the ids we supplied.
 *   6. No passages, or no valid citations: say so instead of guessing.
 */
export async function ask(tx: Tx, principal: Principal, input: AskInput) {
  const [eng] = await tx.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!eng) throw new NotFoundError("project");
  const resource: Resource & { type: "project" } = {
    type: "project",
    id: eng.id,
    orgId: eng.orgId,
    firmOrgId: eng.firmOrgId,
    projectId: eng.id,
  };
  const scope = retrievalScope(principal, resource);
  if (!scope) throw new ForbiddenError("assistant.query", resource, "retrieval:no-scope");

  const chat = input.conversationId ? await ownConversation(tx, principal, input.conversationId, eng.id) : null;
  const caseRef = chat ? chat.caseRef : (input.case ?? null);

  const [vector] = await embed([input.question]);
  if (!vector) throw new Error("embedding failed");
  const kinds = statusIntent(input.question);
  const status = kinds.size ? await statusRecords(tx, eng.id, kinds) : [];
  const found = await retrieve(tx, scope, vector, { query: input.question, case: caseRef, sources: "files" });
  // A recommendation or action found by the search goes as the record itself
  // (status, due date, last review), never as its indexed text.
  const hits = await retrieve(tx, scope, vector, { query: input.question, case: caseRef, sources: "records" });
  const chunks = status.length ? found.slice(0, STATUS_TOP_K) : found;
  // The case and its links keep their fuller text when a status row repeats one.
  const linked = await linkedRecords(tx, caseRef, chunks, hits);
  const records = [...linked, ...status.filter((r) => !linked.some((x) => x.type === r.type && x.id === r.id))];

  const sources = [
    ...chunks.map((c) => ({
      text: c.content,
      source: `${c.sourceType} v${c.sourceVersion}${c.page ? ` p.${c.page}` : ""}`,
      citation: { chunkId: c.id, sourceType: c.sourceType, sourceId: c.sourceId, version: c.sourceVersion, page: c.page },
    })),
    ...records.map((r) => ({
      text: r.text,
      source: r.type,
      citation: { chunkId: null, sourceType: r.type, sourceId: r.id, version: 1, page: null },
    })),
  ];
  const passages: Passage[] = sources.map((s, i) => ({ id: `P${i + 1}`, text: s.text, source: s.source }));
  const byPassageId = new Map(passages.map((p, i) => [p.id, sources[i]!.citation]));
  const history = chat ? await recentTurns(tx, chat.id) : [];

  let text: string;
  let citations: Citation[] = [];
  let grounded = false;
  // A hosted model gets placeholders for known names, never the names (docs/assistant.md).
  const masker = await projectMasker(tx, eng.id);
  if (passages.length > 0) {
    const result = await answer(
      masker.mask(input.question),
      passages.map((p) => ({ ...p, text: masker.mask(p.text) })),
      // "auto" is settled here: with Arabic records and an English question the model drifted to Arabic.
      input.language === "auto" ? detectLang(input.question) : input.language,
      history.map((h) => ({ ...h, content: masker.mask(h.content) })),
    );
    result.answer = masker.unmask(result.answer);
    citations = result.cited_ids.flatMap((pid) => byPassageId.get(pid) ?? []);
    grounded = result.grounded && citations.length > 0;
    text = grounded ? result.answer : cannotConfirm(input.language, input.question);
    if (!grounded) citations = [];
  } else {
    text = cannotConfirm(input.language, input.question);
  }

  const conversationId = chat?.id ?? (await newConversation(tx, principal, eng.id, input.question, input.case));
  // Each message is stored once, in its own language; the other comes from the translation cache.
  const answerLang = input.language === "auto" ? detectLang(text) : input.language;
  const saved = await tx
    .insert(aiMessages)
    .values([
      { conversationId, userId: principal.userId, role: "user", content: input.question, lang: detectLang(input.question) },
      { conversationId, userId: principal.userId, role: "assistant", content: text, lang: answerLang, citations },
    ])
    .returning({ id: aiMessages.id, role: aiMessages.role });

  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "assistant.query",
    resourceType: "project",
    resourceId: eng.id,
    outcome: "allow",
    meta: {
      passages: chunks.length,
      records: records.length,
      ...(kinds.size ? { status: [...kinds].join(",") } : {}),
      cited: citations.length,
      grounded,
      turns: history.length / 2,
      masked: masker.replaced,
    },
  });

  // The answer's id lets its owner ask for it in the other language (POST /api/translations, entity "ai_message").
  const messageId = saved.find((m) => m.role === "assistant")!.id;
  return { conversationId, messageId, answer: text, lang: answerLang, grounded, citations };
}

export interface RetrieveOptions {
  /** The question's text, for the keyword half of the search. */
  query?: string;
  /** Passages of this record rank higher. */
  case?: CaseRef | null;
  /** Only files' passages, or only recommendations and actions (RECORD_HITS of them); both when left out. */
  sources?: "files" | "records";
}

/**
 * Hybrid search: the nearest passages by meaning and the best keyword
 * matches, merged by reciprocal rank. The permission filter lives in both
 * WHERE clauses, never after them.
 */
export async function retrieve(tx: Tx, scope: RetrievalScope, vector: number[], opts: RetrieveOptions = {}) {
  const fields = {
    id: aiChunks.id,
    content: aiChunks.content,
    sourceType: aiChunks.sourceType,
    sourceId: aiChunks.sourceId,
    sourceVersion: aiChunks.sourceVersion,
    page: aiChunks.page,
  };
  const base = () =>
    tx
      .select(fields)
      .from(aiChunks)
      .leftJoin(documents, and(eq(aiChunks.sourceType, "document"), eq(documents.id, aiChunks.sourceId)));
  const only =
    opts.sources === "records"
      ? inArray(aiChunks.sourceType, ["recommendation", "action"])
      : opts.sources === "files"
        ? notInArray(aiChunks.sourceType, ["recommendation", "action"])
        : undefined;
  const where = (extra?: SQL) => and(scopeFilter(scope), only, extra);

  const byMeaning = await base().where(where()).orderBy(cosineDistance(aiChunks.embedding, vector)).limit(CANDIDATES);
  const words = opts.query ? keywordQuery(opts.query) : null;
  const tsq = words ? sql`to_tsquery('simple', ${words})` : null;
  const byWords = tsq
    ? await base()
        .where(where(sql`${aiChunks.tsv} @@ ${tsq}`))
        .orderBy(desc(sql`ts_rank(${aiChunks.tsv}, ${tsq})`), asc(aiChunks.id))
        .limit(CANDIDATES)
    : [];
  const c = opts.case;
  const keep = opts.sources === "records" ? RECORD_HITS : TOP_K;
  return fuse([byMeaning, byWords], keep, c ? (r) => r.sourceType === c.type && r.sourceId === c.id : undefined);
}

/** The retrieval scope as SQL, mirroring row-level security on ai_chunks. */
function scopeFilter(scope: RetrievalScope) {
  return and(
    eq(aiChunks.projectId, scope.projectId),
    eq(aiChunks.orgId, scope.orgId),
    inArray(aiChunks.visibility, [...scope.labels]),
    or(ne(aiChunks.visibility, "user_private"), eq(aiChunks.ownerUserId, scope.userId)),
    // The department rule (baseline: Engagement), as in row-level security.
    sql`app_dept_ok(${aiChunks.departmentId}, ${aiChunks.orgId})`,
    // Document chunks must still be indexable, live and the current version.
    or(
      ne(aiChunks.sourceType, "document"),
      and(eq(documents.aiIndexable, true), ne(documents.state, "archived"), eq(documents.version, aiChunks.sourceVersion)),
    ),
    // A record's passage only while the person can read the record (baseline: Record passages), as in row-level security.
    sql`(${aiChunks.sourceType} NOT IN ('recommendation', 'action')
      OR (${aiChunks.sourceType} = 'recommendation' AND EXISTS (SELECT 1 FROM recommendations r WHERE r.id = ${aiChunks.sourceId}))
      OR (${aiChunks.sourceType} = 'action' AND EXISTS (SELECT 1 FROM actions a WHERE a.id = ${aiChunks.sourceId})))`,
  );
}

// ------------------------------------------------------- linked records

interface RecordPassage {
  type: "recommendation" | "action" | "finding" | "meeting" | "project";
  id: string;
  text: string;
}

const day = (d: unknown) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);
const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
};

/**
 * What the firm did about what was found: the chat's case, the
 * recommendations and actions the search found in their own words, then the
 * recommendations (through their findings) and actions (through their
 * evidence) that point at the files found. Read under the person's own
 * row-level security, a few rows each, so the model never gets the whole project.
 */
export async function linkedRecords(
  tx: Tx,
  caseRef: CaseRef | null,
  chunks: { sourceType: string; sourceId: string }[],
  hits: { sourceType: string; sourceId: string }[] = [],
) {
  const wanted: { type: RecordPassage["type"]; id: string }[] = [];
  if (caseRef && caseRef.type !== "document") wanted.push({ type: caseRef.type, id: caseRef.id });
  for (const h of hits) wanted.push({ type: h.sourceType as "recommendation" | "action", id: h.sourceId });

  const docIds = [...new Set(chunks.filter((c) => c.sourceType === "document").map((c) => c.sourceId))].slice(0, 3);
  if (docIds.length) {
    const ids = sql`ARRAY[${sql.join(docIds.map((d) => sql`${d}::uuid`), sql`, `)}]`;
    const recs = await tx.execute<{ id: string }>(sql`
      SELECT DISTINCT r.id FROM recommendations r JOIN findings f ON f.id = r.finding_id
      WHERE f.source_document_id = ANY(${ids}) LIMIT 2`);
    const acts = await tx.execute<{ id: string }>(sql`
      SELECT DISTINCT a.id FROM evidence_submissions e JOIN actions a ON a.id = e.action_id
      WHERE e.document_id = ANY(${ids}) LIMIT 2`);
    for (const r of recs.rows) wanted.push({ type: "recommendation", id: r.id });
    for (const a of acts.rows) wanted.push({ type: "action", id: a.id });
  }

  const out: RecordPassage[] = [];
  const seen = new Set<string>();
  for (const w of wanted) {
    if (out.length >= MAX_RECORDS) break;
    const key = `${w.type}:${w.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const text = await describe(tx, w.type, w.id);
    if (text) out.push({ ...w, text });
  }
  return out;
}

async function describe(tx: Tx, type: RecordPassage["type"], id: string): Promise<string | null> {
  switch (type) {
    case "project":
      return null;
    case "recommendation": {
      const [r] = (
        await tx.execute<{
          title: string;
          priority: string;
          due_date: string | null;
          rationale: string | null;
          target_outcome: string | null;
          required_evidence: string | null;
        }>(sql`SELECT title, priority, due_date, rationale, target_outcome, required_evidence FROM recommendations WHERE id = ${id}`)
      ).rows;
      if (!r) return null;
      return [
        `Recommendation "${clip(r.title, 200)}" (priority ${r.priority}${r.due_date ? `, due ${day(r.due_date)}` : ""}).`,
        r.rationale ? `Why: "${clip(r.rationale, 300)}"` : "",
        r.target_outcome ? `Expected outcome: "${clip(r.target_outcome, 300)}"` : "",
        r.required_evidence ? `Evidence required: "${clip(r.required_evidence, 300)}"` : "",
        `Actions: ${await actionList(tx, id)}.`,
      ]
        .filter(Boolean)
        .join(" ");
    }
    case "action": {
      const [a] = (
        await tx.execute<{ title: string; status: string; due_date: string | null; blocked_reason: string | null; rec: string | null }>(sql`
          SELECT a.title, a.status, a.due_date, a.blocked_reason, r.title AS rec
          FROM actions a LEFT JOIN recommendations r ON r.id = a.recommendation_id WHERE a.id = ${id}`)
      ).rows;
      if (!a) return null;
      const [rev] = (
        await tx.execute<{ outcome: string; created_at: string }>(
          sql`SELECT outcome, created_at FROM reviews WHERE action_id = ${id} ORDER BY created_at DESC LIMIT 1`,
        )
      ).rows;
      const [upd] = (
        await tx.execute<{ body: string; created_at: string }>(
          sql`SELECT body, created_at FROM progress_updates WHERE action_id = ${id} ORDER BY created_at DESC LIMIT 1`,
        )
      ).rows;
      return [
        `Action "${clip(a.title, 200)}": status ${a.status}${a.due_date ? `, due ${day(a.due_date)}` : ""}.`,
        a.status === "blocked" && a.blocked_reason ? `Blocked because: "${clip(a.blocked_reason, 300)}"` : "",
        a.rec ? `It belongs to recommendation "${clip(a.rec, 200)}".` : "",
        rev ? `Last review: ${rev.outcome} on ${day(rev.created_at)}.` : "No review yet.",
        upd ? `Last progress update (${day(upd.created_at)}): "${clip(upd.body, 300)}"` : "No progress update yet.",
      ]
        .filter(Boolean)
        .join(" ");
    }
    case "finding": {
      const [f] = (
        await tx.execute<{ title: string; description: string | null }>(
          sql`SELECT title, description FROM findings WHERE id = ${id}`,
        )
      ).rows;
      if (!f) return null;
      const recs = (
        await tx.execute<{ title: string }>(
          sql`SELECT title FROM recommendations WHERE finding_id = ${id} ORDER BY created_at LIMIT 4`,
        )
      ).rows;
      return `Finding "${clip(f.title, 200)}"${f.description ? `: ${clip(f.description, 400)}` : "."} Recommendations: ${
        recs.length ? recs.map((r) => `"${clip(r.title, 120)}"`).join("; ") : "none recorded"
      }.`;
    }
    case "meeting": {
      const [m] = (
        await tx.execute<{ title: string; starts_at: string }>(sql`SELECT title, starts_at FROM meetings WHERE id = ${id}`)
      ).rows;
      if (!m) return null;
      const decisions = (
        await tx.execute<{ text: string }>(
          sql`SELECT text FROM meeting_decisions WHERE meeting_id = ${id} ORDER BY created_at LIMIT 5`,
        )
      ).rows;
      return `Meeting "${clip(m.title, 200)}" on ${day(m.starts_at)}. Decisions: ${
        decisions.length ? decisions.map((d) => `"${clip(d.text, 200)}"`).join("; ") : "none recorded"
      }.`;
    }
  }
}

// ------------------------------------------------------ status questions

const DONE = sql`('verified_complete', 'closed', 'draft')`;
const STATUS_WHERE: Record<StatusKind, SQL> = {
  overdue: sql`a.due_date < current_date`,
  blocked: sql`a.status = 'blocked'`,
  review: sql`a.status = 'awaiting_review'`,
  revision: sql`a.status = 'revision_requested'`,
  due_soon: sql`a.due_date BETWEEN current_date AND current_date + 7`,
  open: sql`true`,
};

/**
 * The state of the work, for a status question: search finds what files say,
 * not which actions are late. A count of the project's open actions as of
 * today, then the matching actions (most overdue first) and the
 * recommendations past their date with work still open. Read under the
 * person's own row-level security, so a client person sees only what the
 * action screens show them.
 */
export async function statusRecords(tx: Tx, projectId: string, kinds: Set<StatusKind>): Promise<RecordPassage[]> {
  const [c] = (
    await tx.execute<{
      today: string;
      week_end: string;
      open: number;
      overdue: number;
      blocked: number;
      review: number;
      revision: number;
      due_soon: number;
    }>(sql`
      SELECT current_date::text AS today, (current_date + 7)::text AS week_end, count(*)::int AS open,
        count(*) FILTER (WHERE ${STATUS_WHERE.overdue})::int AS overdue,
        count(*) FILTER (WHERE ${STATUS_WHERE.blocked})::int AS blocked,
        count(*) FILTER (WHERE ${STATUS_WHERE.review})::int AS review,
        count(*) FILTER (WHERE ${STATUS_WHERE.revision})::int AS revision,
        count(*) FILTER (WHERE ${STATUS_WHERE.due_soon})::int AS due_soon
      FROM actions a WHERE a.project_id = ${projectId} AND a.status NOT IN ${DONE}`)
  ).rows;
  if (!c) return [];

  const match = sql.join(
    [...kinds].map((k) => sql`(${STATUS_WHERE[k]})`),
    sql` OR `,
  );
  const acts = (
    await tx.execute<{
      id: string;
      title: string;
      status: string;
      due_date: string | null;
      late: number | null;
      blocked_reason: string | null;
      owner: string | null;
      rec: string;
    }>(sql`
      SELECT a.id, a.title, a.status, a.due_date, current_date - a.due_date AS late, a.blocked_reason,
        coalesce(u.name, a.owner_name) AS owner, r.title AS rec
      FROM actions a JOIN recommendations r ON r.id = a.recommendation_id
      LEFT JOIN "user" u ON u.id = a.owner_user_id
      WHERE a.project_id = ${projectId} AND a.status NOT IN ${DONE} AND (${match})
      ORDER BY a.due_date ASC NULLS LAST, a.created_at LIMIT ${MAX_STATUS_ACTIONS}`)
  ).rows;
  const recs = (
    await tx.execute<{ id: string; title: string; due_date: string; open: number }>(sql`
      SELECT r.id, r.title, r.due_date, count(a.id)::int AS open
      FROM recommendations r JOIN actions a ON a.recommendation_id = r.id AND a.status NOT IN ${DONE}
      WHERE r.project_id = ${projectId} AND r.due_date < current_date
      GROUP BY r.id ORDER BY r.due_date LIMIT 3`)
  ).rows;

  // Which recommendations the late actions belong to, so "which recommendations are late?" has an answer.
  const lateUnder = (
    await tx.execute<{ title: string; n: number }>(sql`
      SELECT r.title, count(*)::int AS n FROM actions a JOIN recommendations r ON r.id = a.recommendation_id
      WHERE a.project_id = ${projectId} AND a.status NOT IN ${DONE} AND ${STATUS_WHERE.overdue}
      GROUP BY r.title ORDER BY n DESC LIMIT 3`)
  ).rows;

  const out: RecordPassage[] = [
    {
      type: "project",
      id: projectId,
      text:
        `Status of the project's actions as of ${c.today} (from the action records, not files): ${c.open} open, ` +
        `${c.overdue} overdue (past their due date), ${c.blocked} blocked, ${c.review} awaiting review, ` +
        `${c.revision} sent back for revision, ${c.due_soon} due from today to ${c.week_end}. ` +
        (recs.length
          ? `${recs.length} recommendation(s) are past their own due date with open actions. `
          : "No recommendation is past its own due date. ") +
        (lateUnder.length
          ? `The overdue actions belong to ${lateUnder.map((r) => `recommendation "${clip(r.title, 120)}" (${r.n})`).join(", ")}.`
          : "") +
        (acts.length ? "" : " No open action matches the question."),
    },
    ...acts.map((a) => ({
      type: "action" as const,
      id: a.id,
      text: [
        `Action "${clip(a.title, 200)}": status ${a.status}`,
        a.due_date ? `, due ${day(a.due_date)}${a.late && a.late > 0 ? ` (${a.late} days overdue)` : ""}` : ", no due date",
        a.owner ? `, owner ${clip(a.owner, 80)}` : ", no owner",
        `. Recommendation "${clip(a.rec, 160)}".`,
        a.status === "blocked" && a.blocked_reason ? ` Blocked because: "${clip(a.blocked_reason, 300)}"` : "",
      ].join(""),
    })),
    ...recs.map((r) => ({
      type: "recommendation" as const,
      id: r.id,
      text: `Recommendation "${clip(r.title, 200)}" was due ${day(r.due_date)} and still has ${r.open} open action(s).`,
    })),
  ];
  return out;
}

async function actionList(tx: Tx, recommendationId: string) {
  const rows = (
    await tx.execute<{ title: string; status: string; due_date: string | null }>(sql`
      SELECT title, status, due_date FROM actions WHERE recommendation_id = ${recommendationId}
      ORDER BY created_at LIMIT 6`)
  ).rows;
  if (!rows.length) return "none recorded";
  return rows
    .map((a) => `"${clip(a.title, 120)}" ${a.status}${a.due_date ? ` (due ${day(a.due_date)})` : ""}`)
    .join("; ");
}

// --------------------------------------------------------------- chats

async function newConversation(tx: Tx, principal: Principal, projectId: string, question: string, caseRef?: CaseRef) {
  const [row] = await tx
    .insert(aiConversations)
    .values({
      userId: principal.userId,
      projectId,
      title: chatTitle(question),
      caseType: caseRef?.type ?? null,
      caseId: caseRef?.id ?? null,
    })
    .returning({ id: aiConversations.id });
  return row!.id;
}

async function ownConversation(tx: Tx, principal: Principal, id: string, projectId: string) {
  const [row] = await tx
    .select({ id: aiConversations.id, caseType: aiConversations.caseType, caseId: aiConversations.caseId })
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.id, id),
        eq(aiConversations.userId, principal.userId),
        eq(aiConversations.projectId, projectId),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError("conversation");
  const caseRef: CaseRef | null = row.caseType && row.caseId ? { type: row.caseType, id: row.caseId } : null;
  return { id: row.id, caseRef };
}

/** The chat's last few messages, oldest first, as context for a follow-up. */
async function recentTurns(tx: Tx, conversationId: string): Promise<HistoryTurn[]> {
  const rows = await tx
    .select({ role: aiMessages.role, content: aiMessages.content })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(desc(aiMessages.createdAt), asc(aiMessages.role)) // a question and its answer share a time
    .limit(HISTORY_MESSAGES);
  return rows.reverse().map((m) => ({ role: m.role, content: clip(m.content, 1000) }));
}

/** "auto" follows the question's language, as answers do. */
export function cannotConfirm(language: AskInput["language"], question: string) {
  return (language === "auto" ? detectLang(question) : language) === "en" ? CANNOT_CONFIRM.en : CANNOT_CONFIRM.ar;
}

/** The person's chats, newest first: the open ones, or the archived ones. */
export async function listConversations(tx: Tx, principal: Principal, opts: { archived: boolean }) {
  // Row-level security keeps this to the person's own chats in projects they can still see.
  return tx
    .select({
      id: aiConversations.id,
      title: aiConversations.title,
      projectId: aiConversations.projectId,
      projectTitle: projects.title,
      projectKind: projects.kind,
      orgName: organizations.name,
      orgNameAr: organizations.nameAr,
      caseType: aiConversations.caseType,
      caseId: aiConversations.caseId,
      keep: aiConversations.keep,
      archivedAt: aiConversations.archivedAt,
      lastMessageAt: aiConversations.lastMessageAt,
      deleteOn: sql<string>`app_chat_delete_on(${aiConversations.lastMessageAt}, ${aiConversations.projectId})`,
    })
    .from(aiConversations)
    .innerJoin(projects, eq(projects.id, aiConversations.projectId))
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .where(
      and(
        eq(aiConversations.userId, principal.userId),
        opts.archived ? isNotNull(aiConversations.archivedAt) : isNull(aiConversations.archivedAt),
      ),
    )
    .orderBy(desc(aiConversations.lastMessageAt))
    .limit(200);
}

export interface ShownCitation extends Citation {
  label: string | null;
  /** False when the person can no longer open the source. */
  available: boolean;
  /** For a file: true when a newer version has been uploaded since. */
  newer?: boolean;
}

/**
 * One chat with its messages. An answer in the other language comes with its
 * kept translation when there is one (no model call). Each citation is checked
 * again: a source the person can no longer open is marked, without a title.
 */
export async function getConversation(tx: Tx, principal: Principal, id: string, locale: "ar" | "en") {
  const [chat] = await tx
    .select({
      id: aiConversations.id,
      title: aiConversations.title,
      projectId: aiConversations.projectId,
      projectTitle: projects.title,
      orgName: organizations.name,
      orgNameAr: organizations.nameAr,
      caseType: aiConversations.caseType,
      caseId: aiConversations.caseId,
      keep: aiConversations.keep,
      archivedAt: aiConversations.archivedAt,
      lastMessageAt: aiConversations.lastMessageAt,
      deleteOn: sql<string>`app_chat_delete_on(${aiConversations.lastMessageAt}, ${aiConversations.projectId})`,
    })
    .from(aiConversations)
    .innerJoin(projects, eq(projects.id, aiConversations.projectId))
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, principal.userId)));
  if (!chat) throw new NotFoundError("conversation");

  const messages = await tx
    .select({
      id: aiMessages.id,
      role: aiMessages.role,
      content: aiMessages.content,
      lang: aiMessages.lang,
      citations: aiMessages.citations,
      createdAt: aiMessages.createdAt,
    })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, id))
    .orderBy(asc(aiMessages.createdAt), desc(aiMessages.role)); // the question before its answer

  const kept = await keptTranslations(
    tx,
    messages.filter((m) => m.role === "assistant" && m.lang !== locale).map((m) => m.id),
    locale,
  );
  const all = messages.flatMap((m) => (m.citations ?? []) as Citation[]);
  const labels = await citationLabels(tx, all);
  const caseLabel =
    chat.caseType && chat.caseId
      ? (await citationLabels(tx, [{ chunkId: null, sourceType: chat.caseType, sourceId: chat.caseId, version: 1 }])).get(
          `${chat.caseType}:${chat.caseId}`,
        )
      : null;

  return {
    ...chat,
    caseLabel: caseLabel?.label ?? null,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      lang: m.lang as "ar" | "en",
      createdAt: m.createdAt,
      translation: kept.get(m.id) ?? null,
      citations: ((m.citations ?? []) as Citation[]).map((c): ShownCitation => {
        const l = labels.get(`${c.sourceType}:${c.sourceId}`);
        return {
          ...c,
          chunkId: c.chunkId ?? null,
          label: l?.label ?? null,
          available: Boolean(l),
          ...(c.sourceType === "document" && l ? { newer: (l.version ?? 1) > c.version } : {}),
        };
      }),
    })),
  };
}

async function keptTranslations(tx: Tx, ids: string[], locale: "ar" | "en") {
  const out = new Map<string, { id: string; text: string; reviewed: boolean }>();
  if (!ids.length) return out;
  // Only a translation of the text as it is now (its hash), read under the source's rules.
  const { rows } = await tx.execute<{ entity_id: string; id: string; text: string; reviewed_by: string | null }>(sql`
    SELECT t.entity_id, t.id, t.text, t.reviewed_by FROM content_translations t
    JOIN ai_messages m ON m.id = t.entity_id
    WHERE t.entity_type = 'ai_message' AND t.field = 'content' AND t.target_lang = ${locale}
      AND t.entity_id = ANY(ARRAY[${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}])
      AND t.source_sha256 = encode(sha256(convert_to(m.content, 'UTF8')), 'hex')`);
  for (const r of rows) out.set(r.entity_id, { id: r.id, text: r.text, reviewed: r.reviewed_by !== null });
  return out;
}

/** Titles of cited sources the person can still open, keyed "type:id". */
async function citationLabels(tx: Tx, cites: Citation[]) {
  const out = new Map<string, { label: string; version?: number }>();
  const ids = (type: string) => [...new Set(cites.filter((c) => c.sourceType === type).map((c) => c.sourceId))];
  const list = (xs: string[]) => sql`ARRAY[${sql.join(xs.map((i) => sql`${i}::uuid`), sql`, `)}]`;
  const tables: [string, SQL][] = [
    ["document", sql`SELECT id, title, version FROM documents`],
    ["recommendation", sql`SELECT id, title, NULL::int AS version FROM recommendations`],
    ["action", sql`SELECT id, title, NULL::int AS version FROM actions`],
    ["finding", sql`SELECT id, title, NULL::int AS version FROM findings`],
    ["meeting", sql`SELECT id, title, NULL::int AS version FROM meetings`],
    ["project", sql`SELECT id, title, NULL::int AS version FROM projects`],
  ];
  for (const [type, select] of tables) {
    const xs = ids(type);
    if (!xs.length) continue;
    const { rows } = await tx.execute<{ id: string; title: string; version: number | null }>(
      sql`${select} WHERE id = ANY(${list(xs)})`,
    );
    for (const r of rows) out.set(`${type}:${r.id}`, { label: r.title, version: r.version ?? undefined });
  }
  // A newer version of a file is a new row that supersedes it.
  const docs = ids("document");
  if (docs.length) {
    const { rows } = await tx.execute<{ supersedes_id: string; version: number }>(
      sql`SELECT supersedes_id, max(version) AS version FROM documents WHERE supersedes_id = ANY(${list(docs)}) GROUP BY supersedes_id`,
    );
    for (const r of rows) {
      const cur = out.get(`document:${r.supersedes_id}`);
      if (cur) cur.version = Math.max(cur.version ?? 1, r.version);
    }
  }
  return out;
}

export async function updateConversation(
  tx: Tx,
  principal: Principal,
  id: string,
  patch: { title?: string; keep?: boolean; archived?: boolean },
) {
  const set: Partial<typeof aiConversations.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.keep !== undefined) set.keep = patch.keep;
  if (patch.archived !== undefined) set.archivedAt = patch.archived ? new Date() : null;
  const rows = await tx
    .update(aiConversations)
    .set(set)
    .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, principal.userId)))
    .returning({ id: aiConversations.id });
  if (!rows.length) throw new NotFoundError("conversation");
  return { id };
}

/** The owner deletes a chat now. Its translations go with its messages. */
export async function deleteConversation(tx: Tx, principal: Principal, id: string) {
  const rows = await tx
    .delete(aiConversations)
    .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, principal.userId)))
    .returning({ id: aiConversations.id, projectId: aiConversations.projectId });
  if (!rows.length) throw new NotFoundError("conversation");
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "assistant.chat_deleted",
    resourceType: "ai_conversation",
    resourceId: id,
    outcome: "allow",
    meta: { project: rows[0]!.projectId },
  });
  return { id };
}

/** The title of a record a new chat would be about, if the person can see it in that project. */
export async function caseLabel(tx: Tx, projectId: string, ref: CaseRef): Promise<string | null> {
  const table = { recommendation: "recommendations", action: "actions", finding: "findings", meeting: "meetings", document: "documents" }[
    ref.type
  ];
  const { rows } = await tx.execute<{ title: string }>(
    sql`SELECT title FROM ${sql.identifier(table)} WHERE id = ${ref.id} AND project_id = ${projectId}`,
  );
  return rows[0]?.title ?? null;
}
