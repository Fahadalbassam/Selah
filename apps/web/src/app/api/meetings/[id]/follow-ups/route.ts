import { z } from "zod";
import { route } from "@/server/http";
import { addFollowUp } from "@/services/meetings";

// Same visibility as the meeting unless set; a firm-private meeting keeps them firm-private.
const body = z.object({
  title: z.string().trim().min(2).max(300),
  dueAt: z.coerce.date().nullable().optional(),
  assigneeUserId: z.uuid().nullable().optional(),
  decisionId: z.uuid().nullable().optional(),
  visibility: z.enum(["shared", "firm_private"]).optional(),
});

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  addFollowUp(tx, principal, params.id, body),
);
