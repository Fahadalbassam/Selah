import { z } from "zod";
import { ENGAGEMENT_MODES } from "@/lib/engagement";
import { engagementInput } from "@/lib/engagements";
import { route } from "@/server/http";
import { convertInquiry } from "@/services/inquiries";

const body = z.object({
  client: z.union([
    z.object({
      name: z.string().trim().min(2).max(200),
      nameAr: z.string().trim().max(200).optional(),
      engagementMode: z.enum(ENGAGEMENT_MODES).optional(),
    }),
    z.object({ existingClientId: z.uuid() }),
  ]),
  leadUserId: z.uuid().optional(),
  engagement: engagementInput,
  projectTitle: z.string().trim().min(2).max(200).optional(),
});

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  convertInquiry(tx, principal, params.id, body),
);
