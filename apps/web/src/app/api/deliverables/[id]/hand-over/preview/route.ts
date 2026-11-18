import { z } from "zod";
import { handOverInput } from "@/lib/deliverables";
import { route } from "@/server/http";
import { handOverPreview } from "@/services/deliverables";

/** Before a hand-over: who at the client will be asked for these files, and which acceptors cannot open them all. Writes nothing. */
export const POST = route({ params: z.object({ id: z.uuid() }), body: handOverInput }, ({ tx, principal, params, body }) =>
  handOverPreview(tx, principal, params.id, body.versionIds),
);
