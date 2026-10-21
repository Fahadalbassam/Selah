import { z } from "zod";
import { route } from "@/server/http";
import { createDepartment } from "@/services/engagement";

const body = z.object({ nameAr: z.string().trim().min(1).max(200), nameEn: z.string().trim().max(200).optional() });

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  createDepartment(tx, principal, params.id, { nameAr: body.nameAr, nameEn: body.nameEn || null }),
);
