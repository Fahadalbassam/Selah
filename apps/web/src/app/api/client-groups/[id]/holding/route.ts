import { z } from "zod";
import { route } from "@/server/http";
import { setHolding } from "@/services/client-groups";

/** Name the member client that is the group's holding, or none (the firm admin only). */
export const PUT = route({ params: z.object({ id: z.uuid() }), body: z.object({ clientOrgId: z.uuid().nullable() }) }, ({ tx, principal, params, body }) =>
  setHolding(tx, principal, params.id, body.clientOrgId),
);
