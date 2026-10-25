import "server-only";
import { and, asc, cosineDistance, desc, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { asUser, type Tx } from "@/db/client";
import { env } from "@/env";
import { aiChunks, aiConversations, aiMessages, documents, organizations, projects } from "@/db/schema";
import { authorize, ForbiddenError, OPEN_STATUSES, retrievalScope, type Principal, type RetrievalScope } from "@/authz";
import { chatTitle, fuse, indicatorIntent, keywordQuery, statusIntent, type StatusKind } from "@/lib/assistant-search";
import { CLIENT_REFUSAL, clientAnswerProblem, type FilterReason } from "@/lib/client-ai";
import { firmToday } from "@/lib/dates";
import { detectLang } from "@/lib/translations";
import { NotFoundError } from "@/server/errors";
import type { Masker } from "@/lib/masking";
import { answer, answerStream, embed, type Answer, type HistoryTurn, type Passage } from "./ai-client";
import { audit } from "./audit";
import { myClientAi } from "./client-ai";
import { indicatorSnapshot } from "./indicators";
import { projectsMasker } from "./masking";
import { listProjects } from "./queries";

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
// Indicators sent for a question about them.
const MAX_INDICATORS = 6;
// Document passages kept beside them: status lives in records, not files.
const STATUS_TOP_K = 4;
// Earlier turns of the same chat given as context. Never as sources.
const HISTORY_MESSAGES = 8;
// The most passages the AI service takes in one question (services/ai max_passages).
const MAX_PASSAGES = 12;
// Across projects, a status question lists more actions, each naming its client and project.
const MAX_STATUS_ACTIONS_ACROSS = 10;
// Across projects, the status count names at most this many projects.
const MAX_STATUS_PROJECTS = 8;
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
  /** Null (or left out): every project the person may ask about ("All my clients"). */
  projectId?: string | null;
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
  /** In a chat across projects: the project the source belongs to. */
  projectId?: string;
}

/** A project the person may ask about, with the names that say where a passage came from. */
interface AskProject {
  id: string;
  orgId: string;
  firmOrgId: string;
  kind: string;
  /** "Client · Project", in the language asked. */
  where: string;
}

/** Everything about a question that is settled before the model is called. */
export interface PreparedAsk {
  question: string;
  language: AskInput["language"];
  /** The model's audience: a client person gets the client rules and the client filter. */
  client: boolean;
  /** Null for a chat across projects. */
  projectId: string | null;
  chatId: string | null;
  case: CaseRef | null;
  /** Sent to the model: masked. */
  passages: Passage[];
  maskedQuestion: string;
  history: HistoryTurn[];
  byPassageId: Map<string, Citation>;
  /** In a chat across projects, the projects the passages came from (null otherwise). */
  projectIds: string[] | null;
  masker: Masker;
  /** The firm day the question was counted on, against a client person's daily limit. */
  countedOn: string;
  meta: Record<string, unknown>;
}

/**
 * Answer a question from the permitted material of one project, or of every
 * project the person may ask about.
 *
 *   1. authorize() decides the retrieval scope of each project (same check as
 *      the rest of the app). Across projects, it is the scopes of each project
 *      the person may ask about, joined; nothing beyond them.
 *   2. The scopes go INSIDE both search queries' WHERE clause, and they also
 *      run under RLS, so other tenants' chunks are never scored.
 *   3. Records (the chat's case, the recommendations and actions the search
 *      found, and those behind the files found) are read under the same RLS,
 *      as they stand now. A status question
 *      ("what is overdue?") also gets the matching actions first.
 *   4. Only surviving passages go to the AI service, each with a short id and,
 *      across projects, the client and project it came from.
 *      Earlier turns of the chat go as context, never as sources.
 *   5. Cited ids are checked against the ids we supplied.
 *   6. No passages, or no valid citations: say so instead of guessing.
 */
export async function ask(tx: Tx, principal: Principal, input: AskInput) {
  const prepared = await prepareAsk(tx, principal, input);
  const result = prepared.passages.length
    ? await answer(prepared.maskedQuestion, prepared.passages, answerLanguage(prepared), prepared.history, prepared.client ? "client" : "staff")
    : null;
  return finishAsk(tx, principal, prepared, result);
}

/** "auto" is settled here: with Arabic records and an English question the model drifted to Arabic. */
export const answerLanguage = (p: Pick<PreparedAsk, "language" | "question">) =>
  p.language === "auto" ? detectLang(p.question) : p.language;

