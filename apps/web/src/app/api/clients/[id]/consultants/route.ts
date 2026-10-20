import { z } from "zod";
import { route } from "@/server/http";
import { addConsultant } from "@/services/staffing";

export const POST = route({ params: z.object({ id: z.uuid() }), body: z.object({ userId: z.uuid() }) }, ({ tx, principal, params, body }) =>
  addConsultant(tx, principal, params.id, body.userId),
);
