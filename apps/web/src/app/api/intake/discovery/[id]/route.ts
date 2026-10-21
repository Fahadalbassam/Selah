import { z } from "zod";
import { route } from "@/server/http";
import { recordDiscovery } from "@/services/inquiries";

const body = z.object({
  heldAt: z.coerce.date().optional(),
  notes: z.string().trim().max(8000).optional(),
  outcome: z.enum(["proceed", "not_a_fit", "needs_followup"]).optional(),
});

export const PATCH = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  recordDiscovery(tx, principal, params.id, body),
);
