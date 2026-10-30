import { z } from "zod";
import { MAX_IMPORT_VALUES } from "@/lib/indicator-import";
import { route } from "@/server/http";
import { confirmIndicatorImport } from "@/services/indicator-data";

// Step two: the figures a person reviewed, each matched to an indicator. The
// server checks them all again and saves them as one batch.
export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    body: z.object({
      token: z.string().min(1).max(2000),
      corrections: z.boolean(),
      values: z
        .array(
          z.object({
            line: z.number().int().min(1).max(1_000_000),
            label: z.string().max(300),
            kpiId: z.uuid(),
            period: z.iso.date(),
            value: z.number().finite().min(-1e12).max(1e12),
            note: z.string().max(1000).nullable(),
          }),
        )
        .min(1)
        .max(MAX_IMPORT_VALUES),
    }),
  },
  ({ tx, principal, params, body }) => confirmIndicatorImport(tx, principal, params.id, body),
);
