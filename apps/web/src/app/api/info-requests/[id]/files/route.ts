import { z } from "zod";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-rules";
import { BadRequestError } from "@/server/errors";
import { route } from "@/server/http";
import { prepareUpload } from "@/services/evidence";
import { answerWithUpload } from "@/services/info-requests";

// Answer an item with a new file. Checked and virus-scanned before a connection is taken.
export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    body: z.object({}),
    form: { maxBytes: MAX_UPLOAD_BYTES },
    prepare: ({ userId, params, files }) => {
      const file = files.get("file");
      if (!file || files.size !== 1) throw new BadRequestError("attach exactly one file");
      return prepareUpload(userId, { type: "info_request", id: params.id }, file);
    },
  },
  ({ tx, principal, params, prepared }) => answerWithUpload(tx, principal, params.id, prepared),
);
