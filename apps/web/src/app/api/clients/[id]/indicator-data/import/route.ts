import { z } from "zod";
import { MAX_SHEET_BYTES } from "@/lib/indicator-import";
import { BadRequestError } from "@/server/errors";
import { route } from "@/server/http";
import { prepareUpload } from "@/services/evidence";
import { parseIndicatorFile } from "@/services/indicator-data";

// Step one of importing indicator figures: an Excel or CSV export is checked,
// virus-scanned (before a connection is taken) and read into its sheets for
// review. Nothing is stored; see ./confirm.
export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    body: z.object({}),
    form: { maxBytes: MAX_SHEET_BYTES * 5 },
    prepare: ({ userId, params, files }) => {
      const file = files.get("file");
      if (!file || files.size !== 1) throw new BadRequestError("attach exactly one file");
      if (!/\.(xlsx|csv)$/i.test(file.name)) throw new BadRequestError("file rejected: type");
      // Windows names a CSV "application/vnd.ms-excel"; the extension and the scan decide.
      const named = /\.csv$/i.test(file.name) ? new File([file], file.name, { type: "text/csv" }) : file;
      return prepareUpload(userId, { type: "project", id: params.id }, named);
    },
  },
  ({ tx, principal, params, prepared }) => parseIndicatorFile(tx, principal, params.id, prepared),
);
