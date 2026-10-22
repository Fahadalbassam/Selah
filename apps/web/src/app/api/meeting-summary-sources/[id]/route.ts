import { z } from "zod";
import { route } from "@/server/http";
import { removeSummarySource } from "@/services/meetings";

export const DELETE = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  removeSummarySource(tx, principal, params.id),
);