/** Steps 1 to 4: checks, search and the passages for the model. Counts the question. */
export async function prepareAsk(tx: Tx, principal: Principal, input: AskInput): Promise<PreparedAsk> {
  // A chat keeps the scope it was started with.
  const chat = input.conversationId ? await ownConversation(tx, principal, input.conversationId) : null;
  // A chat named under another scope than its own is not found, as before chats across projects.
  if (chat && input.projectId !== undefined && (input.projectId ?? null) !== chat.projectId) throw new NotFoundError("conversation");
  const projectId = chat ? chat.projectId : (input.projectId ?? null);
  const targets = projectId ? [await oneProject(tx, principal, projectId, input.language)] : await askableProjects(tx, principal, input.language);
  const scopes = targets.flatMap((p) => {
    const sc = retrievalScope(principal, { type: "project", id: p.id, orgId: p.orgId, firmOrgId: p.firmOrgId, projectId: p.id });
    return sc ? [sc] : [];
  });
  if (projectId && !scopes.length) {
    const t = targets[0]!;
    throw new ForbiddenError("assistant.query", { type: "project", id: t.id, orgId: t.orgId, firmOrgId: t.firmOrgId, projectId: t.id }, "retrieval:no-scope");
  }
  if (!scopes.length) throw new ForbiddenError("assistant.query", { type: "organization", id: principal.orgId, orgId: principal.orgId, projectId: null }, "retrieval:no-scope");
  const across = projectId === null;
  const whereOf = new Map(targets.map((p) => [p.id, p.where]));
  const client = scopes[0]!.client === true;

  // Counted before the search; a client person past their daily limit is refused (OWASP LLM10).
  const countedOn = firmToday();
  await tx.execute(sql`select app_count_ai_question(${countedOn}::date)`);

  const caseRef = chat ? chat.caseRef : across ? null : (input.case ?? null);
  const [vector] = await embed([input.question]);
  if (!vector) throw new Error("embedding failed");
  const kinds = statusIntent(input.question);
  const ids = scopes.map((sc) => sc.projectId);
  const clientOrgs = [...new Set(targets.filter((p) => p.kind === "client").map((p) => p.orgId))];
  const status = [
    ...(kinds.size ? await statusRecords(tx, ids, kinds, across ? whereOf : undefined) : []),
    // Indicators are a client's own; across clients there is no one set to give.
    // Across projects they belong to the client, so the answer quotes every project of it the person can ask about
    // (ai_messages.project_ids): taken off any of them, the person no longer reads the answer.
    ...(clientOrgs.length === 1 && indicatorIntent(input.question)
      ? (await indicatorRecords(tx, clientOrgs[0]!, across ? undefined : projectId!)).map((r) =>
          across ? { ...r, projectIds: targets.filter((p) => p.orgId === clientOrgs[0]).map((p) => p.id) } : r,
        )
      : []),
  ];
  const found = await retrieve(tx, scopes, vector, { query: input.question, case: caseRef, sources: "files" });
  // A recommendation or action found by the search goes as the record itself
  // (status, due date, last review), never as its indexed text.
  const hits = await retrieve(tx, scopes, vector, { query: input.question, case: caseRef, sources: "records" });
  // Status lives in records, not files: a status question keeps fewer file passages (at least 2, at most
  // STATUS_TOP_K, as the status rows leave room). Records are linked only from the passages sent.
  const statusRoom = MAX_PASSAGES - 1 - status.length;
  const chunks = found.slice(0, status.length ? Math.min(STATUS_TOP_K, Math.max(statusRoom, 2)) : TOP_K);
  const linked = await linkedRecords(tx, caseRef, chunks, hits);
  // A status question: its rows first (the count, then the actions), then what the search linked.
  // The AI service takes MAX_PASSAGES, so what is cut is cut from the end.
  const records = status.length
    ? [...status, ...linked.filter((r) => !status.some((x) => x.type === r.type && x.id === r.id))]
    : linked;

  // The chat's own record goes first and says so: asked "explain this action", the model
  // otherwise picked whichever action came first (client run, 2026-10-24).
  const isCase = (r: RecordPassage) => caseRef !== null && caseRef.type === r.type && caseRef.id === r.id;
  const subject = records.filter(isCase);
  const others = records.filter((r) => !isCase(r));
  const room = MAX_PASSAGES - subject.length;
  const kept = others.slice(0, room - chunks.length);

  const at = (pid: string | undefined) => (across && pid && whereOf.has(pid) ? `, ${whereOf.get(pid)}` : "");
  const toSource = (r: RecordPassage, label: string) => ({
    text: r.text,
    source: `${label}${at(r.projectId)}`,
    projects: r.projectIds ?? (r.projectId ? [r.projectId] : []),
    citation: { chunkId: null, sourceType: r.type, sourceId: r.id, version: 1, page: null, ...(across && r.projectId ? { projectId: r.projectId } : {}) },
  });
  const sources = [
    ...subject.map((r) => toSource(r, `${r.type}, the record this chat is about`)),
    ...chunks.map((c) => ({
      text: c.content,
      source: `${c.sourceType} v${c.sourceVersion}${c.page ? ` p.${c.page}` : ""}${at(c.projectId)}`,
      projects: [c.projectId],
      citation: {
        chunkId: c.id,
        sourceType: c.sourceType,
        sourceId: c.sourceId,
        version: c.sourceVersion,
        page: c.page,
        ...(across ? { projectId: c.projectId } : {}),
      },
    })),
    ...kept.map((r) => toSource(r, r.type)),
  ];
  // A hosted model gets placeholders for known names, never the names (docs/assistant.md).
  // Across projects, the source labels name clients, so they are masked too.
  const masker = await projectsMasker(tx, ids);
  const passages: Passage[] = sources.map((s, i) => ({ id: `P${i + 1}`, text: masker.mask(s.text), source: masker.mask(s.source) }));
  const byPassageId = new Map(passages.map((p, i) => [p.id, sources[i]!.citation as Citation]));
  const history = chat ? await recentTurns(tx, chat.id) : [];
  const question = input.question;
  // Labelling the passage alone was not enough (1 in 5 runs); with this note, 5 in 5.
  const maskedQuestion = subject.length ? `${masker.mask(question).slice(0, 1960)}\n(This chat is about passage P1.)` : masker.mask(question);

  return {
    question,
    language: input.language,
    client,
    projectId,
    chatId: chat?.id ?? null,
    case: input.case ?? null,
    passages,
    maskedQuestion,
    history: history.map((h) => ({ ...h, content: masker.mask(h.content) })),
    byPassageId,
    projectIds: across ? [...new Set(sources.flatMap((s) => s.projects))] : null,
    masker,
    countedOn,
    meta: {
      ...(across ? { scope: "all", projects: ids.length } : {}),
      passages: chunks.length,
      records: kept.length + subject.length,
      ...(kinds.size ? { status: [...kinds].join(",") } : {}),
      turns: history.length / 2,
      // For a client person, which passages went to the model (ids only, never text), so a leak can be traced.
      ...(client ? { sent: chunks.map((c) => c.id).join(",") } : {}),
    },
  };
}

