import { z } from "zod";
import { PACK_RECEIPT_LIMITS } from "@/lib/offboarding";
import { route } from "@/server/http";
import { recordReceipt } from "@/services/export-pack";

/** The receipt of an export pack: confirmed by the client's admin, or a handover recorded by the firm admin. Once. */
export const POST = route(
  {
    params: z.object({ id: z.uuid(), packId: z.uuid() }),
    body: z
      .object({
        receivedBy: z.string().trim().min(PACK_RECEIPT_LIMITS.name.min).max(PACK_RECEIPT_LIMITS.name.max).optional(),
        note: z.string().trim().max(PACK_RECEIPT_LIMITS.note).optional(),
      })
      .strict(),
  },
  ({ tx, principal, params, body }) => recordReceipt(tx, principal, params.id, params.packId, body),
);
