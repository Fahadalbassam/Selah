import { z } from "zod";
import { route } from "@/server/http";
import { addMember } from "@/services/client-groups";

/** Link a client to the group as its own member company. */
export const POST = route({ params: z.object({ id: z.uuid() }), body: z.object({ clientOrgId: z.uuid() }) }, ({ tx, principal, params, body }) =>
  addMember(tx, principal, params.id, body.clientOrgId),
);