/**
 * A streamed answer so far, for the screen: names put back, and a name's
 * placeholder still being written ("[PERS", "ORG_1" before "ORG_12") held
 * back until it is whole.
 */
export function shownSoFar(masker: Masker, text: string) {
  const tail = /\[?([A-Z]+)(_\d*)?$/.exec(text);
  const cut =
    tail && ["ORG", "PERSON", "DEPT", "PLACE", "EMAIL", "PHONE"].some((k) => (tail[2] === undefined ? k.startsWith(tail[1]!) : k === tail[1]))
      ? text.slice(0, tail.index)
      : text;
  return masker.unmask(cut);
}

/**
 * The model's part of a prepared question as lines of JSON (docs/assistant.md,
 * "Streaming"): {"type": "writing"}, then {"type": "text"} with the answer so
 * far (firm staff only: a client person's answer is shown only after the
 * client filter), then {"type": "done"} with the saved answer, or
 * {"type": "error"}. The answer is saved in a new transaction as the same
 * person, since the one that prepared the question ends when the stream starts.
 */
export function streamAnswer(principal: Principal, prepared: PreparedAsk): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  // Closed by the person (the card closed, the page left): the answer is still written and saved, for the chat list.
  let gone = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        if (!gone) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      send({ type: "writing" });
      try {
        const result = prepared.passages.length
          ? await answerStream(
              prepared.maskedQuestion,
              prepared.passages,
              answerLanguage(prepared),
              prepared.history,
              prepared.client ? "client" : "staff",
              prepared.client ? () => {} : (text) => send({ type: "text", text: shownSoFar(prepared.masker, text) }),
            )
          : null;
        send({ type: "done", ...(await asUser(principal.userId, (tx) => finishAsk(tx, principal, prepared, result))) });
      } catch (e) {
        console.error("assistant: the streamed answer failed", e);
        // Nothing was answered, so the question doesn't count against the daily limit
        // (as ask()'s rollback does). Counted in the transaction that prepared it, which has ended.
        await asUser(principal.userId, (tx) => tx.execute(sql`select app_uncount_ai_question(${prepared.countedOn}::date)`)).catch((err) =>
          console.error("assistant: could not give the question back", err),
        );
        send({ type: "error" });
      }
      if (!gone) controller.close();
    },
    cancel() {
      gone = true;
    },
  });
}

