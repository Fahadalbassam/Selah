import { z } from "zod";
import { route } from "@/server/http";
import { exportLocale } from "@/server/locale";
import { download, reportPdf } from "@/services/exports";

/** A report as PDF, for anyone who can read the report. */
export const GET = route(
  { params: z.object({ id: z.uuid() }), query: z.object({ lang: z.enum(["ar", "en"]).optional() }) },
  async ({ tx, principal, params, query }) => download(await reportPdf(tx, principal, params.id, await exportLocale(query.lang))),
);
