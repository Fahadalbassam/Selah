import { z } from "zod";
import { route } from "@/server/http";
import { startDraft } from "@/services/assessments";

/** Edit a published template: a new draft copied from its latest version (or the open draft). */
export const POST = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  startDraft(tx, principal, params.id),
);
