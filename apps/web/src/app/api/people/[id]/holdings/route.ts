import { z } from "zod";
import { route } from "@/server/http";
import { personHoldings } from "@/services/accounts";

// What a person still holds, before they are switched off (the departing-person report).
export const GET = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => personHoldings(tx, principal, params.id));
