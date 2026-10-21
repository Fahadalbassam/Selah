import { z } from "zod";
import { RECEIVED_VIA } from "@/lib/engagement";
import { route } from "@/server/http";
import { addProgressUpdate } from "@/services/progress";

// receivedVia and receivedOn: only when firm staff record for a
// consultant-managed client.
const body = z.object({
  body: z.string().trim().min(1).max(4000),
  receivedVia: z.enum(RECEIVED_VIA).optional(),
  receivedOn: z.iso.date().optional(),
});

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  addProgressUpdate(tx, principal, params.id, body.body, { receivedVia: body.receivedVia, receivedOn: body.receivedOn }),
);
