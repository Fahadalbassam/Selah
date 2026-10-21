import { z } from "zod";
import { route } from "@/server/http";
import { resetTwoFactor } from "@/services/accounts";

// An admin resets someone's two-factor sign-in, for a lost phone.
export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ reason: z.string().trim().min(1).max(500) }) },
  ({ tx, principal, params, body }) => resetTwoFactor(tx, principal, params.id, body.reason),
);
