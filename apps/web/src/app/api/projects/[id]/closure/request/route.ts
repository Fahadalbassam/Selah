import { z } from "zod";
import { CLOSURE_LIMITS } from "@/lib/closure";
import { route } from "@/server/http";
import { requestClosure } from "@/services/closure";

/** The client's sponsor or admin asks the firm to close the project. */
export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ note: z.string().trim().max(CLOSURE_LIMITS.note).nullish() }).strict() },
  ({ tx, principal, params, body }) => requestClosure(tx, principal, params.id, body),
);
