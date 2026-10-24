import { z } from "zod";
import { route } from "@/server/http";
import { actionThread, postComment } from "@/services/comments";

const params = z.object({ id: z.uuid() });

export const GET = route({ params }, ({ tx, principal, params }) => actionThread(tx, principal, params.id));

/** Write on the action's thread (F11), mentioning people who can see it. */
export const POST = route(
  { params, body: z.object({ body: z.string().trim().min(1).max(8000), mentions: z.array(z.uuid()).max(20).optional() }) },
  ({ tx, principal, params, body }) => postComment(tx, principal, params.id, body),
);
