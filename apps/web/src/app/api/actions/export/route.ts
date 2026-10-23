import { z } from "zod";
import { route } from "@/server/http";
import { exportLocale } from "@/server/locale";
import { actionsWorkbook, download } from "@/services/exports";

/** The Actions page as an Excel workbook. */
export const GET = route({ query: z.object({ lang: z.enum(["ar", "en"]).optional() }) }, async ({ tx, principal, query }) =>
  download(await actionsWorkbook(tx, principal, await exportLocale(query.lang))),
);
