import { z } from "zod";
import { route } from "@/server/http";
import { markNda } from "@/services/inquiries";

/** Record the day the NDA was signed. */
export const POST = route({ params: z.object({ id: z.uuid() }), body: z.object({ signedOn: z.iso.date() }).strict() }, ({ tx, principal, params, body }) =>
  markNda(tx, principal, params.id, body.signedOn),
);
