import { z } from "zod";
import { ORG_CHART_LIMITS } from "@/lib/org-chart";
import { route } from "@/server/http";
import { setActive } from "@/services/accounts";

// Switch an account off (a reason is required) or back on. Switching a client
// person off ends the positions they hold on the leaving day; `replacements`
// names who takes each over from the next day (left out: it stays vacant).
const replacement = z
  .object({
    positionId: z.uuid(),
    userId: z.uuid().optional(),
    name: z.string().trim().min(ORG_CHART_LIMITS.holderName.min).max(ORG_CHART_LIMITS.holderName.max).optional(),
  })
  .refine((r) => (r.userId === undefined) !== (r.name === undefined));
const body = z.object({
  active: z.boolean(),
  reason: z.string().trim().min(1).max(500).optional(),
  replacements: z.array(replacement).max(50).optional(),
});

export const PATCH = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  setActive(tx, principal, params.id, body),
);
