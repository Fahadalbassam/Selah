import { z } from "zod";
import { ENGAGEMENT_MODES } from "@/lib/engagement";
import { route } from "@/server/http";
import { getEngagement, setEngagement } from "@/services/engagement";

const params = z.object({ id: z.uuid() });

/** The client's engagement mode, and its departments when it has them. */
export const GET = route({ params }, ({ tx, principal, params }) => getEngagement(tx, principal, params.id));

// engagementMode, minimalRecords and displayAlias: firm admin only. departmentsEnabled: the client's admin or the firm admin.
const body = z
  .object({
    engagementMode: z.enum(ENGAGEMENT_MODES),
    departmentsEnabled: z.boolean(),
    minimalRecords: z.boolean(),
    displayAlias: z.string().trim().min(1).max(100),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0);

export const PATCH = route({ params, body }, ({ tx, principal, params, body }) => setEngagement(tx, principal, params.id, body));
