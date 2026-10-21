import { z } from "zod";
import { route } from "@/server/http";
import { decideDeadlineChange } from "@/services/follow-through";

export const PATCH = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ approve: z.boolean() }) },
  ({ tx, principal, params, body }) => decideDeadlineChange(tx, principal, params.id, body),
);
