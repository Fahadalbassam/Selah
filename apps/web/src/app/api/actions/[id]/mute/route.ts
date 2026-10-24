import { z } from "zod";
import { route } from "@/server/http";
import { setActionMuted } from "@/services/notifications";

// The caller stops or restarts mail about one action they can see. In-app notices still come.
const params = z.object({ id: z.uuid() });

export const PUT = route({ params, body: z.object({ muted: z.boolean() }) }, ({ tx, principal, params, body }) =>
  setActionMuted(tx, principal, params.id, body.muted),
);
