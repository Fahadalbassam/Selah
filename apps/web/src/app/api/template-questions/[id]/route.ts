import { z } from "zod";
import { questionBody } from "@/lib/assessment-schemas";
import { route } from "@/server/http";
import { deleteQuestion, updateQuestion } from "@/services/assessments";

const params = z.object({ id: z.uuid() });

export const PATCH = route(
  {
    params,
    body: questionBody
      .omit({ weight: true })
      .extend({ weight: z.number().int().min(1).max(3) })
      .partial()
      .refine((b) => Object.keys(b).length > 0),
  },
  ({ tx, principal, params, body }) => updateQuestion(tx, principal, params.id, body),
);

export const DELETE = route({ params }, ({ tx, principal, params }) => deleteQuestion(tx, principal, params.id));
