import { z } from "zod";
import { route } from "@/server/http";
import { setProjectState } from "@/services/handover";

const params = z.object({ id: z.uuid() });
const body = z.object({ state: z.enum(["active", "closed"]) }).strict();

/** Firm admin: close the project when the engagement is over, or reopen it. */
export const PATCH = route({ params, body }, ({ tx, principal, params, body }) =>
  setProjectState(tx, principal, params.id, body.state),
);
