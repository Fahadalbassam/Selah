import { z } from "zod";
import { route } from "@/server/http";
import { setAssistantFlag } from "@/services/documents";

/** The side that owns a file switches whether the assistant may read it. */
export const PUT = route({ params: z.object({ id: z.uuid() }), body: z.object({ on: z.boolean() }).strict() }, ({ tx, principal, params, body }) =>
  setAssistantFlag(tx, principal, params.id, body.on),
);
