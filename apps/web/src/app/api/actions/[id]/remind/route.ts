import { z } from "zod";
import { route } from "@/server/http";
import { remindOwner } from "@/services/oversight";

const params = z.object({ id: z.uuid() });

/** Ask the action's owner for an update (F18), once a day. */
export const POST = route({ params }, ({ tx, principal, params }) => remindOwner(tx, principal, params.id));