/** Steps 5 and 6, then the chat is saved: the model's answer (null when there was nothing to ask it with). */
export async function finishAsk(tx: Tx, principal: Principal, prepared: PreparedAsk, result: Answer | null) {
  const { question, language, masker } = prepared;
  let text: string;
  let citations: Citation[] = [];
  let grounded = false;
  if (result) {
    const said = masker.unmask(result.answer);
    citations = result.cited_ids.flatMap((pid) => prepared.byPassageId.get(pid) ?? []);
    grounded = result.grounded && citations.length > 0;
    text = grounded ? said : cannotConfirm(language, question);
    if (!grounded) citations = [];
  } else {
    text = cannotConfirm(language, question);
  }

  // Every answer to a client passes the client filter before it is shown or kept.
  let filtered: FilterReason | null = null;
  if (prepared.client && grounded) {
    filtered = await clientFilter(tx, text);
    if (filtered) {
      const lang = language === "auto" ? detectLang(question) : language;
      // Another client's name gets the plain "can't confirm": a refusal must not say who else the firm serves.
      text = filtered === "other_client" ? cannotConfirm(language, question) : CLIENT_REFUSAL[filtered][lang];
      citations = [];
      grounded = false;
    }
  }

  const conversationId = prepared.chatId ?? (await newConversation(tx, principal, prepared.projectId, question, prepared.case ?? undefined));
  // Each message is stored once, in its own language; the other comes from the translation cache.
  const answerLang = language === "auto" ? detectLang(text) : language;
  const projectIds = prepared.projectIds;
  const saved = await tx
    .insert(aiMessages)
    .values([
      { conversationId, userId: principal.userId, role: "user", content: question, lang: detectLang(question), projectIds },
      { conversationId, userId: principal.userId, role: "assistant", content: text, lang: answerLang, citations, projectIds },
    ])
    .returning({ id: aiMessages.id, role: aiMessages.role });

  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "assistant.query",
    resourceType: prepared.projectId ? "project" : "organization",
    resourceId: prepared.projectId ?? principal.orgId,
    outcome: "allow",
    meta: { ...prepared.meta, cited: citations.length, grounded, masked: masker.replaced, ...(filtered ? { filtered } : {}) },
  });

  // The answer's id lets its owner ask for it in the other language (POST /api/translations, entity "ai_message").
  const messageId = saved.find((m) => m.role === "assistant")!.id;
  return { conversationId, messageId, answer: text, lang: answerLang, grounded, citations };
}

/**
 * The projects the person may ask about, in one call: those they can open
 * where authorize() gives them a retrieval scope (the same check as one
 * project). Firm staff: every client project their access reaches, and
 * internal ones. A client person: their own organisation's projects.
 */
async function askableProjects(tx: Tx, principal: Principal, language: AskInput["language"]): Promise<AskProject[]> {
  // The projects this person can read (RLS, then the app's own check), without listProjects' action counts.
  const rows = await tx
    .select({ id: projects.id, orgId: projects.orgId, firmOrgId: projects.firmOrgId, kind: projects.kind, title: projects.title, orgName: organizations.name, orgNameAr: organizations.nameAr })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .orderBy(asc(projects.title));
  return rows
    .filter((r) => authorize(principal, "project.read", { type: "project", id: r.id, orgId: r.orgId, firmOrgId: r.firmOrgId, projectId: r.id }).allowed)
    .filter((p) => retrievalScope(principal, { type: "project", id: p.id, orgId: p.orgId, firmOrgId: p.firmOrgId, projectId: p.id }) !== null)
    .map((p) => ({ id: p.id, orgId: p.orgId, firmOrgId: p.firmOrgId, kind: p.kind, where: where(p, language) }));
}

async function oneProject(tx: Tx, principal: Principal, id: string, language: AskInput["language"]): Promise<AskProject> {
  const [p] = await tx
    .select({ id: projects.id, orgId: projects.orgId, firmOrgId: projects.firmOrgId, kind: projects.kind, title: projects.title, orgName: organizations.name, orgNameAr: organizations.nameAr })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .where(eq(projects.id, id))
    .limit(1);
  if (!p) throw new NotFoundError("project");
  return { id: p.id, orgId: p.orgId, firmOrgId: p.firmOrgId, kind: p.kind, where: where(p, language) };
}

