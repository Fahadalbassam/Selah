import { z } from "zod";
import { NotFoundError } from "@/server/errors";
import { route } from "@/server/http";
import { exportLocale } from "@/server/locale";
import { download } from "@/services/exports";
import { canImport, orgChartTemplate } from "@/services/org-chart-import";

/** The empty structure template (with its guide sheet) to fill in, for the people who may import into this client's draft. */
export const GET = route(
  { params: z.object({ id: z.uuid() }), query: z.object({ lang: z.enum(["ar", "en"]).optional() }) },
  async ({ principal, params, query }) => {
    if (!canImport(principal, params.id)) throw new NotFoundError("org chart");
    return download(await orgChartTemplate(await exportLocale(query.lang)));
  },
);
