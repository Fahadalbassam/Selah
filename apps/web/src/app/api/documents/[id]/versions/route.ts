import { z } from "zod";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-rules";
import { BadRequestError } from "@/server/errors";
import { route } from "@/server/http";
import { uploadNewVersion } from "@/services/documents";
import { prepareUpload } from "@/services/evidence";

// The next version of a file. Checked and virus-scanned before a connection is taken.
export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    body: z.object({}),
    form: { maxBytes: MAX_UPLOAD_BYTES },
    prepare: ({ userId, params, files }) => {
      const file = files.get("file");
      if (!file || files.size !== 1) throw new BadRequestError("attach exactly one file");
      return prepareUpload(userId, { type: "document", id: params.id }, file);
    },
  },
  ({ tx, principal, params, prepared }) => uploadNewVersion(tx, principal, params.id, prepared),
);
