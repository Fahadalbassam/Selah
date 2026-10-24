import { z } from "zod";
import { route } from "@/server/http";
import { assistantContext } from "@/services/assistant";

const query = z.object({
  locale: z.enum(["ar", "en"]).default("ar"),
  project: z.uuid().optional(),
  // "action:<id>": a new chat about that record.
  case: z
    .string()
    .regex(/^(recommendation|action|finding|meeting|document):[0-9a-f-]{36}$/)
    .optional(),
});

/** The floating assistant card's start: the projects the person may ask about, an optional case, and a client's usage today. */
export const GET = route({ query }, ({ tx, principal, query: q }) => {
  const [type, id] = q.case ? (q.case.split(":") as ["recommendation" | "action" | "finding" | "meeting" | "document", string]) : [];
  return assistantContext(tx, principal, { locale: q.locale, projectId: q.project, case: type && id ? { type, id } : undefined });
});
