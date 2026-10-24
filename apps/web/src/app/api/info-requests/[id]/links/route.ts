import { z } from "zod";
import { uploadLinkInput } from "@/lib/upload-links";
import { route } from "@/server/http";
import { createUploadLink } from "@/services/upload-links";

// Mail a no-login upload link for this one item (F14).
export const POST = route({ params: z.object({ id: z.uuid() }), body: uploadLinkInput }, ({ tx, principal, params, body }) =>
  createUploadLink(tx, principal, params.id, body),
);
