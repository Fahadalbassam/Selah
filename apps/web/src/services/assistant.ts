import "server-only";
import { and, cosineDistance, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { aiChunks, aiConversations, aiMessages, documents, projects } from "@/db/schema";
import { ForbiddenError, retrievalScope, type Principal, type Resource, type RetrievalScope } from "@/authz";
import { detectLang } from "@/lib/translations";
import { NotFoundError } from "@/server/errors";
import { answer, embed, type Passage } from "./ai-client";
import { audit } from "./audit";

const TOP_K = 8;
const CANNOT_CONFIRM = {
  ar: "لا أستطيع تأكيد ذلك من المصادر المتاحة لك.",
  en: "I can't confirm this from the sources available to you.",
};

export interface AskInput {
  projectId: string;
  question: string;
  conversationId?: string;
  language: "ar" | "en" | "auto";
}

/**
 * Answer a question from the project's permitted material.
 *
 *   1. authorize() decides the retrieval scope (same check as the rest of the app).
 *   2. The scope goes INSIDE the vector query's WHERE clause, and the query
 *      also runs under RLS, so other tenants' chunks are never scored.
 *   3. Only surviving passages go to the AI service, each with a short id.
 *   4. Cited ids are checked against the ids we supplied.
 *   5. No passages, or no valid citations: say so instead of guessing.
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

  const [vector] = await embed([input.question]);
  if (!vector) throw new Error("embedding failed");
  const chunks = await retrieve(tx, scope, vector);

  const passages: Passage[] = chunks.map((c, i) => ({
    id: `P${i + 1}`,
    text: c.content,
    source: `${c.sourceType} v${c.sourceVersion}${c.page ? ` p.${c.page}` : ""}`,
  }));
  const byPassageId = new Map(passages.map((p, i) => [p.id, chunks[i]!]));

  let text: string;
  let cited: typeof chunks = [];
  let grounded = false;
  if (passages.length > 0) {
    const result = await answer(input.question, passages, input.language);
    cited = result.cited_ids.flatMap((pid) => byPassageId.get(pid) ?? []);
    grounded = result.grounded && cited.length > 0;
    text = grounded ? result.answer : cannotConfirm(input.language);
  } else {
    text = cannotConfirm(input.language);
  }

  const citations = cited.map((c) => ({
    chunkId: c.id,
    sourceType: c.sourceType,
    sourceId: c.sourceId,
    version: c.sourceVersion,
    page: c.page,
  }));

  const conversationId = input.conversationId
    ? await ownConversation(tx, principal, input.conversationId, eng.id)
    : await newConversation(tx, principal, eng.id);
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
    meta: { passages: passages.length, cited: citations.length, grounded },
  });

  // The answer's id lets its owner ask for it in the other language (POST /api/translations, entity "ai_message").
  const messageId = saved.find((m) => m.role === "assistant")!.id;
  return { conversationId, messageId, answer: text, lang: answerLang, grounded, citations };
}

/** The permission filter lives in this WHERE clause, never after it. */
export function retrieve(tx: Tx, scope: RetrievalScope, vector: number[]) {
  return tx
    .select({
      id: aiChunks.id,
      content: aiChunks.content,
      sourceType: aiChunks.sourceType,
      sourceId: aiChunks.sourceId,
      sourceVersion: aiChunks.sourceVersion,
      page: aiChunks.page,
    })
    .from(aiChunks)
    .leftJoin(documents, and(eq(aiChunks.sourceType, "document"), eq(documents.id, aiChunks.sourceId)))
    .where(
      and(
        eq(aiChunks.projectId, scope.projectId),
        eq(aiChunks.orgId, scope.orgId),
        inArray(aiChunks.visibility, [...scope.labels]),
        or(ne(aiChunks.visibility, "user_private"), eq(aiChunks.ownerUserId, scope.userId)),
        // The department rule (drizzle/0025), as in row-level security.
        sql`app_dept_ok(${aiChunks.departmentId}, ${aiChunks.orgId})`,
        // Document chunks must still be indexable, live and the current version.
        or(
          ne(aiChunks.sourceType, "document"),
          and(
            eq(documents.aiIndexable, true),
            ne(documents.state, "archived"),
            eq(documents.version, aiChunks.sourceVersion),
          ),
        ),
      ),
    )
    .orderBy(cosineDistance(aiChunks.embedding, vector))
    .limit(TOP_K);
}

async function newConversation(tx: Tx, principal: Principal, projectId: string) {
  const [row] = await tx
    .insert(aiConversations)
    .values({ userId: principal.userId, projectId })
    .returning({ id: aiConversations.id });
  return row!.id;
}

async function ownConversation(tx: Tx, principal: Principal, id: string, projectId: string) {
  const [row] = await tx
    .select({ id: aiConversations.id })
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
  return row.id;
}

function cannotConfirm(language: AskInput["language"]) {
  return language === "en" ? CANNOT_CONFIRM.en : CANNOT_CONFIRM.ar;
}
