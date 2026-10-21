import { z } from "zod";
import { route } from "@/server/http";
import { recordDecision } from "@/services/meetings";

const body = z.object({
  text: z.string().trim().min(2).max(4000),
  lang: z.enum(["ar", "en"]),
  decidedBy: z.string().trim().max(200).optional(),
  supersedesId: z.uuid().optional(),
  visibility: z.enum(["shared", "firm_private"]).optional(),
});

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  recordDecision(tx, principal, params.id, body),
);
