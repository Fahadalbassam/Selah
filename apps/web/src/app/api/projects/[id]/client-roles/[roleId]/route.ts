import { z } from "zod";
import { route } from "@/server/http";
import { removeClientRole } from "@/services/client-roles";

/** Take someone off a client role. */
export const DELETE = route({ params: z.object({ id: z.uuid(), roleId: z.uuid() }) }, ({ tx, principal, params }) =>
  removeClientRole(tx, principal, params.id, params.roleId),
);
