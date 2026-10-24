import { z } from "zod";
import { route } from "@/server/http";
import { removeMember } from "@/services/client-groups";

/** Unlink a client from the group. */
export const DELETE = route({ params: z.object({ id: z.uuid(), clientId: z.uuid() }) }, ({ tx, principal, params }) =>
  removeMember(tx, principal, params.id, params.clientId),
);
