import { z } from "zod";
import { route } from "@/server/http";
import { shareAssessment } from "@/services/assessments";

/** Show a final assessment to the client's admins and managers on the project, or stop. */
export const PUT = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ shared: z.boolean() }) },
  ({ tx, principal, params, body }) => shareAssessment(tx, principal, params.id, body.shared),
);
