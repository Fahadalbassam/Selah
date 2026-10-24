import { z } from "zod";
import { route } from "@/server/http";
import { startPitch } from "@/services/prospects";

const body = z
  .object({
    name: z.string().trim().min(2).max(200),
    nameAr: z.string().trim().max(200).optional(),
    projectTitle: z.string().trim().min(2).max(200),
  })
  .strict();

/** Any consultant or the firm admin: pitch a company the firm approached. The prospect and its draft project stay firm-only. */
export const POST = route({ body }, ({ tx, principal, body }) =>
  startPitch(tx, principal, { name: body.name, nameAr: body.nameAr || null, projectTitle: body.projectTitle }),
);
