import { z } from "zod";
import { route } from "@/server/http";
import { getDocumentSummary, summarizeDocument } from "@/services/document-summaries";
import { maskingOn } from "@/services/masking";

const lang = z.enum(["ar", "en"]);

// The summary already kept for the file's current version, if any. Never calls the model.
export const GET = route({ params: z.object({ id: z.uuid() }), query: z.object({ lang }) }, ({ tx, principal, params, query }) =>
  getDocumentSummary(tx, principal, params.id, query.lang),
);

// Made once per file version and language, then kept; each line cites its pages.
// Whether names are masked is asked of the AI service before the transaction opens (prepare).
export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ lang }), prepare: () => maskingOn() },
  ({ tx, principal, params, body, prepared }) => summarizeDocument(tx, principal, params.id, body.lang, undefined, prepared),
);
