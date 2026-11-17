import { z } from "zod";
import { route } from "@/server/http";
import { setIndicatorMuted } from "@/services/notifications";

// The caller stops or restarts mail about one indicator they can read
// (indicator.moved_away, migration 0090). In-app notices still come.
const params = z.object({ id: z.uuid() });

export const PUT = route({ params, body: z.object({ muted: z.boolean() }) }, ({ tx, principal, params, body }) =>
  setIndicatorMuted(tx, principal, params.id, body.muted),
);
