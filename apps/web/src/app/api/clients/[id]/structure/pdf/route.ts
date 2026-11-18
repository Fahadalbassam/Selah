import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { route } from "@/server/http";
import { exportLocale } from "@/server/locale";
import { download, orgChartPdf } from "@/services/exports";

/**
 * The client's organisation structure as a PDF, holding what this person's
 * Structure tab holds (the firm, the client's admin and its managers; another
 * client's chart, an action owner and the draft for a client person: 404).
 */
export const GET = route(
  {
    params: z.object({ id: z.uuid() }),
    query: z.object({
      version: z.union([z.literal("draft"), z.uuid()]).optional(),
      size: z.enum(["a3", "a4"]).default("a3"),
      depth: z.string().regex(/^\d{1,2}$/).optional(),
      names: z.enum(["0", "1"]).default("1"),
      lang: z.enum(["ar", "en"]).optional(),
    }),
  },
  async ({ tx, principal, params, query }) => {
    const locale = await exportLocale(query.lang);
    const file = await orgChartPdf(tx, principal, params.id, { version: query.version, size: query.size, depth: query.depth, names: query.names === "1" }, locale);
    const t = await getTranslations({ locale, namespace: "orgChart" });
    return download(file, t("pdf.title"));
  },
);
