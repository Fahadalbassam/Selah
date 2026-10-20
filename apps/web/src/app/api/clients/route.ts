import { z } from "zod";
import { route } from "@/server/http";
import { createClient } from "@/services/staffing";

const body = z.object({
  name: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().max(200).optional(),
});

export const POST = route({ body }, ({ tx, principal, body }) =>
  createClient(tx, principal, { name: body.name, nameAr: body.nameAr || undefined }),
);
