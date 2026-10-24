import { z } from "zod";
import { route } from "@/server/http";
import { exportLocale } from "@/server/locale";
import { closurePdf, download } from "@/services/exports";

/** A closed project's closure report as PDF, for anyone who can read the project. */
export const GET = route(
  { params: z.object({ id: z.uuid() }), query: z.object({ lang: z.enum(["ar", "en"]).optional() }) },
  async ({ tx, principal, params, query }) => download(await closurePdf(tx, principal, params.id, await exportLocale(query.lang))),
);
