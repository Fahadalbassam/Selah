import { z } from "zod";
import { ORG_CHART_LIMITS } from "@/lib/org-chart";
import { route } from "@/server/http";
import { deletePosition, updatePosition } from "@/services/org-chart";

// A position of a client's draft structure: its titles, code, whom it reports
// to, whether it heads its unit, its specialties and how many people it is
// planned for; or remove it (the firm's editors only).
const params = z.object({ positionId: z.uuid() });

const body = z.object({
  titleAr: z.string().max(ORG_CHART_LIMITS.name).nullish(),
  titleEn: z.string().max(ORG_CHART_LIMITS.name).nullish(),
  code: z.string().max(40).optional(),
  reportsToId: z.uuid().nullish(),
  isHead: z.boolean().optional(),
  specialties: z.array(z.string().max(ORG_CHART_LIMITS.specialties.length)).max(ORG_CHART_LIMITS.specialties.count).optional(),
  plannedCount: z.number().int().min(ORG_CHART_LIMITS.planned.min).max(ORG_CHART_LIMITS.planned.max).optional(),
});

export const PATCH = route({ params, body }, ({ tx, principal, params, body }) => updatePosition(tx, principal, params.positionId, body));

export const DELETE = route({ params }, ({ tx, principal, params }) => deletePosition(tx, principal, params.positionId));
