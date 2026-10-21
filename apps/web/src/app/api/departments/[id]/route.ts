import { z } from "zod";
import { route } from "@/server/http";
import { updateDepartment } from "@/services/engagement";

const body = z
  .object({ nameAr: z.string().trim().min(1).max(200), nameEn: z.string().trim().max(200).nullable(), active: z.boolean() })
  .partial()
  .refine((b) => Object.keys(b).length > 0);

export const PATCH = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  updateDepartment(tx, principal, params.id, body),
);
