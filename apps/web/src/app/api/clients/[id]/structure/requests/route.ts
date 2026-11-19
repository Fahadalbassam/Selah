import { z } from "zod";
import { ORG_CHART_LIMITS } from "@/lib/org-chart";
import { route } from "@/server/http";
import { suggestChange } from "@/services/org-chart";

// "Suggest a change" (org chart, part 5): the client's admin asks the firm
// for a change to the company's structure, in a few words (what, where,
// why). It waits on the lead's home. Anyone else: 404.
const L = ORG_CHART_LIMITS.request;
export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    body: z.object({ what: z.string().max(L.what.max), where: z.string().max(L.where).nullish(), why: z.string().max(L.why).nullish() }),
  },
  ({ tx, principal, params, body }) => suggestChange(tx, principal, params.id, body),
);
