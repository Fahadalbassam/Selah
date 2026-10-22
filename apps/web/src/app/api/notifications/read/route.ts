import { z } from "zod";
import { route } from "@/server/http";
import { markRead } from "@/services/notifications";

// With ids, marks those read; without, all of them.
const body = z.object({ ids: z.array(z.uuid()).min(1).max(100).optional() });

export const POST = route({ body }, ({ tx, principal, body }) => markRead(tx, principal, body.ids));
