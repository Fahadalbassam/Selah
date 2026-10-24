import { z } from "zod";
import { route } from "@/server/http";
import { setCompany } from "@/services/client-groups";

const params = z.object({ id: z.uuid(), departmentId: z.uuid() });

/** Mark a member client's department as a company of the group kept inside that client. */
export const PUT = route({ params }, ({ tx, principal, params }) => setCompany(tx, principal, params.id, params.departmentId, true));

/** Turn it back into a plain department. */
export const DELETE = route({ params }, ({ tx, principal, params }) => setCompany(tx, principal, params.id, params.departmentId, false));
