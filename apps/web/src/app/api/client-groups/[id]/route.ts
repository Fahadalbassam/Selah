import { z } from "zod";
import { route } from "@/server/http";
import { deleteGroup, updateGroup } from "@/services/client-groups";

const body = z
  .object({
    nameAr: z.string().trim().min(1).max(200),
    nameEn: z.string().trim().max(200).nullable(),
    notes: z.string().trim().max(2000).nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0);

/** Rename the group or change its notes (the firm admin only). */
export const PATCH = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  updateGroup(tx, principal, params.id, body),
);

/** Remove the group. Its members stay clients, each with its own data. */
export const DELETE = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => deleteGroup(tx, principal, params.id));
