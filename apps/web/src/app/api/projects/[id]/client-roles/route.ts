import { z } from "zod";
import { clientRoleInput } from "@/lib/client-roles";
import { route } from "@/server/http";
import { addClientRole, listClientRoles } from "@/services/client-roles";

const params = z.object({ id: z.uuid() });

export const GET = route({ params }, ({ tx, principal, params }) => listClientRoles(tx, principal, params.id));

/** The firm admin, the client's lead consultant or the client's admin: name someone to a client role. */
export const POST = route({ params, body: clientRoleInput.strict() }, ({ tx, principal, params, body }) => addClientRole(tx, principal, params.id, body));
