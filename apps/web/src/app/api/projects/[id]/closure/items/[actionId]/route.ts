import { z } from "zod";
import { CLOSURE_LIMITS, DISPOSITIONS, parseSustainer, SUSTAINER_CHOICE } from "@/lib/closure";
import { route } from "@/server/http";
import { disposeAction, nameSustainer } from "@/services/closure";

const params = z.object({ id: z.uuid(), actionId: z.uuid() });

/** The firm decides what happens to an open action while the project closes. */
export const PUT = route(
  {
    params,
    body: z
      .object({ disposition: z.enum(DISPOSITIONS), note: z.string().trim().max(CLOSURE_LIMITS.note).nullish(), sustainer: SUSTAINER_CHOICE.optional() })
      .strict(),
  },
  ({ tx, principal, params, body }) =>
    disposeAction(tx, principal, params.id, params.actionId, { disposition: body.disposition, note: body.note, ...parseSustainer(body.sustainer) }),
);

/** Name who sustains a handed-over action (the firm, the client's admin or the sponsor). */
export const PATCH = route({ params, body: z.object({ sustainer: SUSTAINER_CHOICE }).strict() }, ({ tx, principal, params, body }) =>
  nameSustainer(tx, principal, params.id, params.actionId, parseSustainer(body.sustainer)),
);

/** Take the disposition back. */
export const DELETE = route({ params }, ({ tx, principal, params }) =>
  disposeAction(tx, principal, params.id, params.actionId, { disposition: null }),
);