const where = (p: { title: string; orgName: string; orgNameAr: string | null }, language: AskInput["language"]) =>
  `${language === "ar" && p.orgNameAr ? p.orgNameAr : p.orgName} · ${p.title}`;

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
export async function retrieve(tx: Tx, scope: RetrievalScope | RetrievalScope[], vector: number[], opts: RetrieveOptions = {}) {
  const fields = {
    id: aiChunks.id,
    projectId: aiChunks.projectId,
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

/** Why an answer may not go to a client person, or null. */
export async function clientFilter(tx: Tx, text: string): Promise<FilterReason | null> {
  const problem = clientAnswerProblem(text);
  if (problem) return problem;
  const { rows } = await tx.execute<{ hit: boolean }>(sql`select app_names_other_client(${text}) as hit`);
  return rows[0]?.hit ? "other_client" : null;
}

/**
 * The retrieval scope as SQL, mirroring row-level security on ai_chunks.
 * Several scopes (a question across projects) are one person's scopes for
 * several projects: each project with its own tenant, the rest shared.
 */
function scopeFilter(scopes: RetrievalScope | RetrievalScope[]) {
  const list = Array.isArray(scopes) ? scopes : [scopes];
  const scope = list[0]!;
  if (list.some((s) => s.userId !== scope.userId || s.client !== scope.client || s.labels.join() !== scope.labels.join())) {
    throw new Error("retrieval scopes of different people or rules");
  }
  return and(
    // A client person searches files, recommendations and actions only.
    scope.client ? inArray(aiChunks.sourceType, ["document", "recommendation", "action"]) : undefined,
    or(...list.map((s) => and(eq(aiChunks.projectId, s.projectId), eq(aiChunks.orgId, s.orgId)))),
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
  /** "status": the count of open work across projects, no one record. */
  type: "recommendation" | "action" | "finding" | "meeting" | "project" | "kpi" | "status";
  id: string;
  text: string;
  /** The project it belongs to (none for an indicator, which is the client's). */
  projectId?: string;
  /** A passage about several projects (the status count across projects): all of them. */
  projectIds?: string[];
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
    const found = await describe(tx, w.type, w.id);
    if (found) out.push({ ...w, ...found });
  }
  return out;
}

async function describe(tx: Tx, type: RecordPassage["type"], id: string): Promise<{ text: string; projectId: string } | null> {
  switch (type) {
    case "project":
    case "kpi":
    case "status":
      return null;
    default: {
      const table = { recommendation: "recommendations", action: "actions", finding: "findings", meeting: "meetings" }[type];
      const [row] = (await tx.execute<{ project_id: string }>(sql`SELECT project_id FROM ${sql.identifier(table)} WHERE id = ${id}`)).rows;
      const text = row ? await describeText(tx, type, id) : null;
      return text && row ? { text, projectId: row.project_id } : null;
    }
  }
}

async function describeText(tx: Tx, type: "recommendation" | "action" | "finding" | "meeting", id: string): Promise<string | null> {
  switch (type) {
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
        await linkedIndicators(tx, id),
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

// The open states and "today" are the app's own (OPEN_STATUSES, firmToday()), so the
// assistant counts what the action screens show. The database's current_date is UTC.
const OPEN = sql`(${sql.join(OPEN_STATUSES.map((s) => sql`${s}`), sql`, `)})`;
const statusWhere = (today: SQL): Record<StatusKind, SQL> => ({
  overdue: sql`a.due_date < ${today}`,
  blocked: sql`a.status = 'blocked'`,
  review: sql`a.status = 'awaiting_review'`,
  revision: sql`a.status = 'revision_requested'`,
  due_soon: sql`a.due_date BETWEEN ${today} AND ${today} + 7`,
  open: sql`true`,
});

/**
 * The state of the work, for a status question: search finds what files say,
 * not which actions are late. A count of the open actions as of today, then
 * the matching actions (most overdue first) and the recommendations past
 * their date with work still open. Read under the person's own row-level
 * security, so a client person sees only what the action screens show them.
 *
 * Across projects (`where` names each project as "Client · Project"), the
 * count is broken down by project and every action and recommendation says
 * which client and project it belongs to.
 */
export async function statusRecords(
  tx: Tx,
  projectIds: string | string[],
  kinds: Set<StatusKind>,
  where?: Map<string, string>,
): Promise<RecordPassage[]> {
  const ids = Array.isArray(projectIds) ? projectIds : [projectIds];
  if (!ids.length) return [];
  const across = where !== undefined;
  const inScope = sql`a.project_id = ANY(ARRAY[${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}])`;
  const today = sql`${firmToday()}::date`;
  const STATUS_WHERE = statusWhere(today);
  const counts = (
    await tx.execute<{
      project_id: string | null;
      today: string;
      week_end: string;
      open: number;
      overdue: number;
      blocked: number;
      review: number;
      revision: number;
      due_soon: number;
    }>(sql`
      SELECT ${across ? sql`a.project_id` : sql`NULL::uuid`} AS project_id,
        ${today}::text AS today, (${today} + 7)::text AS week_end, count(*)::int AS open,
        count(*) FILTER (WHERE ${STATUS_WHERE.overdue})::int AS overdue,
        count(*) FILTER (WHERE ${STATUS_WHERE.blocked})::int AS blocked,
        count(*) FILTER (WHERE ${STATUS_WHERE.review})::int AS review,
        count(*) FILTER (WHERE ${STATUS_WHERE.revision})::int AS revision,
        count(*) FILTER (WHERE ${STATUS_WHERE.due_soon})::int AS due_soon
      FROM actions a WHERE ${inScope} AND a.status IN ${OPEN}
      ${across ? sql`GROUP BY a.project_id` : sql``}`)
  ).rows;
  const sum = (k: "open" | "overdue" | "blocked" | "review" | "revision" | "due_soon") => counts.reduce((n, r) => n + r[k], 0);
  const c = {
    today: counts[0]?.today ?? firmToday(),
    week_end: counts[0]?.week_end ?? "",
    open: sum("open"),
    overdue: sum("overdue"),
    blocked: sum("blocked"),
    review: sum("review"),
    revision: sum("revision"),
    due_soon: sum("due_soon"),
  };
  if (!across && !counts.length) return [];

  const match = sql.join(
    [...kinds].map((k) => sql`(${STATUS_WHERE[k]})`),
    sql` OR `,
  );
  const acts = (
    await tx.execute<{
      id: string;
      project_id: string;
      title: string;
      status: string;
      due_date: string | null;
      late: number | null;
      blocked_reason: string | null;
      owner: string | null;
      rec: string;
    }>(sql`
      SELECT a.id, a.project_id, a.title, a.status, a.due_date, ${today} - a.due_date AS late, a.blocked_reason,
        coalesce(u.name, a.owner_name) AS owner, r.title AS rec
      FROM actions a JOIN recommendations r ON r.id = a.recommendation_id
      LEFT JOIN "user" u ON u.id = a.owner_user_id
      WHERE ${inScope} AND a.status IN ${OPEN} AND (${match})
      ORDER BY a.due_date ASC NULLS LAST, a.created_at LIMIT ${across ? MAX_STATUS_ACTIONS_ACROSS : MAX_STATUS_ACTIONS}`)
  ).rows;
  const recs = (
    await tx.execute<{ id: string; project_id: string; title: string; due_date: string; open: number }>(sql`
      SELECT r.id, r.project_id, r.title, r.due_date, count(a.id)::int AS open
      FROM recommendations r JOIN actions a ON a.recommendation_id = r.id AND a.status IN ${OPEN}
      WHERE ${sql`r.project_id = ANY(ARRAY[${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}])`} AND r.due_date < ${today}
      GROUP BY r.id ORDER BY r.due_date LIMIT 3`)
  ).rows;

  // Which recommendations the late actions belong to, so "which recommendations are late?" has an answer.
  const lateUnder = (
    await tx.execute<{ title: string; n: number }>(sql`
      SELECT r.title, count(*)::int AS n FROM actions a JOIN recommendations r ON r.id = a.recommendation_id
      WHERE ${inScope} AND a.status IN ${OPEN} AND ${STATUS_WHERE.overdue}
      GROUP BY r.title ORDER BY n DESC LIMIT 3`)
  ).rows;

  const at = (pid: string) => (across ? ` (${clip(where.get(pid) ?? "", 160)})` : "");
  // Across projects: the projects with the most overdue, then most open, named one by one.
  const byProject = across
    ? [...counts]
        .sort((x, y) => y.overdue - x.overdue || y.open - x.open)
        .slice(0, MAX_STATUS_PROJECTS)
        .map(
          (r) =>
            `${clip(where.get(r.project_id!) ?? "", 160)}: ${r.open} open, ${r.overdue} overdue, ${r.blocked} blocked, ` +
            `${r.review} awaiting review, ${r.revision} sent back for revision`,
        )
    : [];
  const out: RecordPassage[] = [
    {
      type: across ? "status" : "project",
      id: ids[0]!,
      ...(across ? { projectIds: counts.map((r) => r.project_id!) } : { projectId: ids[0] }),
      text:
        (across
          ? `Status of the actions across the ${ids.length} projects the person can see, as of ${c.today} (from the action records, not files): `
          : `Status of the project's actions as of ${c.today} (from the action records, not files): `) +
        `${c.open} open, ` +
        `${c.overdue} overdue (past their due date), ${c.blocked} blocked, ${c.review} awaiting review, ` +
        `${c.revision} sent back for revision, ${c.due_soon} due from today to ${c.week_end}. ` +
        (byProject.length ? `By client and project: ${byProject.join("; ")}. ` : "") +
        (across && counts.length < ids.length ? `The other ${ids.length - counts.length} project(s) have no open actions. ` : "") +
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
      projectId: a.project_id,
      text: [
        `Action "${clip(a.title, 200)}"${at(a.project_id)}: status ${a.status}`,
        a.due_date ? `, due ${day(a.due_date)}${a.late && a.late > 0 ? ` (${a.late} days overdue)` : ""}` : ", no due date",
        a.owner ? `, owner ${clip(a.owner, 80)}` : ", no owner",
        `. Recommendation "${clip(a.rec, 160)}".`,
        a.status === "blocked" && a.blocked_reason ? ` Blocked because: "${clip(a.blocked_reason, 300)}"` : "",
      ].join(""),
    })),
    ...recs.map((r) => ({
      type: "recommendation" as const,
      id: r.id,
      projectId: r.project_id,
      text: `Recommendation "${clip(r.title, 200)}"${at(r.project_id)} was due ${day(r.due_date)} and still has ${r.open} open action(s).`,
    })),
  ];
  return out;
}

/**
 * The client's business indicators, for a question about them: each one's
 * baseline, latest value, target and movement, from the indicator records.
 * Read under the person's own row-level security, so a client person gets
 * only the indicators their own screens show (a manager: the company's and
 * their departments'). The figures are the client's own, and the text says so.
 */
export async function indicatorRecords(tx: Tx, clientOrgId: string, projectId?: string): Promise<RecordPassage[]> {
  const list = (await indicatorSnapshot(tx, { clientOrgId, projectId }, firmToday())).slice(0, MAX_INDICATORS);
  if (!list.length) return [];
  return list.map((k) => ({
    type: "kpi" as const,
    id: k.id,
    text: [
      `Business indicator "${clip(k.nameEn ?? k.nameAr, 160)}"${k.nameEn && k.nameAr ? ` (Arabic name "${clip(k.nameAr, 160)}")` : ""}`,
      ` for ${k.departmentId ? `the ${clip(k.departmentEn ?? k.departmentAr, 80)} department` : "the whole company"}, in ${clip(k.unit, 40)},`,
      ` ${k.direction === "higher_better" ? "higher is better" : "lower is better"}, reported ${k.frequency}.`,
      ` Baseline ${k.baseline} (${k.baselinePeriod.slice(0, 7)}).`,
      k.latest ? ` Latest value ${k.latest.value} for the period starting ${k.latest.period}, ${k.movement} than the baseline.` : " No value reported yet.",
      k.target !== null ? ` Target ${k.target} by ${k.targetDate}${k.towardTarget !== null ? ` (${Math.round(k.towardTarget)}% of the way)` : ""}.` : " No target set.",
      k.missing ? ` ${k.missing} period(s) missing a value.` : "",
      k.recommendations.length ? ` Linked to recommendation(s) ${k.recommendations.map((r) => `"${clip(r, 120)}"`).join(", ")}.` : "",
      " These are figures reported by the client, not verified impact; a change does not show that a recommendation caused it.",
    ].join(""),
  }));
}

/** The indicators a recommendation is linked to, in one sentence, read under the person's own rights. */
async function linkedIndicators(tx: Tx, recommendationId: string) {
  const rows = (
    await tx.execute<{ name: string; unit: string; baseline: string }>(sql`
      SELECT coalesce(k.name_en, k.name_ar) AS name, k.unit, k.baseline::text AS baseline
      FROM client_kpi_links l JOIN client_kpis k ON k.id = l.kpi_id
      WHERE l.recommendation_id = ${recommendationId} ORDER BY k.created_at LIMIT 4`)
  ).rows;
  if (!rows.length) return "";
  return `Client-reported indicators linked to it: ${rows.map((k) => `"${clip(k.name, 120)}" (baseline ${k.baseline} ${clip(k.unit, 40)})`).join("; ")}.`;
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

async function newConversation(tx: Tx, principal: Principal, projectId: string | null, question: string, caseRef?: CaseRef) {
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

async function ownConversation(tx: Tx, principal: Principal, id: string) {
  const [row] = await tx
    .select({ id: aiConversations.id, projectId: aiConversations.projectId, caseType: aiConversations.caseType, caseId: aiConversations.caseId })
    .from(aiConversations)
    .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, principal.userId)))
    .limit(1);
  if (!row) throw new NotFoundError("conversation");
  const caseRef: CaseRef | null = row.caseType && row.caseId ? { type: row.caseType, id: row.caseId } : null;
  return { id: row.id, projectId: row.projectId, caseRef };
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
      deleteOn: sql<string>`app_chat_delete_on(${aiConversations.lastMessageAt}, ${aiConversations.projectId}, ${aiConversations.userId})`,
    })
    .from(aiConversations)
    // A chat across projects has none.
    .leftJoin(projects, eq(projects.id, aiConversations.projectId))
    .leftJoin(organizations, eq(organizations.id, projects.orgId))
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
  /** In a chat across projects: "Client · Project". */
  place?: string;
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
      deleteOn: sql<string>`app_chat_delete_on(${aiConversations.lastMessageAt}, ${aiConversations.projectId}, ${aiConversations.userId})`,
    })
    .from(aiConversations)
    // A chat across projects has none.
    .leftJoin(projects, eq(projects.id, aiConversations.projectId))
    .leftJoin(organizations, eq(organizations.id, projects.orgId))
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
  // Across projects, each source says which client and project it is from (only those the person can still see).
  const places = chat.projectId ? new Map<string, string>() : await projectPlaces(tx, all, locale);
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
        // The count of open work across projects is no one record: it stays as long as the answer does.
        const l = c.sourceType === "status" ? { label: "", version: undefined } : labels.get(`${c.sourceType}:${c.sourceId}`);
        const place = c.projectId ? places.get(c.projectId) : undefined;
        return {
          ...c,
          chunkId: c.chunkId ?? null,
          label: l?.label ?? null,
          ...(l && place ? { place } : {}),
          available: Boolean(l),
          ...(c.sourceType === "document" && l ? { newer: (l.version ?? 1) > c.version } : {}),
        };
      }),
    })),
  };
}

