import { z } from "zod";
import { ORG_CHART_LIMITS, ORG_UNIT_KINDS } from "@/lib/org-chart";
import { route } from "@/server/http";
import { deleteUnit, updateUnit } from "@/services/org-chart";

// A unit of a client's draft structure: rename it or change its details, or
// remove it once empty (the firm's editors; everyone else, and any published
// unit: refused).
const params = z.object({ unitId: z.uuid() });

const body = z.object({
  kind: z.enum(ORG_UNIT_KINDS).optional(),
  nameAr: z.string().max(ORG_CHART_LIMITS.name).nullish(),
  nameEn: z.string().max(ORG_CHART_LIMITS.name).nullish(),
  code: z.string().max(40).optional(),
  level: z.number().int().min(ORG_CHART_LIMITS.level.min).max(ORG_CHART_LIMITS.level.max).optional(),
  advisory: z.boolean().optional(),
  departmentId: z.uuid().nullish(),
});

export const PATCH = route({ params, body }, ({ tx, principal, params, body }) => updateUnit(tx, principal, params.unitId, body));

export const DELETE = route({ params }, ({ tx, principal, params }) => deleteUnit(tx, principal, params.unitId));
