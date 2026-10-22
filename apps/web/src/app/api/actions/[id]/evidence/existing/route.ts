import { z } from "zod";
import { RECEIVED_VIA } from "@/lib/engagement";
import { route } from "@/server/http";
import { attachExistingEvidence } from "@/services/files";

// Use a file already in Selah as evidence for this action (no new upload).
export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    body: z.object({
      documentId: z.uuid(),
      note: z.string().trim().max(4000).optional(),
      evidenceRequestId: z.uuid().optional(),
      submitForReview: z.boolean().default(false),
      receivedVia: z.enum(RECEIVED_VIA).optional(),
      receivedOn: z.iso.date().optional(),
    }),
  },
  ({ tx, principal, params, body }) =>
    attachExistingEvidence(tx, principal, params.id, {
      documentId: body.documentId,
      note: body.note || undefined,
      evidenceRequestId: body.evidenceRequestId,
      submitForReview: body.submitForReview,
      received: { receivedVia: body.receivedVia, receivedOn: body.receivedOn },
    }),
);
