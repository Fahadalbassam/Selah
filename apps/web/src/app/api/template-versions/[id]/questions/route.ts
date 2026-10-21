import { z } from "zod";
import { questionBody } from "@/lib/assessment-schemas";
import { route } from "@/server/http";
import { addQuestion } from "@/services/assessments";

export const POST = route({ params: z.object({ id: z.uuid() }), body: questionBody }, ({ tx, principal, params, body }) =>
  addQuestion(tx, principal, params.id, body),
);
