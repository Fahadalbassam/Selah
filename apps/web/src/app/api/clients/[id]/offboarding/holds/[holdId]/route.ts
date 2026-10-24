import { z } from "zod";
import { OFFBOARDING_LIMITS } from "@/lib/offboarding";
import { route } from "@/server/http";
import { releaseLegalHold } from "@/services/offboarding";

/** Release a legal hold, saying why (the firm admin). */
export const PATCH = route(
  {
    params: z.object({ id: z.uuid(), holdId: z.uuid() }),
    body: z.object({ reason: z.string().trim().min(OFFBOARDING_LIMITS.reason.min).max(OFFBOARDING_LIMITS.reason.max) }).strict(),
  },
  ({ tx, principal, params, body }) => releaseLegalHold(tx, principal, params.id, params.holdId, body),
);
