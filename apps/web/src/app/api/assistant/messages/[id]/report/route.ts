import { z } from "zod";
import { route } from "@/server/http";
import { reportFromMessage } from "@/services/report-send";

/** The Send dialog opened under a progress draft in the assistant: the report made from it, if any. Reads only; it never sends. */
export const GET = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => reportFromMessage(tx, principal, params.id));
