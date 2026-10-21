import { z } from "zod";
import { route } from "@/server/http";
import { shareDocument } from "@/services/documents";

/** Share a client-private file with the firm (client admin; one-way). */
export const POST = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  shareDocument(tx, principal, params.id),
);
