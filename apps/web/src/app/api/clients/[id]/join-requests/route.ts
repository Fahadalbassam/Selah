import { z } from "zod";
import { route } from "@/server/http";
import { requestToJoin } from "@/services/staffing";

export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ reason: z.string().trim().min(3).max(2000) }) },
  ({ tx, principal, params, body }) => requestToJoin(tx, principal, params.id, body.reason),
);
