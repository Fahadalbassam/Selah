import { z } from "zod";
import { RECEIVED_VIA } from "@/lib/engagement";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-rules";
import { BadRequestError } from "@/server/errors";
import { route } from "@/server/http";
import { prepareUpload, submitEvidence } from "@/services/evidence";

const fields = z.object({
  note: z.string().trim().max(4000).optional(),
  submitForReview: z.enum(["true", "false"]).default("false"),
  evidenceRequestId: z.uuid().optional(),
  // Firm staff for a consultant-managed client: how and when the client sent it.
  receivedVia: z.enum(RECEIVED_VIA).optional(),
  receivedOn: z.iso.date().optional(),
});

export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    body: fields,
    form: { maxBytes: MAX_UPLOAD_BYTES },
    // Check and virus-scan the file before a database connection is taken.
    prepare: ({ userId, params, files }) => {
      const file = files.get("file");
      if (!file || files.size !== 1) throw new BadRequestError("attach exactly one file");
      return prepareUpload(userId, { type: "action", id: params.id }, file);
    },
  },
  ({ tx, principal, params, body, prepared }) =>
    submitEvidence(tx, principal, params.id, {
      file: prepared,
      note: body.note || undefined,
      evidenceRequestId: body.evidenceRequestId,
      submitForReview: body.submitForReview === "true",
      received: { receivedVia: body.receivedVia, receivedOn: body.receivedOn },
    }),
);
