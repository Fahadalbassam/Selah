import { z } from "zod";
import { TRANSLATABLE_TYPES } from "@/lib/translations";
import { route } from "@/server/http";
import { accepted, fileJob } from "@/services/ai-jobs";
import { requestTranslation } from "@/services/translations";

// A text in the other language: the kept translation (200), or a job that
// asks the model (202 with the job; docs/assistant.md, "Slow calls as
// jobs"): the page asks after the job, then here again for the text. POST
// because it may spend a model call. The person must read the original, or 404.
const body = z.object({
  entityType: z.enum(TRANSLATABLE_TYPES as [string, ...string[]]),
  entityId: z.uuid(),
  field: z.string().regex(/^[a-z_]{1,40}$/),
  to: z.enum(["ar", "en"]),
});

export const POST = route({ body }, async ({ tx, principal, body }) => {
  const done = await requestTranslation(tx, body);
  if (done) return done;
  return accepted(await fileJob(tx, principal, "translation", `translation:${body.entityType}:${body.entityId}:${body.field}:${body.to}`, body));
});
