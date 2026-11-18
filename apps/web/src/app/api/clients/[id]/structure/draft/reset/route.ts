import { z } from "zod";
import { route } from "@/server/http";
import { resetDraft } from "@/services/org-chart";

// Start the client's draft again from its current published version (the
// firm's editors). The draft the editor looked at is named, as for publishing.
export const POST = route({ params: z.object({ id: z.uuid() }), body: z.object({ draftId: z.uuid() }) }, ({ tx, principal, params, body }) =>
  resetDraft(tx, principal, params.id, body),
);
