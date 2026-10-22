import { z } from "zod";
import { route } from "@/server/http";
import { getDocumentSummary, summarizeDocument } from "@/services/document-summaries";

const lang = z.enum(["ar", "en"]);

// The summary already kept for the file's current version, if any. Never calls the model.
export const GET = route({ params: z.object({ id: z.uuid() }), query: z.object({ lang }) }, ({ tx, principal, params, query }) =>
  getDocumentSummary(tx, principal, params.id, query.lang),
);

// Made once per file version and language, then kept; each line cites its pages.
export const POST = route({ params: z.object({ id: z.uuid() }), body: z.object({ lang }) }, ({ tx, principal, params, body }) =>
  summarizeDocument(tx, principal, params.id, body.lang),
);
