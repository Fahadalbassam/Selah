import { z } from "zod";
import { route } from "@/server/http";
import { exportLocale } from "@/server/locale";
import { listExportPacks, makeExportPack } from "@/services/export-pack";

/** Make an export pack of an archived client (the firm admin, or the client's admin in its grace period). */
export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ lang: z.enum(["ar", "en"]).optional() }).strict() },
  async ({ tx, principal, params, body }) => {
    const made = await makeExportPack(tx, principal, params.id, await exportLocale(body.lang));
    return { ...made, packs: await listExportPacks(tx, principal, params.id) };
  },
);
