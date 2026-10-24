import { z } from "zod";
import { route } from "@/server/http";
import { releaseRecord } from "@/services/plan-changes";

/** Share a firm-only finding with the client (one way). */
export const POST = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => releaseRecord(tx, principal, "finding", params.id));
