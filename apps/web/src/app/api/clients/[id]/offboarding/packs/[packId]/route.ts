import { z } from "zod";
import { route } from "@/server/http";
import { exportPackLink } from "@/services/export-pack";

/** A one-minute download link to an export pack. Audited. */
export const GET = route({ params: z.object({ id: z.uuid(), packId: z.uuid() }) }, ({ tx, principal, params, ip }) =>
  exportPackLink(tx, principal, params.id, params.packId, ip),
);
