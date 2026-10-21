import { z } from "zod";
import { ENGAGEMENT_MODES } from "@/lib/engagement";
import { route } from "@/server/http";
import { createClient } from "@/services/staffing";

const body = z.object({
  name: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().max(200).optional(),
  engagementMode: z.enum(ENGAGEMENT_MODES).default("full"),
});

export const POST = route({ body }, ({ tx, principal, body }) =>
  createClient(tx, principal, { name: body.name, nameAr: body.nameAr || undefined, engagementMode: body.engagementMode }),
);
