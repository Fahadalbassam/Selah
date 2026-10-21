import { z } from "zod";
import { route } from "@/server/http";
import { scheduleDiscovery } from "@/services/inquiries";

const body = z.object({
  scheduledAt: z.coerce.date(),
  mode: z.enum(["in_person", "video", "phone"]),
  attendees: z.string().trim().max(1000).optional(),
});

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  scheduleDiscovery(tx, principal, params.id, body),
);
