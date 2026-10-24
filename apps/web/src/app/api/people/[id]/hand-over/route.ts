import { z } from "zod";
import { route } from "@/server/http";
import { HAND_OVER_KINDS, handOver } from "@/services/accounts";

// Hand a person's work to a colleague in one step.
const body = z.object({ to: z.uuid(), kinds: z.array(z.enum(HAND_OVER_KINDS)).min(1) });

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  handOver(tx, principal, params.id, body),
);
