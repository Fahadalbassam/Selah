import { z } from "zod";
import { SUPPORT_LIMITS } from "@/lib/help";
import { route } from "@/server/http";
import { reportProblem } from "@/services/help";

/** A client person reports a technical problem to the firm's admins (F13), at most five a day. */
export const POST = route(
  { body: z.object({ body: z.string().trim().min(1).max(SUPPORT_LIMITS.body) }).strict() },
  ({ tx, principal, body }) => reportProblem(tx, principal, body),
);
