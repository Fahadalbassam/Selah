import { z } from "zod";
import { route } from "@/server/http";
import { exportLocale } from "@/server/locale";
import { clientReportPdf, download } from "@/services/exports";

/** The client's progress across its projects as a PDF, holding what this person can see. */
export const GET = route(
  { params: z.object({ id: z.uuid() }), query: z.object({ lang: z.enum(["ar", "en"]).optional() }) },
  async ({ tx, principal, params, query }) => download(await clientReportPdf(tx, principal, params.id, await exportLocale(query.lang))),
);
