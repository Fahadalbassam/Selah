import { z } from "zod";
import { route } from "@/server/http";
import { shareDocument } from "@/services/documents";

/**
 * Share a file with the other side, one-way: a client's admin shares a
 * client-private file with the firm, firm staff share a firm-only file of a
 * client project with the client.
 */
export const POST = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  shareDocument(tx, principal, params.id),
);
