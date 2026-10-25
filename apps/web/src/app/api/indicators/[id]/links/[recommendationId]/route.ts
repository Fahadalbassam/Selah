import { z } from "zod";
import { route } from "@/server/http";
import { unlinkRecommendation } from "@/services/indicators";

export const DELETE = route({ params: z.object({ id: z.uuid(), recommendationId: z.uuid() }) }, ({ tx, principal, params }) =>
  unlinkRecommendation(tx, principal, params.id, params.recommendationId),
);
