import { z } from "zod";
import { route } from "@/server/http";
import { setLead } from "@/services/staffing";

export const PUT = route({ params: z.object({ id: z.uuid() }), body: z.object({ userId: z.uuid() }) }, ({ tx, principal, params, body }) =>
  setLead(tx, principal, params.id, body.userId),
);
