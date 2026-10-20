import { z } from "zod";
import { route } from "@/server/http";
import { createDownloadLink } from "@/services/documents";

export const GET = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params, ip }) =>
  createDownloadLink(tx, principal, params.id, ip),
);
