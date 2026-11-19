import { z } from "zod";
import { ORG_DRAFT_BODY } from "@/lib/org-chart-import";
import { route } from "@/server/http";
import { draftFromText } from "@/services/org-chart-import";

// Org chart, part 4, step one from pasted text: the assistant drafts rows
// (the text masked before it leaves the server), which go to the same review
// step as a file. Nothing is stored. Only where the assistant is on for the
// reader at this client; for anyone who may not import, a 404.
export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    // Well over the limit, so the service can say in words how much shorter the text must be.
    body: ORG_DRAFT_BODY,
  },
  ({ tx, principal, params, body }) => draftFromText(tx, principal, params.id, body.text),
);
