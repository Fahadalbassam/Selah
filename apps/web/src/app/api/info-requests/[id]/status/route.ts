import { z } from "zod";
import { infoRequestMove } from "@/lib/info-requests";
import { route } from "@/server/http";
import { moveInfoRequest } from "@/services/info-requests";

/** Review, return with a reason, mark not applicable, or reopen. */
export const POST = route({ params: z.object({ id: z.uuid() }), body: infoRequestMove }, ({ tx, principal, params, body }) =>
  moveInfoRequest(tx, principal, params.id, body),
);
