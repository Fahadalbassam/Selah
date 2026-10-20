import { z } from "zod";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-rules";
import { BadRequestError } from "@/server/errors";
import { route } from "@/server/http";
import { prepareUpload, submitEvidence } from "@/services/evidence";

const fields = z.object({
  note: z.string().trim().max(4000).optional(),
  submitForReview: z.enum(["true", "false"]).default("false"),
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
      return prepareUpload(userId, params.id, file);
    },
  },
  ({ tx, principal, params, body, prepared }) =>
    submitEvidence(tx, principal, params.id, {
      file: prepared,
      note: body.note || undefined,
      submitForReview: body.submitForReview === "true",
    }),
);
