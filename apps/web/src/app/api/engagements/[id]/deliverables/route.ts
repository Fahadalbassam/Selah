import { z } from "zod";
import { deliverableInput } from "@/lib/engagements";
import { route } from "@/server/http";
import { addDeliverable } from "@/services/engagements";

/** Firm admin: a deliverable the engagement promises, and how the client accepts it. */
export const POST = route({ params: z.object({ id: z.uuid() }), body: deliverableInput.strict() }, ({ tx, principal, params, body }) =>
  addDeliverable(tx, principal, params.id, body),
);
