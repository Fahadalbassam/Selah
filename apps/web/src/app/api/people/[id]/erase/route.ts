import { z } from "zod";
import { route } from "@/server/http";
import { eraseUser } from "@/services/accounts";

// A PDPL erasure request. Cannot be undone.
export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ reason: z.string().trim().min(3).max(500) }) },
  ({ tx, principal, params, body }) => eraseUser(tx, principal, params.id, body.reason),
);
