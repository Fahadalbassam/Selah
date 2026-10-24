import { z } from "zod";
import { OFFBOARDING_LIMITS } from "@/lib/offboarding";
import { route } from "@/server/http";
import { placeLegalHold } from "@/services/offboarding";

/** Place a legal hold: the client's records are kept past their retention date until it is released (the firm admin). */
export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    body: z.object({ reason: z.string().trim().min(OFFBOARDING_LIMITS.reason.min).max(OFFBOARDING_LIMITS.reason.max) }).strict(),
  },
  ({ tx, principal, params, body }) => placeLegalHold(tx, principal, params.id, body),
);
