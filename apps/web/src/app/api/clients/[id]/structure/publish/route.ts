import { z } from "zod";
import { route } from "@/server/http";
import { publish } from "@/services/org-chart";

// Publish the client's draft (org chart, part 5): the firm admin, the
// client's lead or its deputy, with the draft they checked on the publishing
// screen, the day it takes effect and, optionally, the board resolution.
// Anyone else, or another client: 404. The answer lists who was placed in a
// position and who was skipped.
export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    body: z.object({
      draftId: z.uuid(),
      effectiveOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      resolutionDocumentId: z.uuid().nullish(),
    }),
  },
  ({ tx, principal, params, body }) => publish(tx, principal, params.id, body),
);
