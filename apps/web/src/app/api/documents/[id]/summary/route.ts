import { z } from "zod";
import { route } from "@/server/http";
import { summarizeDocument } from "@/services/document-summaries";

// Made once per file version and language, then kept; each line cites its pages.
export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ lang: z.enum(["ar", "en"]) }) },
  ({ tx, principal, params, body }) => summarizeDocument(tx, principal, params.id, body.lang),
);
