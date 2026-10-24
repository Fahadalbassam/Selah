import { z } from "zod";
import { route } from "@/server/http";
import { releaseRecord } from "@/services/plan-changes";

/** Share a firm-only recommendation with the client (one way). */
export const POST = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => releaseRecord(tx, principal, "recommendation", params.id));
