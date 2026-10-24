import { z } from "zod";
import { route } from "@/server/http";
import { removeAnswer } from "@/services/info-requests";

/** Take a file off an item; the file stays on the project. */
export const DELETE = route({ params: z.object({ id: z.uuid(), documentId: z.uuid() }) }, ({ tx, principal, params }) =>
  removeAnswer(tx, principal, params.id, params.documentId),
);
