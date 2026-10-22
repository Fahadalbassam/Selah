import { z } from "zod";
import { route } from "@/server/http";
import { ask } from "@/services/assistant";

const caseType = z.enum(["recommendation", "action", "finding", "meeting", "document"]);
const body = z
  .object({
    projectId: z.uuid(),
    question: z.string().trim().min(1).max(2000),
    conversationId: z.uuid().optional(),
    // Only when starting a chat: the record it is about (the database checks it is in the project).
    caseType: caseType.optional(),
    caseId: z.uuid().optional(),
    language: z.enum(["ar", "en", "auto"]).default("auto"),
  })
  .refine((b) => (b.caseType === undefined) === (b.caseId === undefined), { message: "caseType and caseId go together" });

export const POST = route({ body }, ({ tx, principal, body: { caseType, caseId, ...rest } }) =>
  ask(tx, principal, { ...rest, case: caseType && caseId ? { type: caseType, id: caseId } : undefined }),
);
