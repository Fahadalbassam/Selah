import { z } from "zod";
import { route } from "@/server/http";
import { updateFollowUp } from "@/services/meetings";

// The assignee may send only `status`.
const body = z.object({
  title: z.string().trim().min(2).max(300).optional(),
  dueAt: z.coerce.date().nullable().optional(),
  assigneeUserId: z.uuid().nullable().optional(),
  visibility: z.enum(["shared", "firm_private"]).optional(),
  status: z.enum(["open", "done"]).optional(),
});

export const PATCH = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  updateFollowUp(tx, principal, params.id, body),
);
