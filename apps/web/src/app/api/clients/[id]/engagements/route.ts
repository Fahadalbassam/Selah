import { z } from "zod";
import { engagementFields } from "@/lib/engagements";
import { route } from "@/server/http";
import { listEngagements, recordEngagement } from "@/services/engagements";

const params = z.object({ id: z.uuid() });
const body = z
  .object({ ...engagementFields, projectIds: z.array(z.uuid()).max(50).optional() })
  .strict()
  .refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, { message: "the engagement ends after it starts", path: ["endsOn"] });

export const GET = route({ params }, ({ tx, principal, params }) => listEngagements(tx, principal, params.id));

/** Firm admin: record what the client signed, and the draft projects it covers. */
export const POST = route({ params, body }, ({ tx, principal, params, body }) => recordEngagement(tx, principal, params.id, body));
