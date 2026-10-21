import { z } from "zod";
import { templateBody } from "@/lib/assessment-schemas";
import { route } from "@/server/http";
import { updateTemplate } from "@/services/assessments";

const body = templateBody
  .partial()
  .extend({ archived: z.boolean().optional() })
  .refine((b) => Object.keys(b).length > 0);

/** Rename or describe a template, or archive it (kept off new assessments) and bring it back. */
export const PATCH = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  updateTemplate(tx, principal, params.id, body),
);
