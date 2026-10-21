import { z } from "zod";
import { route } from "@/server/http";
import { getAssessment, updateAssessment } from "@/services/assessments";

const params = z.object({ id: z.uuid() });

/** Questions with this client's basis for each, answers, evidence, section scores and gaps. */
export const GET = route({ params }, ({ tx, principal, params }) => getAssessment(tx, principal, params.id));

export const PATCH = route(
  { params, body: z.object({ title: z.string().trim().min(1).max(200) }) },
  ({ tx, principal, params, body }) => updateAssessment(tx, principal, params.id, body),
);
