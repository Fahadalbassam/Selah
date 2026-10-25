import { z } from "zod";
import { route } from "@/server/http";
import { setActionSecondReview } from "@/services/second-review";

// The lead, deputy or firm admin asks for (or drops) a second sign-off on one action (F22).
export const PUT = route({ params: z.object({ id: z.uuid() }), body: z.object({ on: z.boolean() }) }, ({ tx, principal, params, body }) =>
  setActionSecondReview(tx, principal, params.id, body.on),
);
