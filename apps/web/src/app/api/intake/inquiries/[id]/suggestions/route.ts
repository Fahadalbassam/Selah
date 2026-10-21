import { z } from "zod";
import { route } from "@/server/http";
import { suggestLeads } from "@/services/inquiries";

// Who could lead it, from declared expertise. Firm admins only; a suggestion, not an assignment.
export const GET = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  suggestLeads(tx, principal, params.id),
);
