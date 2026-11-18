import { z } from "zod";
import { ORG_IMPORT_FIELDS, ORG_IMPORT_LIMITS } from "@/lib/org-chart-import";
import { route } from "@/server/http";
import { saveImport } from "@/services/org-chart-import";

// Org chart, part 4, step two: the rows a person reviewed. The server checks
// them all again and writes them into the client's draft in one transaction
// ("replace" or "add", asked when the draft already holds something).
// Nothing is published.
const values = z.object(Object.fromEntries(ORG_IMPORT_FIELDS.map((f) => [f, z.string().max(2000).optional()]))) as z.ZodType<
  Partial<Record<(typeof ORG_IMPORT_FIELDS)[number], string>>
>;

export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    body: z.object({
      token: z.string().min(1).max(2000),
      rows: z
        .array(z.object({ line: z.number().int().min(1).max(100_000), values }))
        .min(1)
        .max(ORG_IMPORT_LIMITS.rows),
      mode: z.enum(["replace", "add"]).optional(),
    }),
  },
  ({ tx, principal, params, body }) => saveImport(tx, principal, params.id, body),
);
