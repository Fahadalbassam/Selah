import { z } from "zod";
import { CLOSURE_LIMITS } from "@/lib/closure";
import { route } from "@/server/http";
import { getClosure, moveClosure } from "@/services/closure";

const params = z.object({ id: z.uuid() });
const body = z.discriminatedUnion("step", [
  z.object({ step: z.enum(["start", "cancel", "close"]) }).strict(),
  z.object({ step: z.literal("reopen"), reason: z.string().trim().min(CLOSURE_LIMITS.reason.min).max(CLOSURE_LIMITS.reason.max) }).strict(),
]);

/** Where closing stands: open items, what blocks it, the lessons, the client's request. */
export const GET = route({ params }, ({ tx, principal, params }) => getClosure(tx, principal, params.id));

/** Start, cancel or finish closing (the firm admin, or an internal project's lead); reopen (the firm admin, with a reason). */
export const POST = route({ params, body }, ({ tx, principal, params, body }) => moveClosure(tx, principal, params.id, body));
