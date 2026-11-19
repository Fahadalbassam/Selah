import { z } from "zod";
import { route } from "@/server/http";
import { approveReport } from "@/services/report-send";

/** Approve a report so it may be sent: the client's lead or deputy, an internal project's lead or the firm admin, never its writer. */
export const POST = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => approveReport(tx, principal, params.id));
