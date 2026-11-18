import { z } from "zod";
import { ORG_CHART_LIMITS } from "@/lib/org-chart";
import { route } from "@/server/http";
import { changeHolder, listHoldings } from "@/services/org-chart";

// Who holds a position: the list with dates (GET), and a change (POST):
// someone starts, a holding ends, or both. The client's admin on the
// published structure, the firm's editors there and in the draft; anyone
// else 404. A change on the published structure tells the lead and deputy.
const params = z.object({ positionId: z.uuid() });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const body = z
  .object({
    start: z
      .object({
        userId: z.uuid().nullish(),
        name: z.string().max(ORG_CHART_LIMITS.holderName.max).nullish(),
        from: day,
      })
      .optional(),
    end: z.object({ holderId: z.uuid(), on: day }).optional(),
  })
  .refine((b) => b.start || b.end);

export const GET = route({ params }, ({ tx, principal, params }) => listHoldings(tx, principal, params.positionId));

export const POST = route({ params, body }, ({ tx, principal, params, body }) => changeHolder(tx, principal, params.positionId, body));
