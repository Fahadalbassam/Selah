import { z } from "zod";
import { route } from "@/server/http";
import { saveSummary } from "@/services/meetings";

// Firm-private unless shared on purpose.
const body = z.object({
  lang: z.enum(["ar", "en"]),
  mainPointsMd: z.string().trim().min(1).max(20000),
  visibility: z.enum(["shared", "firm_private"]).optional(),
});

export const PUT = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  saveSummary(tx, principal, params.id, body),
);
