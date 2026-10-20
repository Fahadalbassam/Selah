import { z } from "zod";
import { route } from "@/server/http";
import { decideRequest } from "@/services/staffing";

export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ approve: z.boolean(), note: z.string().trim().max(2000).optional() }) },
  ({ tx, principal, params, body }) => decideRequest(tx, principal, params.id, body),
);
