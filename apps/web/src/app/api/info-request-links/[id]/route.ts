import { z } from "zod";
import { route } from "@/server/http";
import { revokeUploadLink } from "@/services/upload-links";

// Revoke an upload link (F14). It stays on record, revoked.
export const DELETE = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => revokeUploadLink(tx, principal, params.id));
