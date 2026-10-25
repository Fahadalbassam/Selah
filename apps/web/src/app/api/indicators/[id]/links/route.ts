import { z } from "zod";
import { route } from "@/server/http";
import { linkRecommendation } from "@/services/indicators";

export const POST = route({ params: z.object({ id: z.uuid() }), body: z.object({ recommendationId: z.uuid() }) }, ({ tx, principal, params, body }) =>
  linkRecommendation(tx, principal, params.id, body.recommendationId),
);
