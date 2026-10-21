import { z } from "zod";
import { route } from "@/server/http";
import { invite } from "@/services/accounts";

const body = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(120),
  role: z.enum(["firm_admin", "consultant", "client_admin", "client_manager", "action_owner"]),
});

// The link is mailed to the address only; it is never returned here.
export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  invite(tx, principal, { orgId: params.id, ...body }),
);
