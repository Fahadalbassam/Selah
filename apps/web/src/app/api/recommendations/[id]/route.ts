import { z } from "zod";
import { route } from "@/server/http";
import { deleteRecord, updateRecommendation } from "@/services/plan-changes";

const params = z.object({ id: z.uuid() });
const text = (max: number) => z.string().trim().max(max).nullable();

const body = z
  .object({
    title: z.string().trim().min(1).max(300),
    findingId: z.uuid().nullable(),
    rationale: text(8000),
    targetOutcome: text(4000),
    priority: z.enum(["low", "medium", "high", "critical"]),
    dueDate: z.iso.date().nullable(),
    requiredEvidence: text(4000),
    departmentId: z.uuid().nullable(),
    accountableUserId: z.uuid().nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0);

/** Correct a live recommendation. */
export const PATCH = route({ params, body }, ({ tx, principal, params, body }) => updateRecommendation(tx, principal, params.id, body));

/** Delete a firm-only recommendation the client never saw, with its draft actions. */
export const DELETE = route({ params }, ({ tx, principal, params }) => deleteRecord(tx, principal, "recommendation", params.id));
