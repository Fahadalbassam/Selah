import { z } from "zod";
import { route } from "@/server/http";
import { discardClient } from "@/services/prospects";

/** Delete a client that never signed: a lost pitch (its lead or the firm admin) or one added by mistake (the firm admin). */
export const DELETE = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => discardClient(tx, principal, params.id));
