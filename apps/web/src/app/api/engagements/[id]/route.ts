import { z } from "zod";
import { engagementFields } from "@/lib/engagements";
import { route } from "@/server/http";
import { deleteEngagement, getEngagement, updateEngagement } from "@/services/engagements";

const params = z.object({ id: z.uuid() });
const body = z.object(engagementFields).partial().strict();

export const GET = route({ params }, ({ tx, principal, params }) => getEngagement(tx, principal, params.id));

/** Firm admin: correct what was recorded. */
export const PATCH = route({ params, body }, ({ tx, principal, params, body }) => updateEngagement(tx, principal, params.id, body));

/** Firm admin: remove a mistaken record that covers no project. */
export const DELETE = route({ params }, ({ tx, principal, params }) => deleteEngagement(tx, principal, params.id));
