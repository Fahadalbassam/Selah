import { z } from "zod";
import { SIGN_OFF_NOTE_MAX } from "@/lib/second-review";
import { route } from "@/server/http";
import { signOff } from "@/services/second-review";

// The first of two sign-offs on work that needs a second consultant (F22).
const body = z.object({ note: z.string().trim().min(1).max(SIGN_OFF_NOTE_MAX).optional() });

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  signOff(tx, principal, params.id, body.note),
);
