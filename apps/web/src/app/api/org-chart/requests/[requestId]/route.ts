import { z } from "zod";
import { route } from "@/server/http";
import { closeChangeRequest } from "@/services/org-chart";

// The firm's editors answer a suggested change, once: done (made in the
// draft) or declined. The person who suggested it is told. Anyone else: 404.
export const POST = route({ params: z.object({ requestId: z.uuid() }), body: z.object({ status: z.enum(["done", "declined"]) }) }, ({ tx, principal, params, body }) =>
  closeChangeRequest(tx, principal, params.requestId, body.status),
);
