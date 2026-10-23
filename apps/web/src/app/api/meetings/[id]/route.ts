import { z } from "zod";
import { SPOKEN_LANGS } from "@/lib/meetings";
import { route } from "@/server/http";
import { getMeeting, updateMeeting } from "@/services/meetings";

// Moving it or changing the link bumps the calendar sequence; send the
// invites again afterwards.
const body = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  location: z.enum(["online", "in_person", "phone"]).optional(),
  joinUrl: z.url().max(500).nullable().optional(),
  locationText: z.string().trim().max(300).nullable().optional(),
  spokenLang: z.enum(SPOKEN_LANGS).optional(),
  status: z.enum(["held", "cancelled"]).optional(),
  transcriptConsent: z.boolean().optional(),
});

export const GET = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  getMeeting(tx, principal, params.id),
);
export const PATCH = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  updateMeeting(tx, principal, params.id, body),
);
