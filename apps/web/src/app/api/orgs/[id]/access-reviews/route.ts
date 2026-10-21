import { z } from "zod";
import { route } from "@/server/http";
import { submitAccessReview } from "@/services/accounts";

// Everyone not listed stays.
const body = z.object({
  deactivate: z.array(z.object({ userId: z.uuid(), reason: z.string().trim().min(1).max(500) })).max(500),
});

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  submitAccessReview(tx, principal, params.id, body),
);
