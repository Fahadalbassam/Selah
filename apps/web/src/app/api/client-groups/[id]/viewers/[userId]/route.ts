import { z } from "zod";
import { route } from "@/server/http";
import { revokeViewer } from "@/services/client-groups";

/** End a person's access to the group's roll-up. */
export const DELETE = route({ params: z.object({ id: z.uuid(), userId: z.uuid() }) }, ({ tx, principal, params }) =>
  revokeViewer(tx, principal, params.id, params.userId),
);
