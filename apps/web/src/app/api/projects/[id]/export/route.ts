import { z } from "zod";
import { route } from "@/server/http";
import { exportLocale } from "@/server/locale";
import { download, planWorkbook } from "@/services/exports";

/** The project's plan as an Excel workbook, holding what this person can see. */
export const GET = route(
  { params: z.object({ id: z.uuid() }), query: z.object({ lang: z.enum(["ar", "en"]).optional() }) },
  async ({ tx, principal, params, query }) => download(await planWorkbook(tx, principal, params.id, await exportLocale(query.lang))),
);
