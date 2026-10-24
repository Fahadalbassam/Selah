import { z } from "zod";
import { CLOSURE_LIMITS } from "@/lib/closure";
import { route } from "@/server/http";
import { writeLessons } from "@/services/closure";

const text = z.string().trim().max(CLOSURE_LIMITS.lessons);

/** The firm's lessons from closing: what went well, what to improve, what to do next time. */
export const PUT = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ wentWell: text.min(3), toImprove: text.min(3), nextTime: text.nullish() }).strict() },
  ({ tx, principal, params, body }) => writeLessons(tx, principal, params.id, body),
);
