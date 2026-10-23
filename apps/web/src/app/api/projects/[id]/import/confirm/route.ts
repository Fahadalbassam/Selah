import { z } from "zod";
import { IMPORT_FIELDS, MAX_IMPORT_ROWS } from "@/lib/plan-import";
import { route } from "@/server/http";
import { confirmImport } from "@/services/plan-import";

// Step two: the rows a person reviewed. The server checks them all again and
// creates the findings, recommendations and actions in one transaction.
const values = z.object(Object.fromEntries(IMPORT_FIELDS.map((f) => [f, z.string().max(10_000).optional()]))) as z.ZodType<
  Partial<Record<(typeof IMPORT_FIELDS)[number], string>>
>;

export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    body: z.object({
      token: z.string().min(1).max(2000),
      rows: z
        .array(z.object({ line: z.number().int().min(1).max(100_000), values }))
        .min(1)
        .max(MAX_IMPORT_ROWS),
      options: z.object({ visibility: z.enum(["shared", "firm_private"]), release: z.boolean() }),
    }),
  },
  ({ tx, principal, params, body }) => confirmImport(tx, principal, params.id, body),
);
