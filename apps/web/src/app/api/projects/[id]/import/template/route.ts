import { z } from "zod";
import { NotFoundError } from "@/server/errors";
import { route } from "@/server/http";
import { exportLocale } from "@/server/locale";
import { download, importTemplate } from "@/services/exports";
import { importContext } from "@/services/plan-import";

/** The empty plan workbook to fill in, for the people who can import into this project. */
export const GET = route(
  { params: z.object({ id: z.uuid() }), query: z.object({ lang: z.enum(["ar", "en"]).optional() }) },
  async ({ tx, principal, params, query }) => {
    if (!(await importContext(tx, principal, params.id))) throw new NotFoundError("project");
    return download(await importTemplate(await exportLocale(query.lang)));
  },
);
