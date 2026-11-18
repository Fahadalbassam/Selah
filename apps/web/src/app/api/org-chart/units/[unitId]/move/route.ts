import { z } from "zod";
import { route } from "@/server/http";
import { moveUnit } from "@/services/org-chart";

// Move a unit of the draft: up, down, under another unit or to the top
// (never under itself or one of its own units).
export const POST = route(
  {
    params: z.object({ unitId: z.uuid() }),
    body: z.object({ parentId: z.uuid().nullable(), index: z.number().int().min(0).max(10_000).optional() }),
  },
  ({ tx, principal, params, body }) => moveUnit(tx, principal, params.unitId, body),
);
