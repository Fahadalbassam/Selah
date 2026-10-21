import { z } from "zod";
import { route } from "@/server/http";
import { confirmGap } from "@/services/assessments";

/** Confirm a gap of a final assessment as a finding; answer it with recommendations as usual. */
export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    body: z.object({
      title: z.string().trim().min(1).max(300),
      description: z.string().trim().max(8000).optional(),
      visibility: z.enum(["shared", "firm_private"]).default("shared"),
    }),
  },
  ({ tx, principal, params, body }) => confirmGap(tx, principal, params.id, body),
);
