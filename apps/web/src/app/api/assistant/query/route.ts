import { headers } from "next/headers";
import { z } from "zod";
import { route } from "@/server/http";
import { ask, prepareAsk, streamAnswer } from "@/services/assistant";

const caseType = z.enum(["recommendation", "action", "finding", "meeting", "document"]);
const body = z
  .object({
    // Null or left out: every project the person may ask about ("All my clients").
    projectId: z.uuid().nullish(),
    question: z.string().trim().min(1).max(2000),
    conversationId: z.uuid().optional(),
    // Only when starting a chat: the record it is about (the database checks it is in the project).
    caseType: caseType.optional(),
    caseId: z.uuid().optional(),
    language: z.enum(["ar", "en", "auto"]).default("auto"),
  })
  .refine((b) => (b.caseType === undefined) === (b.caseId === undefined), { message: "caseType and caseId go together" })
  .refine((b) => !b.caseId || b.projectId, { message: "a case belongs to a project" });

/**
 * Asks the assistant. With `Accept: application/x-ndjson` the answer streams
 * as it is written (streamAnswer). Checks, the daily limit and the search run
 * first, here, so their refusals are ordinary error responses.
 */
export const POST = route({ body }, async ({ tx, principal, body: { caseType, caseId, ...rest } }) => {
  const input = { ...rest, case: caseType && caseId ? { type: caseType, id: caseId } : undefined };
  if (!(await headers()).get("accept")?.includes("application/x-ndjson")) return ask(tx, principal, input);
  const prepared = await prepareAsk(tx, principal, input);
  return new Response(streamAnswer(principal, prepared), {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
});
