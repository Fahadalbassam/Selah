import { z } from "zod";
import { route } from "@/server/http";
import { requestDeadlineChange } from "@/services/follow-through";

const body = z.object({ proposedDueDate: z.iso.date(), reason: z.string().trim().min(1).max(4000) });

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  requestDeadlineChange(tx, principal, params.id, body),
);
