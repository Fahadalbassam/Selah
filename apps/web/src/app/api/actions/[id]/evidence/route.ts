import { z } from "zod";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-rules";
import { BadRequestError } from "@/server/errors";
import { route } from "@/server/http";
import { submitEvidence } from "@/services/evidence";

const fields = z.object({
  note: z.string().trim().max(4000).optional(),
  submitForReview: z.enum(["true", "false"]).default("false"),
});

export const POST = route(
  { params: z.object({ id: z.uuid() }), body: fields, form: { maxBytes: MAX_UPLOAD_BYTES } },
  ({ tx, principal, params, body, files }) => {
    const file = files.get("file");
    if (!file || files.size !== 1) throw new BadRequestError("attach exactly one file");
    return submitEvidence(tx, principal, params.id, {
      file,
      note: body.note || undefined,
      submitForReview: body.submitForReview === "true",
    });
  },
);
