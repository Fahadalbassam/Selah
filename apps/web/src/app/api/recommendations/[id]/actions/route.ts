import { z } from "zod";
import { route } from "@/server/http";
import { createAction } from "@/services/plan";

const body = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(8000).optional(),
  ownerUserId: z.uuid().optional(),
  ownerName: z.string().trim().min(1).max(200).optional(),
  departmentId: z.uuid().optional(),
  dueDate: z.iso.date().optional(),
  evidence: z
    .array(z.object({ title: z.string().trim().min(1).max(300), description: z.string().trim().max(4000).optional() }))
    .max(50)
    .optional(),
  release: z.boolean().default(false),
});

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  createAction(tx, principal, params.id, body),
);
