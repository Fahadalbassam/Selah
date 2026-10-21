import { z } from "zod";
import { route } from "@/server/http";
import { respond } from "@/services/meetings";

// The signed-in attendee's own answer.
const body = z.object({ response: z.enum(["accepted", "declined", "tentative"]) });

export const PUT = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  respond(tx, principal, params.id, body.response),
);
