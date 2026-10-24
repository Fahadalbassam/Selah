import { z } from "zod";
import { route } from "@/server/http";
import { withdrawRecord } from "@/services/plan-changes";

/** Take a released finding back, with the reason. */
export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ reason: z.string().trim().min(1).max(4000) }) },
  ({ tx, principal, params, body }) => withdrawRecord(tx, principal, "finding", params.id, body),
);
