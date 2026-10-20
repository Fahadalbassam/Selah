import { z } from "zod";
import { route } from "@/server/http";
import { convertInquiry } from "@/services/inquiries";

const body = z.object({
  client: z.union([
    z.object({ name: z.string().trim().min(2).max(200), nameAr: z.string().trim().max(200).optional() }),
    z.object({ existingClientId: z.uuid() }),
  ]),
  leadUserId: z.uuid().optional(),
  projectTitle: z.string().trim().min(2).max(200).optional(),
});

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  convertInquiry(tx, principal, params.id, body),
);
