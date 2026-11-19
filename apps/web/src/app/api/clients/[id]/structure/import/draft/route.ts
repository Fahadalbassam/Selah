import { z } from "zod";
import { ORG_DRAFT_BODY } from "@/lib/org-chart-import";
import { route } from "@/server/http";
import { accepted, fileJob } from "@/services/ai-jobs";
import { maskingOn } from "@/services/masking";
import { requestOrgDraft } from "@/services/org-chart-import";

// Org chart, part 4, step one from pasted text: the assistant drafts rows
// (the text masked before it leaves the server), which go to the same review
// step as a file. The local model takes minutes, so it is a job (202 with the
// job; docs/assistant.md, "Slow calls as jobs"): the page asks after it and
// gets the rows from GET /api/ai-jobs/[id]. Nothing is stored but the job,
// and the text only until it ends. Only where the assistant is on for the
// reader at this client; for anyone who may not import, a 404.
export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    // Well over the limit, so the service can say in words how much shorter the text must be.
    body: ORG_DRAFT_BODY,
    // Whether names are masked is asked of the AI service before the transaction opens.
    prepare: () => maskingOn(),
  },
  async ({ tx, principal, params, body, prepared }) => {
    const { sha256 } = await requestOrgDraft(tx, principal, params.id, body.text, prepared);
    return accepted(await fileJob(tx, principal, "org_draft", `org_draft:${params.id}:${sha256}`, { clientOrgId: params.id, text: body.text }));
  },
);
