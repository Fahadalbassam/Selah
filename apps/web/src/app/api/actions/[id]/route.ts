import { z } from "zod";
import { route } from "@/server/http";
import { getAction } from "@/services/actions";
import { updateAction } from "@/services/plan";

const params = z.object({ id: z.uuid() });

export const GET = route({ params }, ({ tx, principal, params }) => getAction(tx, principal, params.id));

const body = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(8000).nullable(),
    ownerUserId: z.uuid().nullable(),
    ownerName: z.string().trim().min(1).max(200).nullable(),
    departmentId: z.uuid().nullable(),
    dueDate: z.iso.date().nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0);

export const PATCH = route({ params, body }, ({ tx, principal, params, body }) => updateAction(tx, principal, params.id, body));
