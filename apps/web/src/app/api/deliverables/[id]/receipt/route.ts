import { z } from "zod";
import { receiptInput } from "@/lib/deliverables";
import { route } from "@/server/http";
import { recordReceipt } from "@/services/deliverables";

/**
 * The receipt of the latest round: confirmed by the client's acceptor, admin
 * or sponsor, or, for a client the firm runs, recorded by the consultant with
 * who received it, how and when. Once per round (the export pack's receipt pattern).
 */
export const POST = route({ params: z.object({ id: z.uuid() }), body: receiptInput }, ({ tx, principal, params, body }) =>
  recordReceipt(tx, principal, params.id, body),
);
