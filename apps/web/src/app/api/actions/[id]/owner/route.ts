import { z } from "zod";
import { route } from "@/server/http";
import { changeActionOwner } from "@/services/action-owner";

// Give one open action to a colleague (decision D1): a person on the project,
// or (a client the firm runs) a typed name. Who may is the database's rule
// (app_can_change_owner); anyone else gets 404. The status does not change.
const params = z.object({ id: z.uuid() });
const body = z.union([
  z.object({ ownerUserId: z.uuid() }).strict(),
  z.object({ ownerName: z.string().trim().min(2).max(200) }).strict(),
]);

export const POST = route({ params, body }, ({ tx, principal, params, body }) => changeActionOwner(tx, principal, params.id, body));
