import { z } from "zod";
import { CLOSURE_LIMITS } from "@/lib/closure";
import { route } from "@/server/http";
import { declineClosureRequest } from "@/services/closure";

/** The firm admin declines the client's request to close, saying why. */
export const PATCH = route(
  {
    params: z.object({ id: z.uuid(), requestId: z.uuid() }),
    body: z.object({ reply: z.string().trim().min(CLOSURE_LIMITS.reply.min).max(CLOSURE_LIMITS.reply.max) }).strict(),
  },
  ({ tx, principal, params, body }) => declineClosureRequest(tx, principal, params.id, params.requestId, body),
);
