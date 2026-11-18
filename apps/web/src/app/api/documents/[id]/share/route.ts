import { z } from "zod";
import { route } from "@/server/http";
import { audienceInput } from "@/services/audience";
import { shareDocument } from "@/services/documents";

/**
 * Share a file with the other side, one-way: a client's admin shares a
 * client-private file with the firm, firm staff share a firm-only file of a
 * client project with the client. The firm may choose who sees it in the same
 * step (feature A); left out, nobody is told.
 */
export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ audience: audienceInput.optional() }) },
  ({ tx, principal, params, body }) => shareDocument(tx, principal, params.id, body.audience ?? null),
);
