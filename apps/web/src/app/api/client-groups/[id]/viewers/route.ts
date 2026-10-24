import { z } from "zod";
import { route } from "@/server/http";
import { grantViewer } from "@/services/client-groups";

/** Let a named admin or manager of the holding read the group's roll-up. */
export const POST = route({ params: z.object({ id: z.uuid() }), body: z.object({ userId: z.uuid() }) }, ({ tx, principal, params, body }) =>
  grantViewer(tx, principal, params.id, body.userId),
);
