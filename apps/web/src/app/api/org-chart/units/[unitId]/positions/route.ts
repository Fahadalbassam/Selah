import { z } from "zod";
import { ORG_CHART_LIMITS } from "@/lib/org-chart";
import { route } from "@/server/http";
import { addPosition } from "@/services/org-chart";

// Add a position to a unit of the draft (the firm's editors).
const body = z.object({
  titleAr: z.string().max(ORG_CHART_LIMITS.name).nullish(),
  titleEn: z.string().max(ORG_CHART_LIMITS.name).nullish(),
  code: z.string().max(40).nullish(),
  reportsToId: z.uuid().nullish(),
  isHead: z.boolean().optional(),
  specialties: z.array(z.string().max(ORG_CHART_LIMITS.specialties.length)).max(ORG_CHART_LIMITS.specialties.count).optional(),
  plannedCount: z.number().int().min(ORG_CHART_LIMITS.planned.min).max(ORG_CHART_LIMITS.planned.max).optional(),
  index: z.number().int().min(0).max(10_000).optional(),
});

export const POST = route({ params: z.object({ unitId: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  addPosition(tx, principal, params.unitId, body),
);
