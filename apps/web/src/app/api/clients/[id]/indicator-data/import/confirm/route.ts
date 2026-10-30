import { z } from "zod";
import { route } from "@/server/http";
import { confirmIndicatorImport } from "@/services/indicator-data";

// Step two: the sheet a person reviewed, how they read it and what the review
// showed. The server reads the figures itself from the signed cells, checks
// them against the database and saves them as one batch.
const column = z.number().int().min(0).max(199).nullable();

export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    body: z.object({
      token: z.string().min(1).max(8000),
      sheet: z.number().int().min(0).max(29),
      rows: z.array(z.array(z.string())).max(3000),
      shape: z.object({
        layout: z.enum(["rows", "columns", "list"]),
        headerRow: z.number().int().min(0).max(2999),
        labelCol: column,
        periodCol: column,
        valueCol: column,
        noteCol: column,
      }),
      chosen: z.record(z.string(), z.uuid().nullable()),
      corrections: z.boolean(),
      expect: z.object({ add: z.number().int().min(0), correct: z.number().int().min(0) }),
    }),
  },
  ({ tx, principal, params, body }) => confirmIndicatorImport(tx, principal, params.id, body),
);
