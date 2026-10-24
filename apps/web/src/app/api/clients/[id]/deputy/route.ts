import { z } from "zod";
import { route } from "@/server/http";
import { setDeputy } from "@/services/staffing";

/** Name the client's deputy consultant (the firm admin only). */
export const PUT = route({ params: z.object({ id: z.uuid() }), body: z.object({ userId: z.uuid() }) }, ({ tx, principal, params, body }) =>
  setDeputy(tx, principal, params.id, body.userId),
);

/** Remove the deputy, who stays on the client's team. */
export const DELETE = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => setDeputy(tx, principal, params.id, null));
