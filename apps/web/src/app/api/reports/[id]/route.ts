import { z } from "zod";
import { route } from "@/server/http";
import { getReport } from "@/services/follow-through";

export const GET = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  getReport(tx, principal, params.id),
);
