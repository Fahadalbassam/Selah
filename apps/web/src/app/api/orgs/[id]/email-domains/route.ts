import { z } from "zod";
import { route } from "@/server/http";
import { setEmailDomains } from "@/services/accounts";

// An empty list means any address (clients only; the firm must keep at least one).
const body = z.object({ domains: z.array(z.string().trim().min(3).max(253)).max(20) });

export const PUT = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  setEmailDomains(tx, principal, params.id, body.domains),
);
