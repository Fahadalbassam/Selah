import { z } from "zod";
import { SPOKEN_LANGS } from "@/lib/meetings";
import { route } from "@/server/http";
import { bookMeeting, listMeetings } from "@/services/meetings";

const body = z
  .object({
    kind: z.enum(["kickoff", "status", "steering", "workshop", "handover", "other"]),
    title: z.string().trim().min(2).max(200),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    location: z.enum(["online", "in_person", "phone"]),
    joinUrl: z.url().max(500).optional(),
    locationText: z.string().trim().max(300).optional(),
    spokenLang: z.enum(SPOKEN_LANGS).optional(),
    visibility: z.enum(["shared", "firm_private"]).optional(),
    attendees: z
      .array(z.object({ userId: z.uuid().optional(), contactId: z.uuid().optional(), optional: z.boolean().optional() }))
      .max(100)
      .optional(),
    sendInvites: z.boolean().optional(),
  })
  .refine((b) => b.endsAt > b.startsAt, { path: ["endsAt"], message: "ends after it starts" });

export const GET = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  listMeetings(tx, principal, params.id),
);
export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  bookMeeting(tx, principal, params.id, body),
);
