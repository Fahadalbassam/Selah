import { z } from "zod";
import { route } from "@/server/http";
import { createFinding } from "@/services/plan";

const body = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(8000).optional(),
  visibility: z.enum(["shared", "firm_private"]).default("shared"),
});

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  createFinding(tx, principal, params.id, body),
);
