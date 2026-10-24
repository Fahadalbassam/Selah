import { z } from "zod";
import { CLIENT_AI_LIMIT, CLIENT_AI_ROLES } from "@/lib/client-ai";
import { route } from "@/server/http";
import { getClientAi, setClientAi } from "@/services/client-ai";

const params = z.object({ id: z.uuid() });

export const GET = route({ params }, ({ tx, principal, params }) => getClientAi(tx, principal, params.id));

// The firm admin switches the client assistant on or off (wave 3, F39). Off, or on for a new role, ends the client's consent.
export const PUT = route(
  {
    params,
    body: z.object({
      enabled: z.boolean(),
      roles: z.array(z.enum(CLIENT_AI_ROLES)).max(3),
      dailyLimit: z.number().int().min(CLIENT_AI_LIMIT.min).max(CLIENT_AI_LIMIT.max),
    }),
  },
  ({ tx, principal, params, body }) => setClientAi(tx, principal, params.id, body),
);
