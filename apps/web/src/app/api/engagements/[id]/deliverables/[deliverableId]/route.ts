import { z } from "zod";
import { route } from "@/server/http";
import { removeDeliverable } from "@/services/engagements";

export const DELETE = route({ params: z.object({ id: z.uuid(), deliverableId: z.uuid() }) }, ({ tx, principal, params }) =>
  removeDeliverable(tx, principal, params.id, params.deliverableId),
);
