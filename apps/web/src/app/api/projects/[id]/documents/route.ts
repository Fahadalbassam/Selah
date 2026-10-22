import { z } from "zod";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-rules";
import { BadRequestError } from "@/server/errors";
import { route } from "@/server/http";
import { prepareUpload } from "@/services/evidence";
import { uploadProjectDocument } from "@/services/files";

// Add a file to a project from the Files card (not evidence: that goes
// through the action). Checked and virus-scanned before a connection is taken.
export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    body: z.object({
      visibility: z.enum(["shared", "firm_private", "client_private"]),
      departmentId: z.uuid().optional(),
    }),
    form: { maxBytes: MAX_UPLOAD_BYTES },
    prepare: ({ userId, params, files }) => {
      const file = files.get("file");
      if (!file || files.size !== 1) throw new BadRequestError("attach exactly one file");
      return prepareUpload(userId, { type: "project", id: params.id }, file);
    },
  },
  ({ tx, principal, params, body, prepared }) =>
    uploadProjectDocument(tx, principal, params.id, {
      file: prepared,
      visibility: body.visibility,
      departmentId: body.departmentId || undefined,
    }),
);
