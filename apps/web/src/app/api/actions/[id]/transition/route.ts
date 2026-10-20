import { z } from "zod";
import { route } from "@/server/http";
import { transitionAction } from "@/services/actions";

const body = z.object({
  to: z.enum(["assigned", "in_progress", "blocked", "awaiting_review", "revision_requested", "verified_complete", "closed"]),
  reason: z.string().trim().min(1).max(4000).optional(),
  closure: z
    .object({
      outcome: z.enum(["partially_implemented", "risk_accepted", "not_applicable", "superseded"]),
      note: z.string().trim().min(1).max(4000),
      supersededBy: z.uuid().optional(),
    })
    .optional(),
});

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  transitionAction(tx, principal, params.id, body),
);
