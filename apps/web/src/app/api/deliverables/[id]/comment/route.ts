import { z } from "zod";
import { commentInput } from "@/lib/deliverables";
import { route } from "@/server/http";
import { commentOnDeliverable } from "@/services/deliverables";

/** A comment on the latest round instead of a receipt (a required text). The client's lead and deputy are told. */
export const POST = route({ params: z.object({ id: z.uuid() }), body: commentInput }, ({ tx, principal, params, body }) =>
  commentOnDeliverable(tx, principal, params.id, body),
);
