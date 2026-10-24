import { z } from "zod";
import { route } from "@/server/http";
import { withdrawDocument } from "@/services/documents";

/** The uploader takes back a wrong file nobody relied on yet, with a reason (N8). */
export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ reason: z.string().trim().min(3).max(500) }) },
  ({ tx, principal, params, body }) => withdrawDocument(tx, principal, params.id, body.reason),
);
