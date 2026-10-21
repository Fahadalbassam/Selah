import { z } from "zod";
import { route } from "@/server/http";
import { requestEmailChange } from "@/services/accounts";

export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ newEmail: z.email().max(254) }) },
  ({ tx, principal, params, body }) => requestEmailChange(tx, principal, params.id, body.newEmail),
);
