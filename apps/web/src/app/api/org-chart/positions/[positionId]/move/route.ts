import { z } from "zod";
import { route } from "@/server/http";
import { movePosition } from "@/services/org-chart";

// Move a position of the draft up, down or to another unit of the draft.
export const POST = route(
  {
    params: z.object({ positionId: z.uuid() }),
    body: z.object({ unitId: z.uuid(), index: z.number().int().min(0).max(10_000).optional() }),
  },
  ({ tx, principal, params, body }) => movePosition(tx, principal, params.positionId, body),
);
