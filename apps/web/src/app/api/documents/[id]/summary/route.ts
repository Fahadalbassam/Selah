import { z } from "zod";
import { route } from "@/server/http";
import { accepted, fileJob } from "@/services/ai-jobs";
import { getDocumentSummary, requestSummary } from "@/services/document-summaries";

const lang = z.enum(["ar", "en"]);

// The summary already kept for the file's current version, if any. Never calls the model.
export const GET = route({ params: z.object({ id: z.uuid() }), query: z.object({ lang }) }, ({ tx, principal, params, query }) =>
  getDocumentSummary(tx, principal, params.id, query.lang),
);

// Made once per file version and language, then kept; each line cites its
// pages. The kept one (200), or a job that asks the model (202 with the job;
// docs/assistant.md, "Slow calls as jobs"): the page asks after the job, then
// reads the summary with GET.
export const POST = route({ params: z.object({ id: z.uuid() }), body: z.object({ lang }) }, async ({ tx, principal, params, body }) => {
  const kept = await requestSummary(tx, principal, params.id, body.lang);
  if (kept) return kept;
  return accepted(await fileJob(tx, principal, "summary", `summary:${params.id}:${body.lang}`, { documentId: params.id, lang: body.lang }));
});
