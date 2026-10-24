import { z } from "zod";
import { route } from "@/server/http";
import { withdrawRecord } from "@/services/plan-changes";

/** Take a released recommendation back, with the reason. Its open actions close as not applicable. */
export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ reason: z.string().trim().min(1).max(4000) }) },
  ({ tx, principal, params, body }) => withdrawRecord(tx, principal, "recommendation", params.id, body),
);
