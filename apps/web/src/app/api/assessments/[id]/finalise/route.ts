import { z } from "zod";
import { route } from "@/server/http";
import { finaliseAssessment } from "@/services/assessments";

/** Every applicable question answered: the answers are kept as they are and gaps can be confirmed. */
export const POST = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  finaliseAssessment(tx, principal, params.id),
);
