import { z } from "zod";
import { route } from "@/server/http";
import { schedule } from "@/services/meetings";

// ?from=&to= (ISO dates or times), optionally narrowed by projectId, clientId or userId.
const query = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  projectId: z.uuid().optional(),
  clientId: z.uuid().optional(),
  userId: z.uuid().optional(),
});

export const GET = route({ query }, ({ tx, principal, query }) => schedule(tx, principal, query));
