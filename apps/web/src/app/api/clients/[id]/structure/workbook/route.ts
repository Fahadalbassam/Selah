import { z } from "zod";
import { route } from "@/server/http";
import { exportLocale } from "@/server/locale";
import { download } from "@/services/exports";
import { orgChartWorkbook } from "@/services/org-chart-import";

/**
 * A version of the client's structure in the import template (org chart,
 * part 4), so it can be changed in Excel and brought back in: the draft, a
 * version's id, or the current version. For the draft's editors only;
 * everyone else, and another client, 404. Ten per person in ten minutes,
 * like the PDF.
 */
export const GET = route(
  {
    params: z.object({ id: z.uuid() }),
    query: z.object({ version: z.union([z.literal("draft"), z.uuid()]).optional(), lang: z.enum(["ar", "en"]).optional() }),
  },
  async ({ tx, principal, params, query }) => {
    const file = await orgChartWorkbook(tx, principal, params.id, query.version, await exportLocale(query.lang));
    return download(file, file.title);
  },
);
