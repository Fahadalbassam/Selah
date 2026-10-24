import { z } from "zod";
import { route } from "@/server/http";
import { answerWithExisting } from "@/services/info-requests";

/** Answer with a file already on the project; one file may answer several items. */
export const POST = route({ params: z.object({ id: z.uuid() }), body: z.object({ documentId: z.uuid() }) }, ({ tx, principal, params, body }) =>
  answerWithExisting(tx, principal, params.id, body.documentId),
);
