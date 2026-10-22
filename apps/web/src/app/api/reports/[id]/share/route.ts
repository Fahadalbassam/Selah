import { z } from "zod";
import { route } from "@/server/http";
import { shareReport } from "@/services/follow-through";

export const POST = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  shareReport(tx, principal, params.id),
);
