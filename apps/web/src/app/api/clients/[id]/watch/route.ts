import { z } from "zod";
import { route } from "@/server/http";
import { setWatch } from "@/services/staffing";

export const PUT = route({ params: z.object({ id: z.uuid() }), body: z.object({ on: z.boolean() }) }, ({ tx, principal, params, body }) =>
  setWatch(tx, principal, { clientOrgId: params.id }, body.on),
);
