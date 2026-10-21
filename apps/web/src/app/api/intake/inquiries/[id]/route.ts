import { z } from "zod";
import { route } from "@/server/http";
import { getInquiry, updateInquiry } from "@/services/inquiries";

const params = z.object({ id: z.uuid() });

export const GET = route({ params }, ({ tx, principal, params }) => getInquiry(tx, principal, params.id));

// Moving it forward is the owner's; anything else is the admin's. Won is
// reached through /convert.
const body = z
  .object({
    status: z
      .enum(["triaged", "discovery_scheduled", "discovery_done", "proposal_sent", "lost", "declined", "spam", "withdrawn", "new"])
      .optional(),
    ownerUserId: z.uuid().nullable().optional(),
    conflictStatus: z.enum(["not_checked", "clear", "flagged", "waived"]).optional(),
    conflictNote: z.string().trim().min(1).max(2000).nullable().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), "nothing to change");

export const PATCH = route({ params, body }, ({ tx, principal, params, body }) => updateInquiry(tx, principal, params.id, body));
