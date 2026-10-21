import { z } from "zod";
import { templateBody } from "@/lib/assessment-schemas";
import { route } from "@/server/http";
import { createTemplate, listTemplates } from "@/services/assessments";

/** The firm's assessment templates (firm staff). ?archived=1 includes archived ones. */
export const GET = route({ query: z.object({ archived: z.enum(["0", "1"]).optional() }) }, ({ tx, principal, query }) =>
  listTemplates(tx, principal, { includeArchived: query.archived === "1" }),
);

/** A new template with an empty draft (template authors). */
export const POST = route({ body: templateBody }, ({ tx, principal, body }) => createTemplate(tx, principal, body));
