import { z } from "zod";
import { route } from "@/server/http";
import { assessmentFollowUp } from "@/services/assessments";

/** Each confirmed gap with its recommendations and actions: reported, evidenced and verified kept apart. */
export const GET = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  assessmentFollowUp(tx, principal, params.id),
);
