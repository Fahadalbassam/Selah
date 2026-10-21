import { z } from "zod";
import { route } from "@/server/http";
import { setActive } from "@/services/accounts";

// Switch an account off (a reason is required) or back on.
const body = z.object({ active: z.boolean(), reason: z.string().trim().min(1).max(500).optional() });

export const PATCH = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  setActive(tx, principal, params.id, body),
);
