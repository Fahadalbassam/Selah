import { z } from "zod";
import { MAIL_CADENCES, REMINDER_CADENCES, isClockTime } from "@/lib/mail-choices";
import { route } from "@/server/http";
import { getMailPreferences, setMailPreferences } from "@/services/notifications";

// The caller's own mail choices. Row-level security keeps each person to their own row.
const clock = z.string().refine(isClockTime).nullable();
const body = z
  .object({
    updates: z.enum(MAIL_CADENCES),
    reminders: z.enum(REMINDER_CADENCES),
    quietFrom: clock,
    quietTo: clock,
    saturday: z.boolean(),
    ramadan: z.boolean(),
  })
  .partial();

export const GET = route({}, ({ tx, principal }) => getMailPreferences(tx, principal));
export const PUT = route({ body }, ({ tx, principal, body }) => setMailPreferences(tx, principal, body));
