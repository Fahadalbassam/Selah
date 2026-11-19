import { z } from "zod";
import { route } from "@/server/http";
import { setLead } from "@/services/staffing";

// The handover note is optional: a short line for the new lead, read by firm staff on the client only.
export const PUT = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ userId: z.uuid(), handoverNote: z.string().trim().max(4000).nullish() }) },
  ({ tx, principal, params, body }) => setLead(tx, principal, params.id, body.userId, body.handoverNote),
);
