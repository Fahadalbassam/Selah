import { z } from "zod";
import { route } from "@/server/http";
import { projectTrace } from "@/services/insight";

/** Objectives, KPIs, findings, recommendations, actions, evidence and reviews as edges. */
export const GET = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  projectTrace(tx, principal, params.id),
);
