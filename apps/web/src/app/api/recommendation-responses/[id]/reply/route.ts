import { z } from "zod";
import { route } from "@/server/http";
import { replyToResponse } from "@/services/responses";

/** The firm's answer to a client's response, once. */
export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ reply: z.string().trim().min(1).max(4000) }) },
  ({ tx, principal, params, body }) => replyToResponse(tx, principal, params.id, body),
);
