import { z } from "zod";
import { route } from "@/server/http";
import { createGroup } from "@/services/client-groups";

const body = z.object({
  nameAr: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/** A new holding group (the firm admin only). */
export const POST = route({ body }, ({ tx, principal, body }) =>
  createGroup(tx, principal, { nameAr: body.nameAr, nameEn: body.nameEn || null, notes: body.notes || null }),
);
