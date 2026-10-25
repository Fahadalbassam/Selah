import { z } from "zod";
import { SECOND_REVIEW_RULES } from "@/lib/second-review";
import { route } from "@/server/http";
import { setClientReviewRule } from "@/services/second-review";

// When this client's evidence needs a second consultant's sign-off (F22): the firm admin or the client's lead or deputy.
export const PUT = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ rule: z.enum(SECOND_REVIEW_RULES) }) },
  ({ tx, principal, params, body }) => setClientReviewRule(tx, principal, params.id, body.rule),
);
