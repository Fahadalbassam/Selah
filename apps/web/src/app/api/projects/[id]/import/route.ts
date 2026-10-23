import { z } from "zod";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-rules";
import { BadRequestError } from "@/server/errors";
import { route } from "@/server/http";
import { prepareUpload } from "@/services/evidence";
import { parseImport } from "@/services/plan-import";

// Step one of importing a plan: an Excel or Word file is checked, virus-scanned
// (before a connection is taken) and read into rows for review. Nothing is
// stored and nothing is created; see ./confirm.
export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    body: z.object({}),
    form: { maxBytes: MAX_UPLOAD_BYTES },
    prepare: ({ userId, params, files }) => {
      const file = files.get("file");
      if (!file || files.size !== 1) throw new BadRequestError("attach exactly one file");
      if (!/\.(xlsx|docx)$/i.test(file.name)) throw new BadRequestError("file rejected: type");
      return prepareUpload(userId, { type: "project", id: params.id }, file);
    },
  },
  ({ tx, principal, params, prepared }) => parseImport(tx, principal, params.id, prepared),
);
