import { z } from "zod";
import { route } from "@/server/http";
import { answerQuestion } from "@/services/assessments";

// value: yes | partly | no | na, "1".."4" | na, or a choice's value. textAnswer for text questions.
// The comment is shown to the client if the assessment is shared; firm-only notes go to /note.
const body = z
  .object({
    value: z.string().trim().min(1).max(50).nullable(),
    textAnswer: z.string().trim().max(8000).nullable(),
    comment: z.string().trim().max(4000).nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0);

export const PATCH = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  answerQuestion(tx, principal, params.id, body),
);