/** "Client · Project" for the projects cited, keyed by project id: only projects the person can still see (row-level security). */
async function projectPlaces(tx: Tx, cites: Citation[], locale: "ar" | "en") {
  const ids = [...new Set(cites.flatMap((c) => (c.projectId ? [c.projectId] : [])))];
  if (!ids.length) return new Map<string, string>();
  const rows = await tx
    .select({ id: projects.id, title: projects.title, orgName: organizations.name, orgNameAr: organizations.nameAr })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .where(inArray(projects.id, ids));
  return new Map(rows.map((r) => [r.id, where(r, locale)]));
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
    ["kpi", sql`SELECT id, coalesce(name_en, name_ar) AS title, NULL::int AS version FROM client_kpis`],
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

/**
 * What the floating assistant card needs to start: the projects the person
 * may ask about, the record a new chat is about ("Ask the assistant" on a
 * record page), and, at a client, today's questions against the limit.
 */
export async function assistantContext(tx: Tx, principal: Principal, input: { locale: "ar" | "en"; projectId?: string; case?: CaseRef }) {
  const all = await listProjects(tx, principal);
  const allowed = all.filter(
    (p) => authorize(principal, "assistant.query", { type: "project", id: p.id, orgId: p.orgId, firmOrgId: p.firmOrgId, projectId: p.id }).allowed,
  );
  const projectId = input.projectId && allowed.some((p) => p.id === input.projectId) ? input.projectId : null;
  const label = projectId && input.case ? await caseLabel(tx, projectId, input.case) : null;
  const clientAi = await myClientAi(tx, principal);
  return {
    projects: allowed.map((p) => ({ id: p.id, title: p.title, client: input.locale === "ar" && p.orgNameAr ? p.orgNameAr : p.orgName })),
    projectId,
    case: projectId && input.case && label ? { projectId, type: input.case.type, id: input.case.id, label } : null,
    // The client's people (F39): null for firm staff.
    usage: clientAi ? { used: clientAi.usedToday, limit: clientAi.dailyLimit } : null,
    // "local": answers come from a model on this machine's processor, which can take a minute (docs/walkthrough.md).
    model: env().LLM_PROVIDER === "ollama" ? ("local" as const) : ("hosted" as const),
  };
}
