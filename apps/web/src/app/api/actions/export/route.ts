import { z } from "zod";
import { route } from "@/server/http";
import { exportLocale } from "@/server/locale";
import { actionsWorkbook, download } from "@/services/exports";

/**
 * The Actions page as an Excel workbook: every action the caller can see.
 * It takes no filter, so an unknown parameter (a project id, say) is refused
 * rather than ignored with a sheet that looks filtered (review L12).
 */
export const GET = route({ query: z.object({ lang: z.enum(["ar", "en"]).optional() }).strict() }, async ({ tx, principal, query }) =>
  download(await actionsWorkbook(tx, principal, await exportLocale(query.lang))),
);
