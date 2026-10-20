import { z } from "zod";
import { route } from "@/server/http";
import { projectMetrics } from "@/services/follow-through";

export const GET = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => projectMetrics(tx, principal, params.id));
