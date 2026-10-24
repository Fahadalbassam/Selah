import { z } from "zod";
import { PULSE_LIMITS } from "@/lib/pulse";
import { route } from "@/server/http";
import { answerPulse } from "@/services/pulse";

const score = z.coerce.number().int().min(1).max(5);

/** A client person asked answers the closing pulse, or changes the answer while it is open. */
export const PUT = route(
  {
    params: z.object({ id: z.uuid() }),
    body: z
      .object({ metAgreement: score, responsive: score, selfReliant: score, comment: z.string().trim().max(PULSE_LIMITS.comment).nullish() })
      .strict(),
  },
  ({ tx, principal, params, body }) => answerPulse(tx, principal, params.id, body),
);
