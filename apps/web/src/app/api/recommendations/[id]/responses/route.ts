import { z } from "zod";
import { RECEIVED_VIA } from "@/lib/engagement";
import { STANCES } from "@/lib/responses";
import { route } from "@/server/http";
import { recordResponse } from "@/services/responses";

// The client's response to a recommendation (F10). receivedVia and
// receivedOn: only when firm staff record for a consultant-managed client.
const body = z.object({
  stance: z.enum(STANCES),
  reason: z.string().trim().max(4000).nullish(),
  plannedAction: z.string().trim().max(4000).nullish(),
  actionOwner: z.string().trim().max(200).nullish(),
  targetDate: z.iso.date().nullish(),
  receivedVia: z.enum(RECEIVED_VIA).optional(),
  receivedOn: z.iso.date().optional(),
});

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  recordResponse(tx, principal, params.id, body),
);
