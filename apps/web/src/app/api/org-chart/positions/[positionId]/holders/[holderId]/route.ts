import { z } from "zod";
import { route } from "@/server/http";
import { removeHolder } from "@/services/org-chart";

// Remove a holding entered by mistake (a typo, the wrong person). It cannot
// be undone: the row is deleted, and the audit log keeps only that a holding
// was removed from this position, by whom and when, never the name. For the
// people who change holders; anyone else 404.
export const DELETE = route({ params: z.object({ positionId: z.uuid(), holderId: z.uuid() }) }, ({ tx, principal, params }) =>
  removeHolder(tx, principal, params.positionId, params.holderId),
);
