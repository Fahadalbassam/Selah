import { z } from "zod";
import { route } from "@/server/http";
import { addProgressUpdate } from "@/services/progress";

export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ body: z.string().trim().min(1).max(4000) }) },
  ({ tx, principal, params, body }) => addProgressUpdate(tx, principal, params.id, body.body),
);
