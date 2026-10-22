import { z } from "zod";
import { route } from "@/server/http";
import { retakeAssessment } from "@/services/assessments";

// A new assessment of the same project on the same template, to compare with this one.
export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ title: z.string().trim().min(1).max(200).optional() }) },
  ({ tx, principal, params, body }) => retakeAssessment(tx, principal, params.id, body),
);
