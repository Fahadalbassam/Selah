import { z } from "zod";
import { route } from "@/server/http";
import { revokeInvitation } from "@/services/accounts";

export const DELETE = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  revokeInvitation(tx, principal, params.id),
);
