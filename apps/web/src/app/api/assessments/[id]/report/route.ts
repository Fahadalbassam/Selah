import { z } from "zod";
import { route } from "@/server/http";
import { assessmentReport } from "@/services/assessments";

const day = z.iso.date();

/** A report from a final assessment: scores, confirmed gaps and the work on them. Firm-private until shared. */
export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    body: z.object({
      title: z.string().trim().min(1).max(200),
      periodStart: day,
      periodEnd: day,
      lang: z.enum(["ar", "en"]).default("ar"),
    }),
  },
  ({ tx, principal, params, body }) => assessmentReport(tx, principal, params.id, body),
);
