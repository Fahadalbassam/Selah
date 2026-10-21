import { z } from "zod";
import { route } from "@/server/http";
import { setFirmNote } from "@/services/assessments";

/** The firm's own note on an answer, never shown to the client. An empty body removes it. */
export const PUT = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ body: z.string().trim().max(4000) }) },
  ({ tx, principal, params, body }) => setFirmNote(tx, principal, params.id, body.body),
);
