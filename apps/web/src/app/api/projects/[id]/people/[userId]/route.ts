import { z } from "zod";
import { route } from "@/server/http";
import { removeProjectPerson } from "@/services/staffing";

/** Take one of the client's people off the project (refused while they own open actions there). */
export const DELETE = route({ params: z.object({ id: z.uuid(), userId: z.uuid() }) }, ({ tx, principal, params }) =>
  removeProjectPerson(tx, principal, params.id, params.userId),
);
