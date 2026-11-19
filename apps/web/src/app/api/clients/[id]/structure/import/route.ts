import { z } from "zod";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-rules";
import { BadRequestError } from "@/server/errors";
import { route } from "@/server/http";
import { prepareUpload } from "@/services/evidence";
import { parseImportFile } from "@/services/org-chart-import";

// Org chart, part 4, step one from a file: the filled Excel template or a
// Word outline is checked, virus-scanned (before a connection is taken) and
// read into rows for the review step. Nothing is stored; see ./confirm. For
// the draft's editors only; anyone else, or another client, gets a 404.
export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    body: z.object({}),
    form: { maxBytes: MAX_UPLOAD_BYTES },
    prepare: ({ userId, params, files }) => {
      const file = files.get("file");
      if (!file || files.size !== 1) throw new BadRequestError("attach exactly one file");
      if (!/\.(xlsx|docx)$/i.test(file.name)) throw new BadRequestError("file rejected: type");
      return prepareUpload(userId, { type: "organization", id: params.id }, file);
    },
  },
  ({ tx, principal, params, prepared }) => parseImportFile(tx, principal, params.id, prepared),
);
