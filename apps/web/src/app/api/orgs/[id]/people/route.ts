import { z } from "zod";
import { route } from "@/server/http";
import { listPeople } from "@/services/accounts";

// An organisation's people and open invitations, for its admins.
export const GET = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  listPeople(tx, principal, params.id),
);
