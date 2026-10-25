import { z } from "zod";
import { route } from "@/server/http";
import { checkValue } from "@/services/indicators";

// The firm compared the value with the client's source; once, never by who entered it.
export const POST = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => checkValue(tx, principal, params.id));
