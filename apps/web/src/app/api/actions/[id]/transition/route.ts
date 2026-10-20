import { z } from "zod";
import { route } from "@/server/http";
import { transitionAction } from "@/services/actions";

const body = z.object({
  to: z.enum(["assigned", "in_progress", "blocked", "awaiting_review", "revision_requested", "verified_complete"]),
  reason: z.string().trim().min(1).max(4000).optional(),
});

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  transitionAction(tx, principal, params.id, body),
);
