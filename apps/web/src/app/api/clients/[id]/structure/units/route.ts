import { z } from "zod";
import { ORG_CHART_LIMITS, ORG_UNIT_KINDS } from "@/lib/org-chart";
import { route } from "@/server/http";
import { addUnit, startChart } from "@/services/org-chart";

// Add a unit to the client's draft structure (the firm's editors), at the top
// or under a unit of the draft. The first unit also starts the structure, so
// an editor starts one by adding its first unit. Everyone else: 404.
const body = z.object({
  kind: z.enum(ORG_UNIT_KINDS),
  nameAr: z.string().max(ORG_CHART_LIMITS.name).nullish(),
  nameEn: z.string().max(ORG_CHART_LIMITS.name).nullish(),
  code: z.string().max(40).nullish(),
  level: z.number().int().min(ORG_CHART_LIMITS.level.min).max(ORG_CHART_LIMITS.level.max).nullish(),
  advisory: z.boolean().optional(),
  departmentId: z.uuid().nullish(),
  parentId: z.uuid().nullish(),
  index: z.number().int().min(0).max(10_000).optional(),
});

export const POST = route({ params: z.object({ id: z.uuid() }), body }, async ({ tx, principal, params, body }) => {
  await startChart(tx, principal, params.id);
  return addUnit(tx, principal, params.id, body);
});
