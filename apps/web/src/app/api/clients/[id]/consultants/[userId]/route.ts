import { z } from "zod";
import { route } from "@/server/http";
import { removeConsultant } from "@/services/staffing";

export const DELETE = route({ params: z.object({ id: z.uuid(), userId: z.uuid() }) }, ({ tx, principal, params }) =>
  removeConsultant(tx, principal, params.id, params.userId),
);
