import { z } from "zod";
import { route } from "@/server/http";
import { shareReport } from "@/services/follow-through";
import { sendPreview } from "@/services/report-send";

const params = z.object({ id: z.uuid() });

/** What the Send dialog shows first (the report, its approval, whether it went): reads only. */
export const GET = route({ params }, ({ tx, principal, params }) => sendPreview(tx, principal, params.id));

/**
 * Send the report to the client: only from the Send dialog, after a person pressed Send there
 * (`confirmed: true`), and only once approved by someone other than its writer (migration 0110).
 */
export const POST = route({ params, body: z.object({ confirmed: z.literal(true) }) }, ({ tx, principal, params, body }) =>
  shareReport(tx, principal, params.id, body),
);
