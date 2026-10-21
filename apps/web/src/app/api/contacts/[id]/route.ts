import { z } from "zod";
import { route } from "@/server/http";
import { deleteContact, updateContact } from "@/services/accounts";

const body = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().max(120).nullable().optional(),
  email: z.email().max(254).nullable().optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[+0-9 ()-]{0,30}$/)
    .nullable()
    .optional(),
});

export const PATCH = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  updateContact(tx, principal, params.id, body),
);
export const DELETE = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  deleteContact(tx, principal, params.id),
);
