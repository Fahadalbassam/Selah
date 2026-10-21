import { z } from "zod";
import { templateBody } from "@/lib/assessment-schemas";
import { route } from "@/server/http";
import { duplicateTemplate } from "@/services/assessments";

/** A copy of the template as a new template's first draft. */
export const POST = route({ params: z.object({ id: z.uuid() }), body: templateBody }, ({ tx, principal, params, body }) =>
  duplicateTemplate(tx, principal, params.id, body),
);
