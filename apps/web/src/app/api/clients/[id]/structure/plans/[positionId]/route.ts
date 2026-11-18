import { z } from "zod";
import { route } from "@/server/http";
import { clearPlan } from "@/services/org-chart-import";

/**
 * Remove who is planned for a position of the client's draft (org chart,
 * part 4: the draft editor's "Remove plan"). For the draft's editors only;
 * anyone else, another client, or a position outside the draft: 404.
 */
export const DELETE = route({ params: z.object({ id: z.uuid(), positionId: z.uuid() }) }, ({ tx, principal, params }) =>
  clearPlan(tx, principal, params.id, params.positionId),
);
