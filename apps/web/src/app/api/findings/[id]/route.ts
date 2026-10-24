import { z } from "zod";
import { route } from "@/server/http";
import { deleteRecord, updateFinding } from "@/services/plan-changes";

const params = z.object({ id: z.uuid() });

const body = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(8000).nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0);

/** Correct a live finding. */
export const PATCH = route({ params, body }, ({ tx, principal, params, body }) => updateFinding(tx, principal, params.id, body));

/** Delete a firm-only finding the client never saw. */
export const DELETE = route({ params }, ({ tx, principal, params }) => deleteRecord(tx, principal, "finding", params.id));
