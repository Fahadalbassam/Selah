import { z } from "zod";
import { route } from "@/server/http";
import { addAnswerEvidence, removeAnswerEvidence } from "@/services/assessments";

const params = z.object({ id: z.uuid(), documentId: z.uuid() });

/** Back an answer with a file of the project (uploaded and scanned the usual way). */
export const PUT = route({ params }, ({ tx, principal, params }) =>
  addAnswerEvidence(tx, principal, params.id, params.documentId),
);

export const DELETE = route({ params }, ({ tx, principal, params }) =>
  removeAnswerEvidence(tx, principal, params.id, params.documentId),
);
